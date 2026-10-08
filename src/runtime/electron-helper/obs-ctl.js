/* dsh-pet local patch Z: obs-rec@1 —— 「让她替我开 OBS 录屏 / 说停就停」的底层通道。
 *
 * 为什么单独一个文件：它只用 node 内置模块（net/crypto/fs/path/child_process），
 * 既能被 Electron 主进程 require，也能用真正的 node.exe 直接跑起来自测
 * （`node obs-ctl.js status|start|stop`）——省得为一句话去重启整个桌宠。
 *
 * 安全边界（与 [local patch P] 同一套口径）：
 *   - 渲染端**只能传动作动词**（开始/停止/查状态），路径、可执行文件、端口、密码
 *     全部写死在本文件里，渲染端一个都给不了。
 *   - 不执行任何用户可控命令、不传 shell（shell:false）、不删改任何文件。
 *   - 录屏文件名/格式/编码器**完全交给 OBS 自己的配置**（主人要求的），我们只发
 *     StartRecord/StopRecord，不碰任何 Output 设置。
 *
 * obs-websocket 协议（OBS 32 自带的 5.x）：
 *   服务端 op0 Hello{authentication:{challenge,salt}} → 客户端 op1 Identify{rpcVersion:1,authentication}
 *   → op2 Identified；请求 op6{requestType,requestId,requestData}，响应 op7{requestStatus,responseData}。
 *   鉴权 = base64(sha256( base64(sha256(password+salt)) + challenge ))。
 */
'use strict';

const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** OBS 安装器会把它自己的安装根写在这里（实测形如 F:\SteamLibrary\steamapps\common\OBS Studio）。
 *  读注册表比写死盘符靠谱：装在哪个盘都能找到。读不到就返回 null，绝不猜。 */
function obsInstallFromRegistry() {
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\OBS Studio', '/ve'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000,
    });
    const matched = /REG_SZ\s+(.+?)\s*$/m.exec(out);
    return matched ? matched[1].trim() : null;
  } catch {
    return null;
  }
}

/** OBS 可执行文件候选。顺序 = 用户显式指定（DSH_PET_OBS_EXE）→ 注册表里的安装根 → 常见安装位置。
 *  绝不写死某台机器的盘符：找不到就返回 null，调用方照旧报「没找到 OBS」。 */
function obsExeCandidates() {
  const list = [];
  const custom = process.env.DSH_PET_OBS_EXE;
  if (custom) list.push(custom);
  const installed = obsInstallFromRegistry();
  if (installed) list.push(path.join(installed, 'bin', '64bit', 'obs64.exe'));
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  for (const root of [pf, pf86]) list.push(path.join(root, 'obs-studio', 'bin', '64bit', 'obs64.exe'));
  return list;
}

const WS_CFG = path.join(process.env.APPDATA || '', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');

const CONNECT_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 15000;
const PORT_PROBE_MS = 900;
const START_WAIT_MS = 30000;

/** obs-websocket 的 RequestStatus 码 → 人话（只为日志好读，不影响判断）。 */
const STATUS_TEXT = {
  100: 'success', 203: 'missing-request-type', 204: 'unknown-request-type', 205: 'internal-error',
  206: 'unsupported-batch', 207: 'not-ready', 300: 'unsupported-request-type',
  400: 'missing-request-field', 401: 'invalid-request-field', 402: 'missing-request-data', 403: 'invalid-request-data',
};

function log(...a) {
  try { process.stderr.write('[dsh-pet obs] ' + a.join(' ') + '\n'); } catch { /* 管道没了就算了 */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读 obs-websocket 自己的配置：端口与密码**只从这里来**（主人在 OBS 里设的）。 */
function readWsConfig() {
  try {
    const o = JSON.parse(fs.readFileSync(WS_CFG, 'utf8'));
    return {
      port: Number(o.server_port) || 4455,
      password: String(o.server_password || ''),
      enabled: o.server_enabled !== false,
      authRequired: o.auth_required !== false,
    };
  } catch {
    return null;
  }
}

function findObsExe() {
  for (const p of obsExeCandidates()) {
    try { if (fs.existsSync(p)) return p; } catch { /* 下一个 */ }
  }
  return null;
}

/** 端口在听吗（= OBS 起来没有 / obs-websocket 开着没有）。 */
function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => { if (!done) { done = true; try { s.destroy(); } catch {} resolve(v); } };
    s.setTimeout(PORT_PROBE_MS, () => fin(false));
    s.on('connect', () => fin(true));
    s.on('error', () => fin(false));
  });
}

/**
 * 开一条 obs-websocket 连接，握手 + 鉴权，返回 { request, close }。
 * 帧处理与桌宠 main.js 里那套 TTS WS 客户端同源：客户端帧带掩码，服务端帧不带，
 * 支持 126/127 长度、分片重组、ping/pong。
 */
function wsOpen({ port, password, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const key = crypto.randomBytes(16).toString('base64');
    let handshaked = false, settled = false, fatal = false;
    let buf = Buffer.alloc(0), fragOp = 0, fragParts = [];
    const pending = new Map();
    let nextId = 1, closed = false;
    let idResolve, idReject;
    const identified = new Promise((res, rej) => { idResolve = res; idReject = rej; });
    identified.catch(() => { /* 没人 await 也不要炸 */ });

    const hardFail = (err) => {
      fatal = true;
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      idReject(err);
      for (const p of pending.values()) { clearTimeout(p.t); p.rej(err); }
      pending.clear();
      try { sock.destroy(); } catch {}
    };

    const timer = setTimeout(() => hardFail(new Error('connect-timeout')), Number(timeoutMs) || CONNECT_TIMEOUT_MS);

    const sendFrame = (op, payload) => {
      if (sock.destroyed || closed) return;
      const mask = crypto.randomBytes(4);
      const len = payload.length;
      let header;
      if (len < 126) { header = Buffer.alloc(6); header[1] = 0x80 | len; }
      else if (len < 65536) { header = Buffer.alloc(8); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      else { header = Buffer.alloc(14); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
      header[0] = 0x80 | op;
      mask.copy(header, header.length - 4);
      const body = Buffer.from(payload);
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      sock.write(Buffer.concat([header, body]));
    };
    const sendText = (o) => sendFrame(0x1, Buffer.from(JSON.stringify(o), 'utf8'));

    const request = (requestType, requestData) =>
      identified.then(() => new Promise((res, rej) => {
        const id = String(nextId++);
        const t = setTimeout(() => { pending.delete(id); rej(new Error(requestType + '-timeout')); }, CALL_TIMEOUT_MS);
        pending.set(id, { res, rej, t });
        sendText({ op: 6, d: { requestType, requestId: id, requestData: requestData || {} } });
      }));

    const onJson = (msg) => {
      if (msg.op === 0) {
        const d = { rpcVersion: 1, eventSubscriptions: 0 };
        if (msg.d && msg.d.authentication) {
          const secret = crypto.createHash('sha256').update(password + msg.d.authentication.salt).digest('base64');
          d.authentication = crypto.createHash('sha256').update(secret + msg.d.authentication.challenge).digest('base64');
        }
        sendText({ op: 1, d });
        return;
      }
      if (msg.op === 2) { idResolve(true); return; }
      if (msg.op === 7) {
        const p = pending.get(msg.d && msg.d.requestId);
        if (!p) return;
        pending.delete(msg.d.requestId);
        clearTimeout(p.t);
        const okRes = msg.d.requestStatus && msg.d.requestStatus.result;
        if (okRes) p.res(msg.d.responseData || {});
        else {
          const code = String((msg.d.requestStatus && msg.d.requestStatus.code) || 'request-failed');
          const comment = (msg.d.requestStatus && msg.d.requestStatus.comment) || '';
          p.rej(new Error(code + (STATUS_TEXT[code] ? '-' + STATUS_TEXT[code] : '') + (comment ? ' ' + comment : '')));
        }
        return;
      }
      /* op 5 = 事件：我们没订阅，忽略 */
    };

    sock.on('error', () => hardFail(new Error('socket-error')));
    sock.on('close', () => { closed = true; if (!settled) hardFail(new Error('closed-before-handshake')); idReject(new Error('closed')); });
    sock.on('connect', () => {
      sock.write([
        'GET / HTTP/1.1',
        'Host: 127.0.0.1:' + port,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: obswebsocket.json',
      ].join('\r\n') + '\r\n\r\n');
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaked) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const head = buf.subarray(0, idx).toString('latin1');
        buf = buf.subarray(idx + 4);
        const status = Number((head.match(/^HTTP\/1\.1 (\d+)/) || [])[1]);
        if (status !== 101) return hardFail(new Error('handshake-' + status));
        handshaked = true; settled = true; clearTimeout(timer);
        resolve({ request, close: () => { closed = true; try { sock.destroy(); } catch {} } });
      }
      for (;;) {
        if (buf.length < 2) return;
        const b0 = buf[0], b1 = buf[1];
        const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        let mask;
        if (masked) { if (buf.length < off + 4) return; mask = buf.subarray(off, off + 4); off += 4; }
        if (buf.length < off + len) return;
        let payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (masked) { const p = Buffer.from(payload); for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3]; payload = p; }
        if (op === 0x8) { closed = true; try { sock.destroy(); } catch {} return; }
        if (op === 0x9) { sendFrame(0xA, payload); continue; }
        if (op === 0xA) continue;
        if (op === 0x0) fragParts.push(payload); else { fragOp = op; fragParts = [payload]; }
        if (fin) {
          const data = Buffer.concat(fragParts); fragParts = [];
          if (fragOp !== 0x2) {
            try { onJson(JSON.parse(data.toString('utf8'))); } catch { /* 非 JSON 帧忽略 */ }
          }
        }
      }
    });
  });
}

/** 一锤子买卖：连上 → 发一个请求 → 断开。OBS 没开/服务端没开时抛错。 */
async function call(requestType, requestData) {
  const cfg = readWsConfig();
  if (!cfg) throw new Error('no-ws-config');
  if (!cfg.enabled) throw new Error('ws-disabled');
  const s = await wsOpen({ port: cfg.port, password: cfg.password, timeoutMs: CONNECT_TIMEOUT_MS });
  try { return await s.request(requestType, requestData); } finally { s.close(); }
}

/** OBS 没开就把它拉起来（最小化到托盘，不抢主人焦点），等 obs-websocket 真正在听。 */
async function ensureRunning() {
  const cfg = readWsConfig();
  if (!cfg) return { ok: false, error: 'no-ws-config' };
  if (!cfg.enabled) return { ok: false, error: 'ws-disabled' };
  if (await portOpen(cfg.port)) return { ok: true, started: false, port: cfg.port };
  const exe = findObsExe();
  if (!exe) return { ok: false, error: 'obs-exe-not-found' };
  try {
    const child = spawn(exe, ['--minimize-to-tray', '--disable-shutdown-check'], {
      cwd: path.dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    child.unref();
    log('已拉起 OBS：' + exe + ' (pid ' + child.pid + ')');
  } catch (e) {
    return { ok: false, error: 'obs-spawn-failed:' + String((e && e.message) || e) };
  }
  const t0 = Date.now();
  while (Date.now() - t0 < START_WAIT_MS) {
    await sleep(500);
    if (await portOpen(cfg.port)) return { ok: true, started: true, port: cfg.port, ms: Date.now() - t0 };
  }
  return { ok: false, error: 'obs-start-timeout' };
}

async function status() {
  const cfg = readWsConfig();
  if (!cfg) return { ok: false, error: 'no-ws-config' };
  if (!(await portOpen(cfg.port))) return { ok: true, running: false, recording: false };
  try {
    const st = await call('GetRecordStatus');
    return { ok: true, running: true, recording: !!st.outputActive, timecode: String(st.outputTimecode || ''), bytes: Number(st.outputBytes || 0) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 起录。**必须重试**：obs-websocket 的端口在 OBS 还在初始化时就开了，
 *  这期间 StartRecord 会回 207（NotReady）——实测冷启动时就是这么失败的。 */
async function start() {
  const ens = await ensureRunning();
  if (!ens.ok) return { ok: false, error: ens.error, startedObs: false };
  const deadline = Date.now() + 25000;
  let lastErr = 'record-not-started';
  let tries = 0;
  while (Date.now() < deadline) {
    tries++;
    try {
      const st = await call('GetRecordStatus');
      if (st.outputActive) return { ok: true, already: true, startedObs: ens.started, tries };
      await call('StartRecord');
      await sleep(700);
      const st2 = await call('GetRecordStatus');
      if (st2.outputActive) return { ok: true, already: false, startedObs: ens.started, obsStartMs: ens.ms || 0, tries };
      lastErr = 'started-but-not-active';
    } catch (e) {
      lastErr = String((e && e.message) || e); // 常见就是 "207" = NotReady
    }
    await sleep(1200);
  }
  return { ok: false, error: lastErr, startedObs: ens.started, tries };
}

async function stop() {
  const cfg = readWsConfig();
  if (!cfg) return { ok: false, error: 'no-ws-config' };
  if (!(await portOpen(cfg.port))) return { ok: false, error: 'obs-not-running' };
  try {
    const st = await call('GetRecordStatus');
    if (!st.outputActive) return { ok: true, already: true, path: '' };
    const r = await call('StopRecord');
    const path0 = String((r && r.outputPath) || '');
    // StopRecord 的**应答先于**输出真正落盘完成（实测：应答之后 status 还会报 outputActive ≈1 秒）。
    // 不等它落定，"停了马上又喊开录"会被 start() 误判成 already=true（于是她说"本来就在录着啦"，
    // 而实际上刚才那段已经停了）——这是最坏的那类谎报。这里最多等 6 秒。
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      await sleep(300);
      try {
        const st2 = await call('GetRecordStatus');
        if (!st2.outputActive) break;
      } catch (e) {
        break; // 查不动了就当停了，别把好好的"停止成功"变成失败
      }
    }
    return { ok: true, already: false, path: path0 };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = {
  readWsConfig, findObsExe, portOpen, ensureRunning, status, start, stop, call,
  obsExeCandidates, WS_CFG,
};

/* 自测用：真正跑 node 时才有这一段（Electron 里 require 进来不会触发）。 */
if (require.main === module) {
  const action = (process.argv[2] || 'status').toLowerCase();
  const run = async () => {
    const cfg = readWsConfig();
    console.log('配置: ' + WS_CFG);
    const safe = cfg ? Object.assign({}, cfg, { password: cfg.password ? '(已设置, ' + cfg.password.length + ' 位)' : '(空)' }) : cfg;
    console.log('  ' + JSON.stringify(safe) + '   exe=' + (findObsExe() || '(没找到)'));
    if (action === 'status') console.log(JSON.stringify(await status()));
    else if (action === 'start') console.log(JSON.stringify(await start()));
    else if (action === 'stop') console.log(JSON.stringify(await stop()));
    else if (action === 'ensure') console.log(JSON.stringify(await ensureRunning()));
    else if (action === 'cycle') { console.log(JSON.stringify(await start())); console.log(JSON.stringify(await status())); console.log(JSON.stringify(await stop())); }
    else console.log('用法: node obs-ctl.js status|start|stop|ensure|cycle');
  };
  run().then(() => process.exit(0)).catch((e) => { console.log('失败: ' + ((e && e.message) || e)); process.exit(1); });
}
