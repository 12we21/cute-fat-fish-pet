/* dsh-pet local patches: cursor-broadcast@1 persona-ipc@1 music-ipc@5 desktop-ipc@4 local-keepalive@2 local-think-headroom@1 pc-ipc@4 voice-ipc@5 tts-ipc@2 cache-ipc@1 bridge-auth@1 voice-targets@1 */
/**
 * dsh-pet desktop helper —— Electron 主进程
 *
 * 职责：为**每只桌面宠物**开一个独立的局部小窗口（透明、置顶、不可激活），
 * 窗口 = 宠物包围盒 + 四周外扩余量（renderer 的 WINDOW_MARGIN_RATIO，为气泡/弹窗预留空间），
 * 宠物移动时 renderer 逐帧上报 bounds，本进程 setContentBounds 让窗口跟随宠物。
 *
 * 为什么是「局部小窗口」而不是「全屏透明画布」：全屏透明置顶窗会触发 Windows DWM 视频合成黑屏
 * （播放中的视频画面变黑、声音继续）。触发与窗口**绝对尺寸无关**，需四项齐备：透明置顶 + 非点击穿透
 * + 可聚焦且已聚焦 + **完整盖住视频窗**（98% 覆盖即安全；一个仅占屏幕 26% 的小窗同样能触发，issue #60
 * 的单变量实测矩阵）。本进程恰好会凑齐前三项——悬停宠物即整窗翻成可交互、show() 出去的窗口本就是
 * 聚焦的——而全屏画布又把第四项白送（必然完整遮挡非全屏播放的视频），故"不做全屏画布"的结论不变，
 * 只是理由换成这套条件；现有形态靠**默认整窗穿透 + 小窗几乎不可能完整遮挡视频窗**规避。
 * （旧注释写作"窗口不全屏就不黑"，那是把 0.1.x 的「全屏画布 → 每宠小窗」与输入模型改造这两件
 * 同时发生的事，混成了一个自变量。）
 * 输入：窗口默认**整窗点击穿透**（setIgnoreMouseEvents(true,{forward:true})），渲染端在光标
 * 进/出宠物身体命中区时经 pet:set-interactive 翻转可交互——透明像素不挡下层应用，
 * 与浏览器 overlay（仅 .dsh-pet-hit 可交互）严格对齐。
 *
 * 数据通道（bridge 模式，DSH_PET_BRIDGE=1 由宿主注入）：
 * 渲染端不再直连宿主 WebServer（DSH Desktop 2.0.3+ 的浏览器访问闸门会拦无令牌裸 HTTP）——
 * 本进程注册自定义 scheme `dsh-pet-bridge://`，protocol.handle 收到渲染端请求后
 * 经 stdin/stdout JSON 行协议转发宿主（helper-process.ts 的 BridgeHandler），
 * 宿主用与 HTTP 路由同一份 handlePetRoute 应答；素材应答带文件绝对路径，本进程读盘返回。
 * 无 DSH_PET_BRIDGE（手动 start-desktop / 开发流）时保持旧路径：渲染端直接 HTTP 访问宿主。
 *
 * 进程存亡（issue #56）：本进程的 stdout/stderr 是宿主给的管道，宿主一退出读端就消失（下一次写
 * 就是 EPIPE，而 Electron 默认处理器只会弹框且不退出）。故有「宿主存活」一节：管道守卫 +
 * 宿主 PID 探测，宿主没了就自己退——见那里的注释。
 *
 * 启动模式（issue #63）：若被以「纯 Node 模式」拉起（宿主透传了 ELECTRON_RUN_AS_NODE），内置
 * electron 模块不会注册，下面的 require 会失败——报一句能定位原因的话再退出，别只留 MODULE_NOT_FOUND。
 */
let electronApi;
try {
  electronApi = require('electron');
} catch (error) {
  process.stderr.write(
    '[dsh-pet helper] 启动失败：本进程被以「纯 Node 模式」拉起（ELECTRON_RUN_AS_NODE=' +
      JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null) +
      '）。该变量必须在 spawn 前删除（见 src/host/helper-process.ts 的 helperSpawnEnv），' +
      '运行期再删无效，设成空串会让 Electron 直接 abort。原始错误：' +
      (error instanceof Error ? error.message.split('\n')[0] : String(error)) +
      '\n',
  );
  process.exit(3);
}
const { app, BrowserWindow, ipcMain, screen, shell, protocol, session } = electronApi;
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const fsPromises = require('node:fs/promises');
// 点击穿透兜底通道的纯判定（不依赖 Electron 的 forward 鼠标钩子；见文件头注释）
const { decideWindowIgnore } = require('./pointer-target.js');
// 宿主存活判定（issue #56：宿主退出 → 管道断开 → 自己退，绝不弹框、绝不留僵尸）
const { HOST_POLL_MS, hostIsGone, isBrokenPipeError, parseHostPid } = require('./host-liveness.js');
// [local patch Z] OBS 录屏通道（obs-websocket）。单独一个文件是为了能用真正的 node 直接自测。
const obsCtl = require('./obs-ctl.js');

// 允许无用户手势直接播放（余额动画等）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 显式定名：Helper 是被 `electron.exe <main.js>` 直接拉起的，Electron 取不到 app 名会回落成
// "Electron"，userData 便落到 %APPDATA%\Electron —— 那是所有这么跑的 Electron 脚本的公共目录，
// 我们的 DPI 缓存与 Chromium profile 都会和别人混在一起。必须赶在任何 getPath('userData') 之前设。
app.setName('dsh-pet-electron-helper');

/** DPI 探测子进程模式：不建窗口，只把主屏 scaleFactor 打到 stdout 就退出（见 probePrimaryScale） */
const DPI_PROBE = process.env.DSH_PET_DPI_PROBE === '1';
/** 探测进程的输出标记（父进程按它抓值） */
const DPI_MARK = 'dsh-pet-primary-scale:';

// ---------- 宿主存活（issue #56）：管道断开 / 父进程消失 → 自己退出 ----------
//
// 【为什么必须自己退】宿主退出后，它在 helper 的 stdout/stderr 上握着的管道读端一起关闭；helper
// 下一次写（bridge 协议行 —— 渲染端每秒至少一条 /broadcast 轮询）拿到 EPIPE。未处理的 'error'
// 事件 = 未捕获异常，而 Electron 主进程自带的处理器只弹一个模态框、**且不退出**
// （lib/browser/init.ts 原文注释："Don't quit on fatal error"）—— 桌宠就此卡死、进程赖着不走。
// 真机实测（宿主存活、只切断 stdout 管道）：那次写之后主线程彻底停住，14 秒里一次心跳都没有，
// 进程也一直没有退出。
//
// 两条路都要有，缺一不可：
//   ① 管道守卫：任何一次写失败都不许变成异常；管道断开本身就是"宿主已死"的铁证 → 立刻退。
//      它只在**上层真的写**的时候才触发；
//   ② 宿主探测：每 HOST_POLL_MS 用 kill(pid, 0) 问一次宿主还在不在，ESRCH 即退。
//      渲染端崩了/根本没起来时一次写都不会发生，只有 ② 能收敛。
// 两条路都只经 exitForDeadHost()，且只退一次。
let hostGone = false;
/** 宿主没了 → 立刻退出。这里**不能**再打日志：管道已经断了，写只会再踩一次同一个错误 */
function exitForDeadHost() {
  if (hostGone) return;
  hostGone = true;
  app.exit(0); // 宿主消失是"环境要求我退"，不是自身崩溃，退出码 0
}

// ① 管道守卫：必须赶在**任何一次写**之前装上（probePrimaryScale 失败就会往 stderr 写）
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (isBrokenPipeError(error)) exitForDeadHost();
    // 其余流错误同样吞掉：Electron 的默认处理是弹模态框，任何流错误都不值得拿桌宠去换一个框
  });
}

// ② 宿主探测：DSH_PET_HOST_PID 由宿主 spawn 时注入；未注入/非法 → parseHostPid 给 0 → 不探测（不误退）。
// DPI 探测实例是一次性短命进程（它的父进程是 helper 而不是宿主），不参与这套机制。
const HOST_PID = parseHostPid(process.env.DSH_PET_HOST_PID);
if (!DPI_PROBE && HOST_PID > 0) {
  setInterval(() => {
    if (hostIsGone(HOST_PID)) exitForDeadHost();
  }, HOST_POLL_MS).unref?.();
}

// Windows 透明分层窗口（WS_EX_LAYERED）在 DWM 硬件加速合成下存在多处缺陷：
//   - 拖拽移动时窗口四周出现黑色边框（#37）
//   - 大透明窗移动覆盖小透明窗时，被覆盖窗口内容丢失（显示"消失"）
// 本进程只渲染轻量宠物动画（640×360），改走软件合成以规避上述缺陷，
// 不影响浏览器形态与主 DSH（独立进程）；非 Windows（macOS/Linux）合成路径不同，保留硬件加速。
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

// ---------- 全局 DPI 线性化（多显示器异构缩放的根因修复） ----------
//
// Windows 上 Chromium 的 DIP↔物理 换算是**逐显示器**的仿射变换，而且
// ScreenWin::DIPToScreenRect(hwnd, rect) 用的是「hwnd 当前归属屏」的那一组参数：
//   physical = (dip − D.dipOrigin) × D.scale + D.pixelOrigin
// 归属由 MonitorFromWindow(MONITOR_DEFAULTTONEAREST) 按面积占比决定，窗口骑缝时会反复翻转。
// 两屏缩放不同时，同一个 DIP 值在翻转前后落到不同物理位置、算出不同物理尺寸
// （实测 1.5/1.75 双屏：位置差 110px、924 DIP 宽的窗口尺寸差 231px），
// 于是 setContentBounds 每帧的落点在两套坐标系之间横跳 —— 这就是拖过屏缝时的「分身闪烁」，
// 也是两屏缩放一致时同样骑缝却毫无问题的原因。
//
// --force-device-scale-factor 让 Chromium 的 GetMonitorScaleFactors() 对所有显示器
// 直接返回同一个值，全部屏塌缩成**同一个**仿射变换 ⇒ DIPToScreenRect 的结果与窗口归属无关。
//
// 取值必须是 **1**，不能取主屏的 scaleFactor。实测（tools/probe-dpi.cjs，1.5 + 1.75 双屏）：
//   forced=1.5 → display.bounds 被二次缩放（主屏物理 3840 宽报成 1706 = 3840/1.5/1.5，
//                而同一块屏的 workArea 报 2560 = 3840/1.5，两者自相矛盾）。
//                DIPToScreenPoint 用 bounds.origin() 当 dipOrigin，于是
//                pixelOrigin(3840) ≠ dipOrigin(1706)×1.5，副屏多出 1281px 的**恒定**偏移——
//                比不加 switch 时的 75px 还糟。
//   forced=1   → bounds 与 workArea 一致，每块屏都满足 pixelOrigin == dipOrigin×scale，
//                DIP 与物理像素成为恒等映射，探针的 DELTA 全 0（尺寸差 231×151 也一并归零）。
// 所以这里锁死 1：坐标系 = Windows 物理像素，跨屏几何再无换算与舍入。
//
// 代价：宠物尺寸的单位从 DIP 变成物理像素，不补偿的话在 150% 的屏上会小 1/1.5。
// 用探测到的**真实主屏 scaleFactor** 乘进渲染端的 CONFIG.scale 抵掉（见 petScale()）——
// 主屏上的观感与修复前逐像素相同；其余屏改按主屏缩放渲染宠物（同尺寸同分辨率的两块屏上
// 物理大小反而一致了）。探测失败就整个不启用，退回修复前行为，不做没有补偿的缩放。
//
// 环境变量 DSH_PET_FORCE_DSF：'0' = 关闭本机制；其它正数 = 强制该值（排障用，会踩上面的 bug）。
//
// 取值时机是个麻烦：switch 必须在 app ready 之前设，而那时 screen 模块还不可用。
// 所以首次启动 spawn 一个自己的探测子进程（DSH_PET_DPI_PROBE=1，只打印 scaleFactor 就退出，
// ~0.5s）并把结果落盘；之后每次启动直接读缓存，零开销。

/** 主屏缩放缓存文件（userData 在 ready 前即可用） */
function dpiCacheFile() {
  return path.join(app.getPath('userData'), 'primary-scale.json');
}

function readCachedPrimaryScale() {
  try {
    const v = Number(JSON.parse(readFileSync(dpiCacheFile(), 'utf8')).scaleFactor);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0; // 首次启动/文件损坏：当作无缓存，重新探测
  }
}

function writeCachedPrimaryScale(value) {
  try {
    writeFileSync(dpiCacheFile(), JSON.stringify({ scaleFactor: value }), 'utf8');
  } catch (e) {
    console.error('[dsh-pet-desktop-helper] write dpi cache failed:', String(e && e.message ? e.message : e));
  }
}

/** 从探测子进程的输出里抓 scaleFactor（0 = 没抓到） */
function parseProbeOutput(text) {
  const m = new RegExp(DPI_MARK + '([0-9.]+)').exec(String(text || ''));
  const v = m ? Number(m[1]) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 拉起探测子进程读主屏 scaleFactor（同一个 electron + 同一个 main.js，走 DPI_PROBE 分支） */
function probePrimaryScale() {
  const opts = {
    env: { ...process.env, DSH_PET_DPI_PROBE: '1', DSH_PET_BRIDGE: '0', DSH_PET_SMOKE: '0' },
    timeout: 20000,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  let out = '';
  try {
    out = execFileSync(process.execPath, [__filename, '--dsh-pet-dpi-probe'], opts);
  } catch (e) {
    // 只认 stdout，不认退出码：一个不开窗口的 Electron 进程调 app.exit() 在 Windows 上
    // 偶发 0xC0000005（退出期访问违例），但那时值早就写出来了，丢掉它纯属浪费一次冷启动。
    out = e && e.stdout ? String(e.stdout) : '';
    if (!parseProbeOutput(out)) {
      const detail = [
        e && e.status !== undefined ? 'status=' + e.status : '',
        e && e.stderr ? 'stderr=' + String(e.stderr).trim().slice(0, 300) : '',
      ]
        .filter(Boolean)
        .join(' ');
      console.error(
        '[dsh-pet-desktop-helper] dpi probe failed:',
        String(e && e.message ? e.message : e).split('\n')[0],
        detail,
      );
      return 0; // 探测失败：不加 switch，退回修复前行为（多屏异构 DPI 会闪，但不影响可用性）
    }
  }
  const v = parseProbeOutput(out);
  if (v > 0) writeCachedPrimaryScale(v);
  return v;
}

/** 真实主屏 scaleFactor（探测所得；0 = 未知）。开启线性化后 screen API 只会报 1，只能靠它。 */
let PRIMARY_SCALE = 0;
/** 实际生效的强制缩放（0 = 未启用，坐标系维持修复前的逐屏 DIP） */
let FORCED_SCALE = 0;
if (!DPI_PROBE && process.env.DSH_PET_FORCE_DSF !== '0') {
  PRIMARY_SCALE = readCachedPrimaryScale() || probePrimaryScale();
  const override = Number(process.env.DSH_PET_FORCE_DSF);
  const forced = Number.isFinite(override) && override > 0 ? override : PRIMARY_SCALE > 0 ? 1 : 0;
  if (forced > 0) {
    app.commandLine.appendSwitch('force-device-scale-factor', String(forced));
    FORCED_SCALE = forced;
  }
}

/**
 * 渲染端的 CONFIG.scale：宿主给的基准 × 物理像素补偿。
 * 线性化开启后 1 逻辑像素 = 1 物理像素，宠物按主屏缩放放大回原来的观感。
 */
function petScale() {
  const base = Number(process.env.DSH_PET_SCALE || '1') || 1;
  return FORCED_SCALE > 0 && PRIMARY_SCALE > 0 ? base * (PRIMARY_SCALE / FORCED_SCALE) : base;
}

/** bridge 模式：DSH_PET_BRIDGE=1（宿主注入）。开启时注册 dsh-pet-bridge scheme + 管道转发 */
const BRIDGE = process.env.DSH_PET_BRIDGE === '1';
/** 协议行前缀（与 helper-process.ts 的 BRIDGE_PREFIX 一致） */
const BRIDGE_PREFIX = 'dsh-pet-bridge:';

if (BRIDGE) {
  // 自定义 scheme：standard（可解析 URL）+ secure（按 https 对待）+ supportFetchAPI（fetch 可用）
  // + stream（视频流）+ corsEnabled（让 CORS 规则生效，配合响应里的 ACAO 头放行 file:// 源页面）
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dsh-pet-bridge',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** 窗口表：petId -> BrowserWindow */
const windows = new Map();

/** win.id -> 上一次**请求**的内容区矩形（"x,y,w,h"）：pet:set-bounds 的去重基准，见那里的注释 */
const lastRequestedBounds = new Map();

/**
 * 宠物间碰撞 broker 状态：petId -> { x, y, vx, vy, size, bottomPad }。
 * 来源：pet:set-bounds（位置+尺寸+速度，随漫游/拖拽/静止保真上报，每帧一次）+
 *       pet:report-flight（飞行中每 ~30ms 高频补充速度）。
 * 任何更新都广播全量给所有窗口——每窗飞行方用它做跨窗碰撞检测（滞后 ≤ 1 帧，可接受）。
 */
const petStates = new Map();

/** 把当前全量宠物状态广播给所有窗口（碰撞检测的共享站场） */
function broadcastPetStates() {
  const states = {};
  for (const [pid, s] of petStates) {
    states[pid] = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, size: s.size, bottomPad: s.bottomPad };
  }
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send('pet:flight-states', states);
  }
}

/** 记录/更新一只宠物的状态并广播 */
function updatePetState(petId, partial) {
  const prev = petStates.get(petId) || { x: 0, y: 0, vx: 0, vy: 0, size: 0, bottomPad: 0 };
  petStates.set(petId, Object.assign({}, prev, partial));
  broadcastPetStates();
}

/**
 * 每窗口当前穿透状态（true = 整窗点击穿透）。所有 setIgnoreMouseEvents 只经本文件
 * （创建时初始化 + pet:set-interactive 翻转 + 光标兜底轮询），这里镜像真实状态，供冒烟断言/排查使用
 * （Electron 无 isIgnoringMouseEvents 取值 API）。
 */
const windowIgnore = new Map();

/** 翻转整窗穿透的**唯一出口**：状态与 windowIgnore 镜像永远一起更新（穿透期间保留 forward） */
function setWindowIgnore(win, ignore) {
  win.setIgnoreMouseEvents(ignore, { forward: true });
  windowIgnore.set(win.id, ignore);
}

/** 兜底通道的光标轮询间隔（ms，与 issue #55 报告者实测值一致） */
const POINTER_POLL_MS = 60;
/** 冒烟期间暂停兜底轮询：它按**真实光标**翻转 windowIgnore，会干扰冒烟对渲染端通道的断言 */
let pointerFallbackPaused = false;

/**
 * 每窗口「渲染端正拿着鼠标输入」标记（win.id → true/false），由渲染端经 `pet:input-busy` 上报。
 *
 * 为什么必须由渲染端说了算：兜底通道判定的是"光标与**窗口矩形**"的关系，而窗口矩形比宠物身体大
 * 一圈（四周各半只宠物的余量）。拖拽时宠物由 rAF 弹簧追赶光标、**滞后**于光标；甩得快时滞后量
 * 超过那一圈余量，光标就落在矩形外 → 判成"窗外" → 翻回穿透 → 渲染端正在拖拽的 window 级
 * pointermove/pointerup 全断（鼠标还按着，宠物却按旧速度"飞"出去，连松手都没人报）。
 *
 * 主进程**无法自行判断**这件事（光看光标位置和窗口位移分不清"拖拽跟手"与"漫游/抛掷"），
 * 而渲染端知道（拖拽中 / 菜单开着 / 对话弹窗开着）。所以只由它上报，busy 期间本进程绝不翻回穿透。
 */
const inputBusy = new Map();

/**
 * 桌面宠物列表（[{id,size}]）：宿主经 DSH_PET_PETS 透传（每只宠物一个窗口）。
 * 解析失败/未透传（手动 start-desktop）时回落到单个默认宠物窗口；renderer 首帧发来的
 * set-bounds 会按真实配置自校正尺寸与位置。
 */
function petsFromEnv() {
  try {
    const raw = process.env.DSH_PET_PETS || '';
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((p, i) => ({
        id: String(p?.id ?? `pet-${i}`),
        size: Number(p?.size) > 0 ? Number(p.size) : 462,
        index: i,
      }));
    }
  } catch {
    /* fallthrough */
  }
  return [{ id: 'main', size: 462, index: 0 }];
}

/** 窗口初始尺寸 = 宠物包围盒 + 四周外扩余量（4×0.5×size，与 renderer 的 WINDOW_MARGIN_RATIO 一致；
 *  renderer 首帧 set-bounds 会按真实配置精确覆盖，这里只是避免启动瞬间的尺寸跳变）。 */
function petWindowSize(size) {
  const height = (size * 9) / 16;
  const bottomPad = (size * (9 / 16) * (360 - 330)) / 360;
  const m = Math.round(size * 0.5);
  return { width: Math.round(size) + m * 2, height: Math.round(height + bottomPad) + m * 2 };
}

/**
 * 桌面几何：**逐显示器的工作区列表** + 它们的外接矩形 + 主屏下标。
 *
 * 外接矩形（hull）仍然是渲染端视口 VIEW 的来源——它只用作坐标系原点与比例换算基准。
 * 但所有边界判定（漫游落点 / 抛掷反弹 / 角落定位 / 菜单夹取）必须走 areas 的**并集**：
 * 显示器摆放不规则时 hull 里会有大片不属于任何屏的空洞，以 hull 为边界会把宠物放进去
 * （实测右倒 T 型双屏：hull 的 23.7% 是空洞，宠物飞进去就彻底看不见了）。
 */
function deskGeometry() {
  const displays = screen.getAllDisplays();
  const areas = displays.map((d) => ({
    x: d.workArea.x,
    y: d.workArea.y,
    width: d.workArea.width,
    height: d.workArea.height,
  }));
  // 每块屏的**完整面板**（含任务栏区）：抛掷的「越界侧有没有邻屏」探测用它，否则任务栏
  // 在接缝处挖出的工作区条带会被当成墙，宠物穿不过上下叠放的屏（见 shared/physics.ts）
  const panels = displays.map((d) => ({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
  }));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const a of areas) {
    x0 = Math.min(x0, a.x);
    y0 = Math.min(y0, a.y);
    x1 = Math.max(x1, a.x + a.width);
    y1 = Math.max(y1, a.y + a.height);
  }
  const primaryId = screen.getPrimaryDisplay().id;
  const primaryIndex = Math.max(
    0,
    displays.findIndex((d) => d.id === primaryId),
  );
  return { hull: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, areas, panels, primaryIndex };
}

function createPetWindows() {
  const geo = deskGeometry();
  const area = geo.hull;
  const configUrl = process.env.DSH_PET_CONFIG_URL || 'http://127.0.0.1:3080/dsh-pet-7340/config';
  const pets = petsFromEnv();
  const scale = petScale();
  for (const pet of pets) {
    // 初始窗口尺寸也要吃缩放补偿，否则启动瞬间会有一次可见的尺寸跳变
    const { width, height } = petWindowSize(pet.size * scale);
    const win = new BrowserWindow({
      width,
      height,
      x: area.x, // 初始左上角；renderer 首帧按配置角落/位置校正
      y: area.y,
      show: false,
      useContentSize: true,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      // 可聚焦：对话输入框/菜单需要窗口焦点才能打字（focusable:false 会让输入框永远无法聚焦）。
      // 别把这里当成黑屏的无关项：可聚焦 + 已聚焦本身就是 DWM 视频黑屏的四项触发条件之一（见文件头），
      // 而 show() 出来就是聚焦状态——真正在挡的是「默认整窗穿透」+「小窗几乎不可能完整遮挡视频窗」
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        paintWhenInitiallyHidden: false,
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 窗口被其他窗口（另一只宠物）完全遮挡时，Chromium 默认会暂停本窗口渲染，
    // 导致大宠物移动盖过小宠物时小宠物显示为"消失"。关闭后台节流，让被遮挡
    // 窗口持续渲染，移开遮挡后立刻恢复显示。
    win.webContents.setBackgroundThrottling(false);
    // 屏蔽 Electron 默认右键菜单：右键菜单由渲染端统一自绘组件弹出（两端一致），绝无双菜单
    win.webContents.on('context-menu', (event) => event.preventDefault());
    // 页面级缩放 = petScale()（渲染端 CONFIG.scale 的同一来源）：整窗内容统一放大，渲染端坐标系
    // 回到 CSS 像素——右键菜单/积分弹窗/聊天框等固定 px UI 随之恢复 DIP 观感，不再逐处补偿
    // （见 DESIGN.md §3.5；跨进程交换仍走物理像素，由渲染端 toScreen/toLocal 收口）。
    // webPreferences.zoomFactor 对 show:false 的窗口不生效（实测），须在加载完成后设置。
    win.webContents.on('did-finish-load', () => {
      win.webContents.setZoomFactor(scale);
    });
    // 默认整窗点击穿透（renderer 在光标进/出身体命中区时经 IPC 翻转可交互）；
    // forward:true 保证穿透期间 mousemove 仍转发进渲染端做命中判定。
    setWindowIgnore(win, true);
    win.once('ready-to-show', () => win.show());
    // [#55 兜底显示] paintWhenInitiallyHidden:false 时渲染器可能不产出首帧，ready-to-show 便永不触发
    // （Electron 文档原文：ready-to-show "will never fire if you use paintWhenInitiallyHidden: false"），
    // 而 show() 只挂在它上面 → 窗口永远隐藏（进程活着、宠物逻辑照跑，桌面上什么都没有）。
    // 页面加载完成后强制兜底一次；zoomFactor 的设置在更早注册的 did-finish-load 里，顺序不受影响。
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.show();
      }, 400);
    });
    // [#55 兜底交互] 上面的翻转链路只有「Electron forward 鼠标钩子 → 渲染端命中判定」一个入口，
    // 该钩子在 Windows 上可能静默失效（回调超时被系统摘掉 / 被别的软件钩子干扰）→ 光标悬浮无反应、
    // 拖不动、点击与右键全废。这里由主进程按**真实光标位置**独立判定，不依赖那条转发链路：
    // 与 renderer 那条通道并存且判定区域一致（状态未变不翻转），转发正常的环境行为完全不变。
    //
    // 唯一不可自行决定的事：**渲染端正拿着鼠标输入时不得翻回穿透**（见 inputBusy）。
    // 本进程无从判断这件事——光看光标位置与窗口位移分不清"拖拽跟手"和"漫游/抛掷"，所以由渲染端上报。
    // [local patch F] 光标位置广播：渲染端只有指针悬停命中区时才收得到 mousemove，
    // 「鼠标接近时看向鼠标」需要全屏光标位置，所以复用同一个 60ms 定时器把真实光标推给渲染端
    // （screen.getCursorScreenPoint() 与 win.getBounds() 同为 CSS/DIP 系，渲染端不再 ÷scale）。
    const lastCursor = { x: NaN, y: NaN };
    const pushCursor = () => {
      if (win.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      if (p.x === lastCursor.x && p.y === lastCursor.y) return; // 没动就不发，省 IPC
      lastCursor.x = p.x;
      lastCursor.y = p.y;
      win.webContents.send('pet:cursor', { x: p.x, y: p.y });
    };
    const pointerTimer = setInterval(() => {
      pushCursor(); // 不受 pointerFallbackPaused 影响：菜单/弹窗开着时也要能看向光标
      if (pointerFallbackPaused || win.isDestroyed()) return;
      const b = win.getBounds();
      if (b.width < 8 || b.height < 8) return; // 尺寸还没落定（renderer 首帧上报前）
      const ignoring = windowIgnore.get(win.id) !== false;
      const next = decideWindowIgnore(b, screen.getCursorScreenPoint(), ignoring, inputBusy.get(win.id) === true);
      if (next !== ignoring) setWindowIgnore(win, next);
    }, POINTER_POLL_MS);
    win.on('closed', () => {
      clearInterval(pointerTimer);
      windows.delete(pet.id);
      lastRequestedBounds.delete(win.id);
      windowIgnore.delete(win.id);
      inputBusy.delete(win.id);
    });
    win
      .loadFile('index.html', {
        query: {
          configUrl,
          bridge: BRIDGE ? '1' : '0',
          scale: String(scale),
          petIndex: String(pet.index),
          workAreaW: String(area.width),
          workAreaH: String(area.height),
          workAreaX: String(area.x),
          workAreaY: String(area.y),
          // 逐屏工作区（屏幕坐标）+ 主屏下标：渲染端所有边界判定走它们的并集，不走外接矩形。
          // 首帧就要用（position() 定角落），所以走 query；运行期变化再经 pet:displays 推送。
          areas: JSON.stringify(geo.areas),
          // 逐屏完整面板（含任务栏区）：抛掷越界侧探测用（任务栏条带不当墙，见 shared/physics.ts）
          panels: JSON.stringify(geo.panels),
          primaryIndex: String(geo.primaryIndex),
        },
      })
      .catch((error) => {
        console.error(`[dsh-pet-desktop-helper] page load failed (${pet.id}):`, error);
        win.destroy();
      });
    windows.set(pet.id, win);
  }
}

// ---------- bridge 协议（渲染端 custom scheme → 本进程 → 宿主 stdout JSON 行 + 本地回调） ----------
// 渲染端的每个 fetch 都落到 dsh-pet-bridge://，protocol.handle 把请求以一行 JSON 写 stdout 转发宿主。
// 宿主应答**不走近 0 号管道**：Electron 主进程在 Windows 上收不到 piped stdin（electron#4218），
// 所以本进程开一个 127.0.0.1 随机端口 HTTP 回调（DSH 闸门只拦 DSH WebServer 路由，管不到这里）；
// 请求行携带回调 URL，宿主处理完 POST 应答回来，按 id 唤醒等待中的请求。
// 素材（webm/字体/光标）：宿主只回文件绝对路径，本进程自行读盘应答（二进制不过管道）。
// 协议行统一前缀 BRIDGE_PREFIX，宿主侧按前缀区分协议与日志（console 输出也走 stdout）。

let bridgeSeq = 0;
/** id -> {resolve, reject}：一个请求对应宿主的一次回调应答 */
const bridgePending = new Map();
let bridgeCallbackUrl = '';

/** 渲染端请求 → 宿主（请求行带回调 URL）；返回宿主应答（{status, contentType?, body?, file?}），超时抛错 */
function bridgeRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const id = ++bridgeSeq;
    bridgePending.set(id, { resolve, reject });
    process.stdout.write(BRIDGE_PREFIX + JSON.stringify({ id, method, url, body, cb: bridgeCallbackUrl }) + '\n');
    // 宿主若长期不应答（进程退出/宿主动作挂起）不无限挂起：45s 兜底（LLM 生成最长 30-60s）
    setTimeout(() => {
      const p = bridgePending.get(id);
      if (!p) return;
      bridgePending.delete(id);
      p.reject(new Error('bridge request timeout'));
    }, 45000).unref?.();
  });
}

/** 把宿主回调应答（{id, status, ...}）派发给对应请求 */
function bridgeResolve(resp) {
  const p = resp && bridgePending.get(resp.id);
  if (!p) return;
  bridgePending.delete(resp.id);
  p.resolve(resp);
}

/** 本地回调服务器：宿主把应答 POST 到这里（127.0.0.1 随机端口，绕开 stdin/DSH 闸门） */
function startBridgeCallback() {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/respond') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('dsh-pet: not found');
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        bridgeResolve(JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('dsh-pet: bad payload');
      }
    });
    req.on('error', () => {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('dsh-pet: bad payload');
    });
  });
  server.on('error', (e) => {
    console.error('[dsh-pet-desktop-helper] bridge callback server error:', String(e && e.message ? e.message : e));
  });
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    bridgeCallbackUrl = 'http://127.0.0.1:' + (addr && typeof addr === 'object' ? addr.port : 0) + '/respond';
    console.error('[dsh-pet-desktop-helper] bridge callback: ' + bridgeCallbackUrl);
  });
  return server;
}

/* [local patch O] 控制桥：给独立版控制台（<安装目录>\launcher）一个固定端口的本地口子。
 * 为什么需要它：权限、语音模式、活跃度、本地文本模型这些状态都躺在渲染进程的 localStorage 里，
 * 外部进程够不着；helper 自己的 IPC 又只有渲染端能用（preload 的 contextBridge）。
 * 这里只在 127.0.0.1 上开一个小服务：GET /state 读回 /set 写单个白名单键（可顺带 reload 让它生效）。
 * 端口从 3099 起顺延，落盘 $DSH_HOME/dsh-pet/helper-control.json 供控制台发现。
 *
 * [bridge-auth@1] 鉴权 + CORS 白名单（安全加固）。修的是什么：原来这个口子只有「监听 127.0.0.1」这一层
 * 保护，而 127.0.0.1 拦不住浏览器里的任意网页——访问一个恶意站点，它的 JS 就能对着 3099..3110 发
 * POST /set，静默改掉她的权限/人设/模型（这正是「任何网页都能遥控用户的电脑」那个洞）。现在：
 *   1. 密钥：helper-control.json 里除 port/pid/at 外多一个 token（crypto.randomBytes 24B → hex 48 字符，
 *      0600 写入）。/state /set 必校验，比较走 timingSafeEqual（长度不等直接 401，不泄漏逐字节差异）；
 *      缺失或不符 → 401，且**不写 localStorage、不 reload**。向后兼容只指「老控制台忽略这个新字段」，
 *      没留免鉴权后门：老控制台现在会拿到 401，只能跟着升级（见 launcher\pet-api.js 的 readToken）。
 *   2. /health 是纯进程存活探测（**故意不含任何私有数据**），留着不鉴权，控制台才能靠它发现端口并
 *      报「桌宠没在跑」；真正的状态和写入全在鉴权之后。
 *   3. CORS：不再无条件 '*'。file:// 页面（Origin 为 "null" 或缺失，控制台就是这么发的）和本机回环
 *      （http://127.0.0.1|localhost[:port]）回显该 Origin + Vary: Origin + 方法/头声明；其它 Origin 一个
 *      CORS 头都不回，并直接 403 挡掉（而不是"先执行再等浏览器拦响应"）。
 *      curl / 本机脚本这类**没有 Origin** 的请求没有 CORS 语义（浏览器之外的客户端根本不受 CORS 约束），
 *      照旧可用 ⇒ 鉴权靠 token，不靠 Origin。OPTIONS 预检免鉴权放行（它不读也不写）。
 *   4. 写键正则收紧了点号族：原来 [a-z]+ 允许 "__dsh-pet-a-x" 这种键名，可能蹭到渲染端的原型链。 */
const CONTROL_PORT_BASE = 3099;
const CONTROL_KEY_RE = /^dsh-pet-[a-z][a-z-]*-[A-Za-z0-9_-]{1,64}$/;
function startControlBridge() {
  const http = require('node:http');
  const fsSync = require('node:fs');
  const pathMod = require('node:path');
  const os = require('node:os');

  const liveWindows = () => {
    const out = [];
    for (const [id, w] of windows) if (w && !w.isDestroyed()) out.push([id, w]);
    return out;
  };
  const pickWc = (id) => {
    const list = liveWindows();
    if (id) {
      const hit = list.find(([pid]) => pid === id);
      if (hit) return hit[1].webContents;
    }
    return list.length ? list[0][1].webContents : null;
  };

  const readAll = async (id) => {
    const wc = pickWc(id);
    if (!wc) return {};
    try {
      const raw = await wc.executeJavaScript(
        '(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^dsh-pet-/.test(k)) o[k] = localStorage.getItem(k); } return JSON.stringify(o); })()',
      );
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  const writeKey = async (id, key, value, reload) => {
    const wc = pickWc(id);
    if (!wc) return { ok: false, reason: 'no-window' };
    try {
      await wc.executeJavaScript(
        `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))}); true;`,
      );
    } catch (e) {
      return { ok: false, reason: 'write-failed', message: String(e && e.message ? e.message : e) };
    }
    // 渲染进程只在启动时把 localStorage 读进内存（sprite.js hookPcActions/hookVoiceMode 都只读一次），
    // 所以写盘之后要重载才真的生效 —— 这一步是"改权限/语音立刻管用"的关键。
    if (reload) for (const [, w] of liveWindows()) w.webContents.reload();
    return { ok: true, key, reloaded: !!reload };
  };

  // [bridge-auth@1] CORS 白名单：只认控制台（file:// ⇒ Origin "null" 或缺失）与本机回环页面。
  const corsOk = (origin) => {
    if (!origin || origin === 'null') return true; // file:// 控制台 / 无 Origin 的本机脚本
    try {
      const o = new URL(origin);
      const host = o.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      return (o.protocol === 'http:' || o.protocol === 'https:') && (host === '127.0.0.1' || host === 'localhost' || host === '::1');
    } catch {
      return false;
    }
  };

  // 认识的来源才回 CORS 头；Origin 是 "null" 要回显成 "null"（回 '*' 浏览器当场拒收），
  // 缺失（curl / 本机脚本）就别无中生有。Vary 让中间的缓存别把两家的应答混起来。
  const send = (res, code, obj, origin) => {
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    if (corsOk(origin)) {
      headers['access-control-allow-origin'] = origin || 'null';
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers['access-control-allow-headers'] = 'content-type, authorization, x-pet-token';
      headers.vary = 'Origin';
    }
    res.writeHead(code, headers);
    res.end(JSON.stringify(obj));
  };

  // [bridge-auth@1] 共享密钥。落盘在 helper-control.json（跟 port 同一个文件，控制台本来就要读它）：
  // 已经有过就沿用（控制台随时可以重读），没有就生成一个 hex 48 字符的随机串写回去。内存里缓存住，
  // 免得每次请求都读盘——控制台改的是同一个文件，不会动 token 字段。写盘用 0600：这是唯一的凭据。
  let controlToken = '';
  const loadToken = () => {
    try {
      const rec = JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
      if (rec && typeof rec.token === 'string' && rec.token) return rec.token;
    } catch {
      /* 文件不存在 / 不是 JSON —— 当作没有，下面生成 */
    }
    const token = require('node:crypto').randomBytes(24).toString('hex');
    try {
      fsSync.mkdirSync(pathMod.dirname(statePath), { recursive: true });
      fsSync.writeFileSync(statePath, JSON.stringify({ port: CONTROL_PORT_BASE, pid: process.pid, at: Date.now(), token }, null, 2), { mode: 0o600 });
    } catch (e) {
      // 写不进去就等于控制台读不到 token：宁可让这条口子不可用，也绝不放行无凭据的写。
      console.error('[dsh-pet-desktop-helper] control bridge: 密钥写不进 ' + statePath + ': ' + String(e && e.message ? e.message : e));
    }
    return token;
  };

  /** 恒定时间比对（长度先不等就直接否，别让长度差异走到 timingSafeEqual 去抛异常）。 */
  const tokenOk = (got) => {
    if (!controlToken || typeof got !== 'string' || !got) return false;
    const a = Buffer.from(got);
    const b = Buffer.from(controlToken);
    return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
  };

  /** 从 Authorization: Bearer <token> / X-Pet-Token 取凭据。 */
  const tokenFrom = (req) => {
    const auth = String(req.headers.authorization || '');
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
    return String(req.headers['x-pet-token'] || '').trim();
  };

  /** 鉴权闸门（CORS 已在路由前判过）：OPTIONS 预检免鉴权，其余读也需要凭据。 */
  const security = (req, res, origin) => {
    if (req.method === 'OPTIONS') {
      send(res, 204, {}, origin); // 预检：不读也不写，放行但不鉴权
      return false;
    }
    if (!tokenOk(tokenFrom(req))) {
      // 到此为止：不写 localStorage、不 reload。
      send(res, 401, { ok: false, reason: 'unauthorized', message: '缺少或错误的控制密钥：读 ' + statePath + ' 里的 token，用 Authorization: Bearer <token> 或 X-Pet-Token 带上' }, origin);
      return false;
    }
    return true;
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const origin = String(req.headers.origin || '');
      // CORS 在路由之前判：恶意来源的写请求不该先落盘、再指望浏览器去拦响应。
      if (!corsOk(origin)) {
        return void send(res, 403, { ok: false, reason: 'forbidden-origin', message: '不认识的来源：控制桥只服务控制台与本机回环页面' }, origin);
      }
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        // /health 故意免鉴权：只报「我活着 + 窗口数」，不含任何私有状态，控制台靠它发现端口。
        if (u.pathname === '/health') {
          return send(res, 200, { ok: true, mode: 'helper-control', pid: process.pid, windows: liveWindows().length, auth: !!controlToken }, origin);
        }
        if (u.pathname === '/state') {
          if (!security(req, res, origin)) return;
          return send(res, 200, { ok: true, pid: process.pid, state: await readAll(u.searchParams.get('pet') || '') }, origin);
        }
        if (u.pathname === '/set' && req.method === 'POST') {
          if (!security(req, res, origin)) return;
          const body = JSON.parse(raw || '{}');
          const key = String(body.key || '');
          // 显式挡住 __proto__ 之类：正则已经不容许这些字符，这里再钉死一次（防御性，不靠单一层）。
          if (!CONTROL_KEY_RE.test(key) || key.includes('__proto__')) return send(res, 400, { ok: false, reason: 'bad-key', key }, origin);
          return send(res, 200, await writeKey(String(body.pet || ''), key, body.value, body.reload !== false), origin);
        }
        // 未匹配到路由也别对恶意来源张口：上面的 CORS 判定已经把它们挡在外面了。
        return send(res, 404, { ok: false, reason: 'not-found' }, origin);
      } catch (e) {
        return send(res, 500, { ok: false, reason: 'error', message: String(e && e.message ? e.message : e) }, origin);
      }
    });
  });

  const statePath = pathMod.join(
    process.env.DSH_HOME || pathMod.join(os.homedir(), '.dsh'),
    'dsh-pet',
    'helper-control.json',
  );
  // [bridge-auth@1] 先把密钥落盘再开始监听：控制台一发现端口，就已经能拿到 token 发请求了。
  controlToken = loadToken();
  const tryListen = (port, left) => {
    server.once('error', () => {
      if (left > 0) setTimeout(() => tryListen(port + 1, left - 1), 60);
      else console.error('[dsh-pet-desktop-helper] control bridge: 端口都被占了，控制台改不了权限/语音');
    });
    server.listen(port, '127.0.0.1', () => {
      try {
        fsSync.mkdirSync(pathMod.dirname(statePath), { recursive: true });
        fsSync.writeFileSync(statePath, JSON.stringify({ port, pid: process.pid, at: Date.now(), token: controlToken }, null, 2), { mode: 0o600 });
      } catch {
        /* 写不了就算了：控制台会自己从 3099 往上扫 */
      }
      console.error('[dsh-pet-desktop-helper] control bridge: http://127.0.0.1:' + port);
    });
  };
  tryListen(CONTROL_PORT_BASE, 10);
  return server;
}

/** 处理一个渲染端请求：拼宿主请求行 → 等应答 → 组装 Response（素材读盘） */
async function handleBridgeRequest(request) {
  const url = new URL(request.url); // dsh-pet-bridge://dsh-pet/dsh-pet-7340/...
  const method = request.method || 'GET';
  let body;
  if (method === 'POST' || method === 'PUT') {
    body = await request.text();
  }
  const resp = await bridgeRequest(method, url.pathname + url.search, body);
  const headers = { 'access-control-allow-origin': '*' }; // 渲染端页面是 file:// 源，scheme 跨源需 CORS
  if (resp.contentType) headers['content-type'] = resp.contentType;
  if (resp.file) {
    // 素材：直接读盘返回（宿主已解析好绝对路径；带 range 让视频能拖动进度条）
    try {
      const data = await fsPromises.readFile(resp.file);
      return new Response(new Uint8Array(data), { status: resp.status || 200, headers });
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] bridge file read failed:', resp.file, e);
      return new Response('dsh-pet: asset read failed', { status: 500, headers });
    }
  }
  return new Response(resp.body ?? '', { status: resp.status || 200, headers });
}

app.whenReady().then(() => {
  // 探测子进程：此时没有 force-device-scale-factor，读到的是 Windows 的真实主屏缩放。
  // 退出推迟一拍——在 ready 回调里直接 app.exit() 会赶在 stdout 落盘前拆掉进程
  if (DPI_PROBE) {
    process.stdout.write(DPI_MARK + screen.getPrimaryDisplay().scaleFactor + '\n');
    setTimeout(() => app.exit(0), 0);
    return;
  }
  console.error(
    '[dsh-pet-desktop-helper] displays: ' +
      JSON.stringify(deskGeometry()) +
      ' forcedScaleFactor=' +
      (FORCED_SCALE || 'off') +
      ' primaryScale=' +
      (PRIMARY_SCALE || 'unknown') +
      ' petScale=' +
      petScale(),
  );

  if (BRIDGE) {
    // 自定义 scheme 接住渲染端全部请求（配置/余额/碎碎念/广播/素材）
    protocol.handle('dsh-pet-bridge', (request) =>
      handleBridgeRequest(request).catch((e) => {
        console.error('[dsh-pet-desktop-helper] bridge handler error:', String(e && e.message ? e.message : e));
        return new Response('dsh-pet: bridge error', {
          status: 502,
          headers: { 'access-control-allow-origin': '*' },
        });
      }),
    );
    startBridgeCallback(); // 宿主应答回调服务器（stdin 在 Electron 主进程不可用，改走本地 HTTP）
    startControlBridge(); // [local patch O] 控制台专用控制桥（权限 / 语音模式等 localStorage 状态）
  }

  createPetWindows();

  // 宠物窗口跟随：renderer 逐帧上报窗口内容区位置/尺寸
  /* [local patch I] 人设落盘：桌宠侧没有别的写配置通道，而 host 每次请求都会重读
 * $DSH_HOME/dsh-pet/main-config.json 顶层 whisperPrompt（= 碎碎念/对话的人设 system）。
 * 只改这一个键：读 → JSON.parse → 改 → 临时文件 → 覆盖；写前留一份 .persona-bak，写后复验。
 * 解析失败或复验不过一律返回 ok:false —— 绝不把用户配置写坏，也绝不假装成功。 */
ipcMain.handle('pet:set-persona', (event, payload) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const file = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-pet', 'main-config.json');
  try {
    if (!fs.existsSync(file)) return { ok: false, error: 'config not found: ' + file };
    const text = fs.readFileSync(file, 'utf8');
    const cfg = JSON.parse(text);
    const next = payload && typeof payload.prompt === 'string' && payload.prompt.length ? payload.prompt : null;
    const cur = typeof cfg.whisperPrompt === 'string' ? cfg.whisperPrompt : null;
    if (cur === next) return { ok: true, changed: false, file };
    if (!fs.existsSync(file + '.persona-bak')) fs.writeFileSync(file + '.persona-bak', text, 'utf8');
    if (next === null) delete cfg.whisperPrompt;
    else cfg.whisperPrompt = next;
    const tmp = file + '.persona-tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
    const check = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = typeof check.whisperPrompt === 'string' ? check.whisperPrompt : null;
    return now === next ? { ok: true, changed: true, file } : { ok: false, error: 'verify failed after write' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* [local patch J] 唱歌的数据端（都在主进程做，渲染端只拿结果）：
 *  - pet:now-playing：PowerShell 枚举「有可见窗口的进程」，从已知音乐软件的窗口标题里取
 *    「歌名 - 歌手」。查不到就如实 ok:false（不猜、不编）。
 *  - v7 起**不再取歌词**：她改为自己现编词（本机模型），所以这里只剩「当前在放什么歌」
 *    这一条只读通道，没有任何外网请求（原来那条联网找歌词的路已整条删掉）。 */
const MUSIC_APPS = ['cloudmusic', 'qqmusic', 'kugou', 'kwmusic', 'kuwo', 'spotify', 'itunes', 'foobar2000', 'aimp', 'musicbee', 'potplayer', 'netease'];
const PS_WINDOWS = "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + [char]9 + $_.MainWindowTitle }";
function psExe() {
  const fsx = require('node:fs');
  const p = require('node:path').join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fsx.existsSync(p) ? p : 'powershell.exe';
}
function psWindows() {
  try {
    const out = execFileSync(psExe(), ['-NoProfile', '-NonInteractive', '-Command', PS_WINDOWS], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const wins = String(out)
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .filter((p) => p.length >= 2 && p[0] && p[1])
      .map((p) => ({ app: p[0].trim(), title: p.slice(1).join('\t').trim() }));
    return { ok: true, wins };
  } catch (e) {
    // 关键：绝不能把"枚举失败"伪装成"没有音乐软件"（那会让用户以为没开歌，其实是探测本身坏了）
    return { ok: false, error: String((e && e.message) || e).split('\n')[0] };
  }
}
function parseTrack(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  const parts = t.split(' - ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { track: parts[0], artist: parts[1] };
  return { track: t, artist: '' };
}
ipcMain.handle('pet:now-playing', () => {
  const r = psWindows();
  if (!r.ok) return { ok: false, error: 'window-enum-failed', detail: r.error };
  const hit = r.wins.find((w) => MUSIC_APPS.some((k) => w.app.toLowerCase().indexOf(k) >= 0));
  if (!hit) return { ok: false, error: 'no-music-app', windows: r.wins.length };
  const info = parseTrack(hit.title) || { track: hit.title, artist: '' };
  return { ok: true, app: hit.app, title: hit.title, track: info.track, artist: info.artist };
});
/* [local patch K] 自主说话 / 逗桌面图标 —— 数据端。
 * 安全红线（写死在代码里，test-safety.mjs 会静态断言）：
 *   桌面**只读枚举**（readdirSync + lstatSync），永不写、删、改、移动、复制、重命名、执行任何文件或应用。
 * 语录生成走**本地 Ollama**（不经过 host 的 /chat）：不污染她的对话记忆、不花 API 余额。
 * 模型名/地址复用屏幕监测的 state.json，保持单一事实来源。 */
ipcMain.handle('pet:desktop-items', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dirs = [path.join(os.homedir(), 'Desktop'), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  const items = [];
  const errors = [];
  for (const dir of dirs) {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true }); // 只读
    } catch (e) {
      errors.push(String((e && e.message) || e));
      continue;
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.toLowerCase() === 'desktop.ini') continue;
      const full = path.join(dir, e.name);
      let st = null;
      try {
        st = fs.lstatSync(full); // 只读
      } catch (e) {
        /* 拿不到元信息也不影响 */
      }
      const ext = path.extname(e.name).toLowerCase();
      items.push({
        name: e.name,
        ext,
        kind: e.isDirectory() ? 'folder' : ext === '.lnk' || ext === '.url' ? 'shortcut' : 'file',
        size: st && !e.isDirectory() ? st.size : 0,
        mtime: st ? Math.round(st.mtimeMs) : 0,
      });
      if (items.length >= 60) break;
    }
  }
  return items.length || !errors.length ? { ok: true, items, errors } : { ok: false, error: errors[0] };
});

/* ---------------------------------------------------------------- [local patch E6]
 * 文本大脑「可切换」+ 出话前「腾显存」。
 *
 * 为什么必须这么做（全部是实测，脚本在 dshpet-capture/）：
 *   本机显卡 10GB（AMD RX 6750 GRE / Ollama 走 Vulkan 后端）。两个模型**同时常驻**时，
 *   deepseek-r1:8b(4.77GB) + qwen2.5vl:3b(2.55GB)，8B 从 **42 tok/s 崩到 1.8 tok/s**（25 倍），
 *   一句话要 100+ 秒 —— 主人看到的「点了她、跟她说话都不理我」就是这个（probe-decisive2.cjs）。
 *   而**只把视觉模型卸掉**（keep_alive:0，实测 0.1 秒），8B 立刻回到 **42 tok/s**，
 *   而且不需要重新加载 8B 本身（probe-yield-vram.cjs，反复切换都稳定）。
 *   ⇒ 所以出话之前先请视觉模型让出显存；说完不管它，下次看屏幕时 host 会自己把视觉模型装回来（约 28s）。
 *   顺带：文本模型本身可以在菜单里换（pet:list-models 列出本机装了哪些），这就是"自主切换"。
 * 想关掉腾显存：环境变量 DSH_PET_YIELD_VRAM=0，或渲染端传 yieldVram:false。 */
const PET_OLLAMA_BASE = String(process.env.DSH_PET_OLLAMA || 'http://127.0.0.1:11434').replace(/\/+$/, '');
function petOllamaCall(pathname, opts) {
  const http = require('node:http');
  const o = opts && typeof opts === 'object' ? opts : {};
  return new Promise((resolve) => {
    let data = null;
    if (o.body !== null && o.body !== undefined) {
      try { data = JSON.stringify(o.body); } catch (e) { return resolve({ ok: false, error: 'bad-body' }); }
    }
    const headers = data === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    const req = http.request(PET_OLLAMA_BASE + pathname, { method: o.method || 'GET', headers, timeout: Number(o.timeoutMs) || 4000 }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d || '{}');
          const good = res.statusCode >= 200 && res.statusCode < 300;
          resolve(good ? { ok: true, json: j } : { ok: false, error: 'http-' + res.statusCode, json: j });
        } catch (e) { resolve({ ok: false, error: 'bad-json' }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
    if (data !== null) req.write(data);
    req.end();
  });
}

// 本机装了哪些模型 / 现在常驻哪些（右键菜单用它列选项；**只读**，不改任何东西）
ipcMain.handle('pet:list-models', async () => {
  const [tags, ps] = await Promise.all([petOllamaCall('/api/tags'), petOllamaCall('/api/ps')]);
  const models = ((tags.json && tags.json.models) || [])
    .map((m) => ({ name: String((m && m.name) || ''), size: Number(m && m.size) || 0 }))
    .filter((m) => m.name);
  const loaded = ((ps.json && ps.json.models) || []).map((m) => String((m && m.name) || '')).filter(Boolean);
  if (!models.length) return { ok: false, error: tags.error || 'ollama-unreachable' };
  return { ok: true, models, loaded };
});

ipcMain.handle('pet:local-quip', async (event, payload) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const http = require('node:http');
  let model = 'qwen2.5vl:3b';
  let visionModel = 'qwen2.5vl:3b'; // [local patch E6] 「看屏幕用的那个」= 腾显存时要让位的对象
  let quipModel = ''; // [local patch E6] state.json 里指定的「说话模型」（默认 deepseek-r1:8b）
  let api = 'http://127.0.0.1:11434';
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    const st = JSON.parse(fs.readFileSync(path.join(home, 'dsh-pet', 'screen-watch', 'state.json'), 'utf8'));
    if (typeof st.localModel === 'string' && st.localModel) { model = st.localModel; visionModel = st.localModel; }
    // 语录是纯文本任务：state.json 里写了 quipModel 就用它（例如 deepseek-r1:8b），比视觉模型更会说话
    if (typeof st.quipModel === 'string' && st.quipModel) { quipModel = st.quipModel; model = st.quipModel; }
    if (typeof st.localApi === 'string' && st.localApi) api = st.localApi;
  } catch (e) {
    /* 读不到就用默认 */
  }
  // [local patch E6] 渲染端（右键菜单）刚点的文本模型优先级最高——它比 state.json 更新。
  // 特殊值：'__share__' = 「只用一个模型（和看屏幕共用）」：文本也用看屏幕那个（它一定装着），且不必腾显存；
  //         '__auto__'  = 「自动择优」：**要脑子**的活（AI 导演那段 JSON，预算 ≥400）交给 quipModel（R1 8B），
  //                       短句（碎碎念/对话，预算 80）交给看屏幕那个模型（它已经在显存里，0.3 秒就出来）。
  const asked = payload && typeof payload.model === 'string' ? payload.model.trim() : '';
  const askedBudget = Math.max(16, Math.min(1200, Number(payload && payload.numPredict) || 80));
  const shareOne = asked === '__share__';
  if (asked === '__auto__') model = askedBudget >= 400 ? (quipModel || visionModel) : visionModel;
  else if (asked && !shareOne) model = asked;
  if (shareOne && visionModel) model = visionModel;
  const prompt = String((payload && payload.prompt) || '');
  const system = String((payload && payload.system) || '');
  if (!prompt) return { ok: false, error: 'empty-prompt' };
  // 推理模型（DeepSeek-R1 / QwQ / Qwen3）的"思考"也吃 num_predict：短预算下 response 会是空的
  // （实测 deepseek-r1:8b 要 200+ token 思考）⇒ 给它留思考余量；与 host 的 petOllamaGenerate 同策略。
  const reasoning = /(?:^|[^a-z0-9])(r1|qwq|qwen3|thinking|reason)(?:[^a-z0-9]|$)/i.test(model);
  // [local patch E2] 预算可由渲染端指定（导演模式要一段 JSON，80 token 会被截断）；不传则沿用老的 80。
  const budget = Math.max(16, Math.min(1200, Number(payload && payload.numPredict) || 80));
  const thinkHeadroom = Math.max(0, Number(process.env.DSH_PET_THINK_HEADROOM) || 1200);
  const numPredict = reasoning ? budget + thinkHeadroom : budget;
  const stripThink = (s) => String(s || '').replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, '').replace(/<think\b[\s\S]*$/i, '').trim();
  const ask = (m) => new Promise((resolve) => {
    const body = JSON.stringify({ model: m, prompt, system, stream: false, keep_alive: process.env.DSH_PET_KEEPALIVE || '30m', options: { temperature: 0.9, num_predict: numPredict, num_ctx: Math.max(512, Number(process.env.DSH_PET_NUM_CTX) || 2048) } });
    const req = http.request(
      api.replace(/\/+$/, '') + '/api/generate',
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: Number(process.env.DSH_PET_LOCAL_TIMEOUT || 180000) },
      (res) => {
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const text = stripThink(j.response);
            resolve(text ? { ok: true, text, model: m } : { ok: false, error: String(j.thinking || '').trim() ? 'thinking-only' : 'empty-response', model: m });
          } catch (e) {
            resolve({ ok: false, error: 'bad-json', model: m });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e), model: m }));
    req.write(body);
    req.end();
  });

  // [local patch E6] 出话前把「看屏幕的视觉模型」请出显存（见文件头 E6 注释）。
  // 只在这一件事上花时间：卸载实测 0.1 秒；失败/超时都无所谓，绝不能因为腾显存把出话搞挂。
  const yieldVram = !shareOne && !(payload && payload.yieldVram === false) && process.env.DSH_PET_YIELD_VRAM !== '0';
  if (yieldVram && visionModel && visionModel !== model) {
    try { await petOllamaCall('/api/generate', { method: 'POST', timeoutMs: 6000, body: { model: visionModel, prompt: '', stream: false, keep_alive: 0 } }); } catch (e) { /* 让不了位也照常说 */ }
  }

  let r = await ask(model);
  // [local patch E6] "自主切换"兜底：主人选的模型不在了 / 出不来话 → 自动退回和看屏幕共用的那个（它一定装着），
  // 保证她**永远不会变成哑巴**；超时不算（那是模型在吭哧，再问一次只会更慢）。
  const fallbackModel = visionModel && visionModel !== model ? visionModel : '';
  if (r && !r.ok && fallbackModel && r.error !== 'timeout') {
    const r2 = await ask(fallbackModel);
    if (r2 && r2.ok) return { ok: true, text: r2.text, model: r2.model, fellBackFrom: model, why: r.error };
    return r2 || r;
  }
  return r;
});

/* [local patch P2] 权限设置的数据端：**只做"打开"**——软件快捷方式 / 文件夹 / 文件 / 网页。
 * 明确不做：删除、移动、改名、写文件、执行任意命令（那与"绝不能损坏"冲突，见 README）。
 * 查找顺序：绝对路径 → 名字解析（见下）→ 开始菜单/桌面快捷方式；找不到就如实 not-found。
 * 名字解析（同一补丁的第二段，pc-ipc@2 新增）：用户别名 aliases.json → 内置中文对照表
 * → 内置泛词表（first/ask 策略）→ 原有四条模糊规则。ask 策略与"卸载类"名字一律返回
 * ambiguous 只列候选，渲染端只问不做，绝不 openPath —— 语音听错一个字的代价太大。 */
const APP_CACHE = { at: 0, list: null };
function listAppShortcuts() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  if (APP_CACHE.list && Date.now() - APP_CACHE.at < 300000) return APP_CACHE.list;
  const roots = [
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(os.homedir(), 'Desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
  ];
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4 || out.length > 800) return;
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true }); // 只读
    } catch (e) {
      return;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (/\.(lnk|url|exe|bat|cmd)$/i.test(e.name)) out.push({ name: path.basename(e.name, path.extname(e.name)), path: full });
    }
  };
  for (const r of roots) walk(r, 0);
  APP_CACHE.list = out;
  APP_CACHE.at = Date.now();
  return out;
}
/* [local patch P2] 名字解析：把"她说出来的名字"对上真正的快捷方式（纯函数，好测、不碰 fs）。
 * 顺序：用户别名（aliases.json）→ 内置中文对照表 → 内置泛词表（按策略）→ 原有四条规则 → 如实 not-found。
 * 泛词策略：first = 按候选顺序取本机真有的第一个；ask = 同类有多个就 ambiguous —— 她只问、绝不猜。
 * 安全红线：卸载类名字（目标里带"卸载"，或命中的快捷方式本身是卸载器）永远不 openPath，
 * 一律 ambiguous 只列候选。aliases.json 是主人手写的名字映射，**只读**（不存在＝正常）。 */
const APP_GAME_HINTS = ['Left 4 Dead 2', 'World War Z', 'Project Zomboid', 'Dust Front RTS Demo', '三角洲行动', '地下城与勇士', '战双帕弥什', '喋血复仇', '英雄联盟', '架空地图模拟器', '上行战场'];
const APP_GENERIC = [
  { keys: ['浏览器'], policy: 'first', cands: ['Microsoft Edge', 'Google Chrome', '夸克'] },
  { keys: ['音乐', '听歌'], policy: 'first', cands: ['酷狗音乐', 'QQ音乐', '网易云音乐'] },
  { keys: ['加速器'], policy: 'first', cands: ['UU加速器', '雷神加速器', '暴喵AI管家'] },
  { keys: ['蒸汽', '游戏平台'], policy: 'first', cands: ['Steam', 'WeGame'] },
  { keys: ['终端', '命令行'], policy: 'first', cands: ['Windows Terminal', 'Command Prompt', 'Windows PowerShell'] },
  { keys: ['文件管理器', '资源管理器', '我的电脑'], policy: 'first', cands: ['File Explorer'] },
  { keys: ['任务管理器'], policy: 'first', cands: ['Task Manager'] },
  { keys: ['控制面板', '设置'], policy: 'first', cands: ['Control Panel'] },
  { keys: ['注册表'], policy: 'first', cands: ['Registry Editor'] },
  { keys: ['画图'], policy: 'first', cands: ['Paint'] },
  { keys: ['记事本'], policy: 'first', cands: ['Notepad'] },
  { keys: ['计算器'], policy: 'first', cands: ['Calculator'] },
  { keys: ['网盘'], policy: 'ask', cands: ['百度网盘', '夸克网盘'] },
  { keys: ['游戏'], policy: 'ask', cands: APP_GAME_HINTS },
  { keys: ['卸载'], policy: 'ask', never: true, cands: [] },
];
const APP_CN_MAP = {
  '求生之路2': 'Left 4 Dead 2',
  '求生之路': 'Left 4 Dead 2',
  '左死的2': 'Left 4 Dead 2',
  '僵尸世界大战': 'World War Z',
  '僵尸毁灭工程': 'Project Zomboid',
  '壁纸引擎': 'Wallpaper Engine：壁纸引擎',
  '尘封前线': 'Dust Front RTS Demo',
  '上行战场': '上行战场  The Ascent',
  '谷歌浏览器': 'Google Chrome',
  'Edge浏览器': 'Microsoft Edge',
  '微软浏览器': 'Microsoft Edge',
  'OBS工作室': 'OBS Studio',
  '命令行提示符': 'Command Prompt',
};
const APP_ALIAS_CACHE = { key: '', map: null };
function appNorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
}
function appIsUninstall(s) {
  const t = String(s == null ? '' : s);
  if (!t) return false;
  if (t.indexOf('卸载') >= 0) return true;
  return /\buninstall/i.test(t);
}
/* 原有四条规则（保持既有行为）：全名精确 → 去空白小写相等 → 名字含关键字 → 关键字含名字 */
function appFindShortcut(name, apps) {
  const nm = String(name == null ? '' : name);
  const key = appNorm(nm);
  if (!key) return null;
  return (
    apps.find((a) => a.name.toLowerCase() === nm.toLowerCase()) ||
    apps.find((a) => appNorm(a.name) === key) ||
    apps.find((a) => appNorm(a.name).indexOf(key) >= 0) ||
    apps.find((a) => key.indexOf(appNorm(a.name)) >= 0) ||
    null
  );
}
/* 双向模糊：同类的全都找出来（给别名/对照表的值用；同名快捷方式在多个根里会重复，按名字去重） */
function appFindAll(name, apps) {
  const key = appNorm(name);
  if (!key) return [];
  const out = [];
  for (const a of apps) {
    const n = appNorm(a.name);
    if (n === key || n.indexOf(key) >= 0 || key.indexOf(n) >= 0) {
      if (!out.some((x) => appNorm(x.name) === n)) out.push(a);
    }
  }
  return out;
}
/* 正向包含：候选名出现在快捷方式名里（给泛词表用，避免"夸克网盘"反把"夸克"也捞进来） */
function appFindContaining(name, apps) {
  const key = appNorm(name);
  if (!key) return [];
  return apps.filter((a) => appNorm(a.name).indexOf(key) >= 0);
}
function appAmbiguous(cands, reason) {
  const out = [];
  for (const n of cands) {
    if (n && out.indexOf(n) < 0) out.push(n);
  }
  return { ok: false, error: 'ambiguous', reason: reason || 'ambiguous', candidates: out.slice(0, 12) };
}
function appHit(hit) {
  return { ok: true, hit: hit };
}
/* 别名 / 内置对照表的值是"真正的名字或子串"：能精确对上就精确，对上多个就问她 */
function appResolveByValue(value, apps, reason) {
  const v = appNorm(value);
  if (!v) return null;
  const exact = apps.find((a) => appNorm(a.name) === v);
  if (exact) return appIsUninstall(exact.name) ? appAmbiguous([exact.name], 'uninstall-guard') : appHit(exact);
  const all = appFindAll(value, apps).filter((a) => !appIsUninstall(a.name));
  if (all.length > 1) return appAmbiguous(all.map((a) => a.name), reason);
  if (all.length === 1) return appHit(all[0]);
  return null;
}
function appResolveGeneric(g, apps) {
  const cands = g.cands || [];
  if (g.policy === 'ask') {
    const found = [];
    for (const c of cands) {
      for (const a of appFindContaining(c, apps)) {
        if (appIsUninstall(a.name)) continue;
        if (!found.some((x) => appNorm(x.name) === appNorm(a.name))) found.push(a);
      }
    }
    if (!found.length) return null;
    if (found.length > 1 || g.never) return appAmbiguous(found.map((a) => a.name), 'ask:' + (g.keys[0] || ''));
    return appHit(found[0]);
  }
  for (const c of cands) {
    const h = appFindShortcut(c, apps);
    if (h && !appIsUninstall(h.name)) return appHit(h);
  }
  return null;
}
function appExpandGeneric(key) {
  if (!key) return null;
  for (const g of APP_GENERIC) {
    if (g.keys.some((k) => appNorm(k) === key)) return g;
  }
  return null;
}
/* not-found 的候选：先给泛词表里认识的名字，再补名单前几个（滤掉卸载类，绝不把卸载器当建议） */
function appNotFoundCandidates(key, apps, g) {
  const out = [];
  const push = (n) => {
    if (n && out.indexOf(n) < 0) out.push(n);
  };
  if (g) for (const c of g.cands || []) { if (out.length >= 5) break; push(c); }
  for (const a of apps) {
    if (out.length >= 5) break;
    if (appIsUninstall(a.name)) continue;
    push(a.name);
  }
  return out.slice(0, 5);
}
function appAliasFiles() {
  const os = require('node:os');
  const path = require('node:path');
  const home = process.env.USERPROFILE || (os.homedir ? os.homedir() : '');
  const files = [];
  const push = (p) => {
    if (p && files.indexOf(p) < 0) files.push(p);
  };
  if (home) push(path.join(home, '.dsh', 'dsh-pet', 'aliases.json'));
  if (process.env.DSH_HOME) push(path.join(process.env.DSH_HOME, 'dsh-pet', 'aliases.json'));
  return files;
}
/* 只读 aliases.json：{"别名":"目标名或子串"}；mtime+size 没变就复用，缺文件＝没有别名（正常） */
function loadAppAliases() {
  const fs = require('node:fs');
  for (const f of appAliasFiles()) {
    let st = null;
    try {
      st = fs.statSync(f);
    } catch (e) {
      continue;
    }
    const key = f + '|' + st.mtimeMs + '|' + st.size;
    if (APP_ALIAS_CACHE.map && APP_ALIAS_CACHE.key === key) return APP_ALIAS_CACHE.map;
    const map = {};
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8')); // 只读，不写回
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const k of Object.keys(raw)) {
          const v = raw[k];
          if (typeof v === 'string' && v.trim()) map[appNorm(k)] = v.trim();
        }
      }
    } catch (e) {
      /* 文件坏了就当没有别名：不写回、不报错刷屏 */
    }
    APP_ALIAS_CACHE.key = key;
    APP_ALIAS_CACHE.map = map;
    return map;
  }
  APP_ALIAS_CACHE.key = '';
  APP_ALIAS_CACHE.map = {};
  return {};
}
/* 唯一入口：{ok:true,hit} 或 {ok:false,error:'ambiguous'|'not-found',candidates} */
function resolveAppTarget(target, list, aliases) {
  const apps = (Array.isArray(list) ? list : []).filter((a) => a && typeof a.name === 'string');
  const key = appNorm(target);
  if (!key) return { ok: false, error: 'empty-target' };
  /* 0) 安全红线：卸载类目标只列候选，永远不打开 */
  if (appIsUninstall(target)) {
    const own = apps.filter((a) => appIsUninstall(a.name) && appNorm(a.name).indexOf(key) >= 0);
    const pool = own.length ? own : apps.filter((a) => appIsUninstall(a.name));
    return appAmbiguous(pool.map((a) => a.name), 'uninstall-guard');
  }
  /* 1) 主人自己教的别名优先于一切内置 */
  const aliasMap = aliases && typeof aliases === 'object' ? aliases : {};
  const aliasVal = aliasMap[key];
  if (aliasVal) {
    const r1 = appResolveByValue(String(aliasVal), apps, 'alias');
    if (r1) return r1;
  }
  /* 2) 内置中文↔真名对照表 */
  const cnVal = APP_CN_MAP[key];
  if (cnVal) {
    const r2 = appResolveByValue(String(cnVal), apps, 'cn-map');
    if (r2) return r2;
  }
  /* 3) 内置泛词表（first 取第一个真有的；ask 有多个就问她） */
  const g = appExpandGeneric(key);
  if (g) {
    const r3 = appResolveGeneric(g, apps);
    if (r3) return r3;
  }
  /* 4) 原有四条规则：不认识的名字仍按老规矩模糊匹配 */
  const hit = appFindShortcut(target, apps);
  if (hit) return appIsUninstall(hit.name) ? appAmbiguous([hit.name], 'uninstall-guard') : appHit(hit);
  /* 5) 都不中：候选先给泛词表认识的名字，再给名单前几个 */
  return { ok: false, error: 'not-found', candidates: appNotFoundCandidates(key, apps, g) };
}
/* [local patch voice-targets@1] kind:'file' —— 文件夹 / 文件 / 盘符 / 系统文件夹令牌。
 *
 * 渲染端（sprite.js + targets.js）只给四样之一：
 *   ① 系统文件夹令牌（downloads/documents/pictures/music/videos/desktop/home/temp）
 *      —— 由 targets.js 把「打开下载文件夹」这类话翻成令牌；
 *   ② 盘符（`D:\`）；③ 绝对路径（`C:\…`、`\\server\share`）；④ 相对名字。
 * 相对名字在「桌面/下载/文档/图片/视频/音乐」**顶层**按名字找（只列一层、只读）：
 *   命中 1 个就开，多个一律 ambiguous 只问不做（语音听错一个字的代价太大）。
 * 顶层里的 .lnk/.url/.exe/.bat/.cmd 刻意跳过：那些是**软件**，属于 app 那条路
 *   （要「允许她打开软件」的权限）—— 免得只有 file 权限时反而把软件拉起来了。
 * 全程只 shell.openPath，绝不删除 / 移动 / 改名 / 写文件（与 pc-ipc 的安全口径一致）。 */
const FOLDER_TOKENS = ['downloads', 'documents', 'pictures', 'music', 'videos', 'desktop', 'home', 'temp'];
const FOLDER_TOKEN_LABEL = {
  downloads: '下载',
  documents: '文档',
  pictures: '图片',
  music: '音乐',
  videos: '视频',
  desktop: '桌面',
  home: '主目录',
  temp: '临时文件夹',
};
function localSearchRoots() {
  const out = [];
  for (const k of ['desktop', 'downloads', 'documents', 'pictures', 'videos', 'music']) {
    try {
      const p = app.getPath(k);
      if (p && out.indexOf(p) < 0) out.push(p);
    } catch {
      /* 这个标准目录在本机不存在（或还没建）就算了 */
    }
  }
  return out;
}
async function openLocalTarget(raw) {
  const fs = require('node:fs');
  const path = require('node:path');
  const target = String(raw == null ? '' : raw).trim();
  if (!target) return { ok: false, error: 'empty-target' };
  const openOne = async (p, name) => {
    try {
      const err = await shell.openPath(p);
      return err ? { ok: false, error: err } : { ok: true, matched: name || path.basename(p) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };
  /* ① 系统文件夹令牌 */
  if (FOLDER_TOKENS.indexOf(target) >= 0) {
    let p = '';
    try {
      p = app.getPath(target);
    } catch {
      p = '';
    }
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'not-found' };
    return openOne(p, FOLDER_TOKEN_LABEL[target] || target);
  }
  /* ② 盘符 / ③ 绝对路径 */
  const drive = target.match(/^([a-zA-Z]):[\\/]?$/);
  const abs =
    drive
      ? drive[1].toUpperCase() + ':\\'
      : /^[a-zA-Z]:[\\/]/.test(target) || /^\\\\/.test(target) || /^[\\/]/.test(target)
        ? target
        : '';
  if (abs) {
    if (!fs.existsSync(abs)) return { ok: false, error: 'not-found' };
    return openOne(abs);
  }
  /* ④ 相对名字：常用目录顶层按名字找（去掉扩展名再比，双向包含） */
  const key = appNorm(target).replace(/\.[^.]*$/, '');
  if (!key) return { ok: false, error: 'not-found' };
  const hits = [];
  for (const root of localSearchRoots()) {
    let ents = [];
    try {
      ents = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (e.isFile() && /\.(lnk|url|exe|bat|cmd)$/i.test(e.name)) continue; // 软件走 app 那条路
      const nm = appNorm(e.name.replace(/\.[^.]*$/, ''));
      if (!nm) continue;
      if (nm.indexOf(key) >= 0 || key.indexOf(nm) >= 0) {
        const full = path.join(root, e.name);
        if (!hits.some((h) => h.path === full)) hits.push({ name: e.name.replace(/\.[^.]*$/, ''), path: full });
      }
    }
  }
  if (hits.length === 1) return openOne(hits[0].path, hits[0].name);
  if (hits.length > 1) return { ok: false, error: 'ambiguous', candidates: hits.slice(0, 12).map((h) => h.name) };
  return { ok: false, error: 'not-found' };
}
ipcMain.handle('pet:list-apps', () => ({ ok: true, apps: listAppShortcuts().map((a) => a.name).slice(0, 400) }));
ipcMain.handle('pet:open-target', async (event, payload) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const kind = String((payload && payload.kind) || 'auto');
  const target = String((payload && payload.target) || '').trim();
  if (!target) return { ok: false, error: 'empty-target' };
  if (kind === 'url') {
    if (!/^https?:\/\//i.test(target)) return { ok: false, error: 'bad-url' };
    try {
      await shell.openExternal(target);
      return { ok: true, matched: target };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  if (kind === 'file') return openLocalTarget(target); // [local patch voice-targets@1]
  const looksPath = /[\\/]/.test(target) || /\.(exe|lnk|url|txt|docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|mp4|mp3|zip|rar|7z)$/i.test(target);
  if (looksPath) {
    const p = path.isAbsolute(target) ? target : path.resolve(target);
    if (!fs.existsSync(p)) return { ok: false, error: 'not-found' };
    try {
      const err = await shell.openPath(p);
      return err ? { ok: false, error: err } : { ok: true, matched: path.basename(p) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  const list = listAppShortcuts();
  const res = resolveAppTarget(target, list, loadAppAliases());
  if (res.error === 'ambiguous') return { ok: false, error: 'ambiguous', candidates: res.candidates };
  if (!res.ok || !res.hit) return { ok: false, error: 'not-found', candidates: res.candidates || list.slice(0, 5).map((a) => a.name) };
  const hit = res.hit;
  try {
    const err = await shell.openPath(hit.path);
    return err ? { ok: false, error: err } : { ok: true, matched: hit.name };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* [local patch Z] obs-rec@1 —— 「让她替我打开 OBS 录屏 / 我说停止就停下」。
 *
 * 边界（与 [local patch P] 的权限口径一致）：
 *   - 渲染端**只能传动作动词**（开始/停止/查状态）。OBS 可执行文件路径、websocket 端口、
 *     连接密码全部由 obs-ctl.js 从**本机 OBS 自己的配置**里读，渲染端一个都给不了。
 *   - 录屏文件名/格式/编码器/保存目录**完全用 OBS 自己的设置**（主人明确要求的），
 *     我们只发 StartRecord / StopRecord，不碰任何 Output 设置、不改 OBS 的任何配置。
 *   - 不执行用户可控命令、不传 shell。OBS 没开时才拉起它（最小化到托盘，不抢焦点）。
 *   - 日志一律走 stderr：本进程的 stdout 是给宿主 bridge 用的 JSON 行协议，绝不能污染。
 */
function obsLog(msg) {
  try { process.stderr.write('[dsh-pet obs] ' + msg + '\n'); } catch { /* 管道没了就算了 */ }
}

ipcMain.handle('pet:rec-start', async () => {
  try {
    const r = await obsCtl.start();
    if (r && r.ok === true) {
      obsLog('起录成功 already=' + !!r.already + ' 拉了OBS=' + !!r.startedObs + ' OBS起来用了' + (r.obsStartMs || 0) + 'ms 试了' + (r.tries || 1) + '次');
      return { ok: true, already: !!r.already, startedObs: !!r.startedObs, obsStartMs: r.obsStartMs || 0 };
    }
    obsLog('起录失败：' + ((r && r.error) || 'unknown'));
    return { ok: false, error: String((r && r.error) || 'rec-start-failed'), startedObs: !!(r && r.startedObs) };
  } catch (e) {
    obsLog('起录异常：' + ((e && e.message) || e));
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('pet:rec-stop', async () => {
  try {
    const r = await obsCtl.stop();
    if (r && r.ok === true) {
      obsLog('停录成功 already=' + !!r.already + ' 文件=' + (r.path || '(没返回路径)'));
      return { ok: true, already: !!r.already, path: String(r.path || '') };
    }
    obsLog('停录失败：' + ((r && r.error) || 'unknown'));
    return { ok: false, error: String((r && r.error) || 'rec-stop-failed') };
  } catch (e) {
    obsLog('停录异常：' + ((e && e.message) || e));
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('pet:rec-status', async () => {
  try {
    const r = await obsCtl.status();
    return r && r.ok === true
      ? { ok: true, running: !!r.running, recording: !!r.recording, timecode: String(r.timecode || '') }
      : { ok: false, error: String((r && r.error) || 'rec-status-failed') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* [local patch V] 语音模式（本机离线转写）—— 两件事：
 *   ① media 权限门控：**只在语音模式开着时**才给麦克风权限（默认关），其余权限一律不给。
 *      注册放在 IPC handler 里而不是模块顶层：session.defaultSession 必须等 app ready 才能碰。
 *   ② node 子进程转发：SenseVoice 的原生 addon 在 Electron 里加载会抛
 *      "External buffers are not allowed"（实测），只能交给真正的 node.exe。
 *      spawn 的是「固定 node 路径 + 固定 worker 脚本」，**不接受任何用户可控的命令/参数**、
 *      不走 shell（shell:false）。渲染端只传 16kHz Float32 PCM，落到 os.tmpdir() 的临时 wav，
 *      转写完**一定**删掉（voiceCleanup 只删自己造的 dsh-pet-voice-* 文件）。
 * 明确不做：不联网、不上传音频、不起别的进程、不写别的文件。 */
const VOICE = { on: false, bound: false, proc: null, seq: 0, pending: new Map(), nodeExe: null, stderr: '' };

/** 候选 node.exe：先用已验证的 DSH 运行时，再兜底系统 node。
 *  **绝不用 process.execPath** —— 那是 Electron，加载不了这个 addon。 */
function voiceCandidateNodes() {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const out = [];
  if (process.env.DSH_PET_NODE) out.push(process.env.DSH_PET_NODE);
  const homes = [process.env.DSH_HOME, path.join(os.homedir(), '.dsh')].filter(Boolean);
  for (const h of homes) {
    out.push(path.join(h, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
    try {
      const base = path.join(h, 'dsh-runtimes');
      for (const d of fs.readdirSync(base)) out.push(path.join(base, d, 'dependencies', 'node', 'bin', 'node.exe'));
    } catch {
      /* 没有这个目录就继续试下一个候选 */
    }
  }
  // [no-hardcode] 包内 node 一律**从运行时位置推导**，绝不写死某一台开发机的盘符路径。
  // 发行版布局：<安装根>\electron\electron.exe 与 <安装根>\node\bin\node.exe 是兄弟目录。两种锚点：
  //   process.execPath      = <安装根>\electron\electron.exe  → 两级 dirname 回到 <安装根>
  //   process.resourcesPath = <安装根>\electron\resources（打包后 <安装根>\resources）
  //                           → 一级（打包形态）或两级（源码形态）dirname 回到 <安装根>
  // 每个锚点都把「上一级/上两级」都当根试一遍：多的候选只是一次 existsSync，猜错也不会用错路径。
  const roots = [];
  for (const anchor of [process.execPath, process.resourcesPath]) {
    if (!anchor) continue;
    roots.push(path.dirname(anchor), path.dirname(path.dirname(anchor)));
  }
  for (const root of roots) {
    out.push(path.join(root, 'node', 'bin', 'node.exe'));
    out.push(path.join(root, 'node', 'node.exe'));
  }
  out.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'));
  return out;
}

function voiceFindNode() {
  const fs = require('node:fs');
  if (VOICE.nodeExe) return VOICE.nodeExe;
  for (const p of voiceCandidateNodes()) {
    try {
      if (p && fs.existsSync(p)) {
        VOICE.nodeExe = p;
        return p;
      }
    } catch {
      /* 单个候选探测失败不影响其它 */
    }
  }
  return null;
}

/** media 权限：只有语音模式开着才放行，其余一律拒绝；幂等。 */
function voiceBindPermission() {
  if (VOICE.bound) return;
  VOICE.bound = true;
  try {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media' && VOICE.on);
    });
    ses.setPermissionCheckHandler((wc, permission) => permission === 'media' && VOICE.on);
  } catch (e) {
    console.error('[dsh-pet] 语音权限门控注册失败：' + String((e && e.message) || e));
  }
}

/** Float32 PCM → 44 字节头的小端 RIFF WAV（16kHz 单声道 16bit）。 */
function voiceWavBuffer(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

function voiceTempFile() {
  const os = require('node:os');
  const path = require('node:path');
  return path.join(os.tmpdir(), 'dsh-pet-voice-' + Date.now() + '-' + Math.floor(Math.random() * 1000000) + '.wav');
}

/** 只删我们自己造的临时文件（文件名前缀必须对得上，别的路径一律不碰）。 */
function voiceCleanup(file) {
  const fs = require('node:fs');
  const path = require('node:path');
  if (!file || path.basename(file).indexOf('dsh-pet-voice-') !== 0) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* 已经没了就算了 */
  }
}

function voiceFailAll(reason) {
  for (const p of VOICE.pending.values()) {
    clearTimeout(p.timer);
    try {
      p.reject(new Error(reason));
    } catch {
      /* resolve/reject 竞态忽略 */
    }
  }
  VOICE.pending.clear();
}

function voiceStartWorker() {
  const fs = require('node:fs');
  const path = require('node:path');
  if (VOICE.proc) return VOICE.proc;
  const exe = voiceFindNode();
  if (!exe) {
    // 交给渲染端的是**稳定错误码**（no-node-runtime，渲染端按它给提示），但 stderr 上必须把
    // 「找了哪些地方」说清楚：只报一句「语音不能用」时，用户/售后根本不知道缺的是哪个文件。
    console.error(
      '[dsh-pet helper] 找不到可用的 node.exe：语音识别要它来跑包内 stt-worker（Electron 自身加载不了该原生 addon）。已尝试的候选：\n  ' +
        voiceCandidateNodes().join('\n  '),
    );
    throw new Error('no-node-runtime');
  }
  const worker = path.join(__dirname, 'stt-worker.mjs');
  if (!fs.existsSync(worker)) throw new Error('worker-missing');
  const { spawn } = require('node:child_process');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(exe, [worker], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, env });
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // worker 保证 stdout 只有协议行；解析不了就忽略，绝不因此崩
      }
      const p = VOICE.pending.get(msg.id);
      if (!p) continue;
      VOICE.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve({ ok: true, text: String(msg.text || ''), lang: String(msg.lang || ''), ms: Number(msg.ms) || 0 });
      else p.resolve({ ok: false, error: String(msg.error || 'worker-error') });
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (c) => {
    VOICE.stderr = (VOICE.stderr + String(c)).slice(-2000);
  });
  const die = () => {
    if (VOICE.proc !== proc) return;
    VOICE.proc = null;
    voiceFailAll('worker-died');
  };
  proc.on('error', die);
  proc.on('exit', die);
  VOICE.proc = proc;
  return proc;
}

function voiceRequest(wav, timeoutMs, lang) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = voiceStartWorker();
    } catch (e) {
      reject(new Error(String((e && e.message) || e)));
      return;
    }
    const id = ++VOICE.seq;
    const timer = setTimeout(() => {
      VOICE.pending.delete(id);
      if (VOICE.proc === proc) {
        VOICE.proc = null;
        try {
          proc.kill();
        } catch {
          /* 已经死了 */
        }
      }
      reject(new Error('worker-timeout'));
    }, timeoutMs || 10000);
    VOICE.pending.set(id, { timer, resolve, reject: (e) => reject(e instanceof Error ? e : new Error(String(e))) });
    try {
      proc.stdin.write(JSON.stringify({ id, cmd: 'transcribe', wav, lang: lang === 'auto' ? 'auto' : 'zh' }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      VOICE.pending.delete(id);
      reject(new Error('worker-failed'));
    }
  });
}

/** 渲染端送来的 PCM → Float32Array（只认 Float32Array / 数字数组 / 其它 TypedArray 视图）。
 *  抽成一个函数是为了两处共用（转写、自检留录音），也为了它能被单独测。 */
function voiceToSamples(pcm) {
  if (pcm instanceof Float32Array) return pcm;
  if (Array.isArray(pcm)) return Float32Array.from(pcm);
  if (pcm && ArrayBuffer.isView(pcm)) return new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4)).slice(0);
  return new Float32Array(0);
}

async function voiceTranscribePcm(pcm, lang) {
  const fs = require('node:fs');
  const samples = voiceToSamples(pcm);
  const want = lang === 'auto' ? 'auto' : 'zh'; // 只认这两个值，别的当 zh（不给渲染端传任意字符串的机会）
  if (!samples.length) return { ok: false, error: 'empty-audio' };
  const file = voiceTempFile();
  try {
    fs.writeFileSync(file, voiceWavBuffer(samples, 16000));
    let r;
    try {
      r = await voiceRequest(file, 10000, want);
    } catch (e) {
      const why = String((e && e.message) || e);
      if (why === 'no-node-runtime' || why === 'worker-missing' || why === 'worker-timeout') return { ok: false, error: why };
      // worker 崩过一次：清干净再试一次（模型冷启 ~2.5s，第二次一般就好）
      try {
        r = await voiceRequest(file, 15000, want);
      } catch (e2) {
        const why2 = String((e2 && e2.message) || e2);
        return { ok: false, error: why2 === 'no-node-runtime' || why2 === 'worker-missing' ? why2 : 'worker-failed' };
      }
    }
    return r;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    voiceCleanup(file);
  }
}

/** 语音链路日志落盘（诊断"我说了话她没反应"到底断在哪一步）。
 *  **路径写死在这里，且这个函数不接受任何参数** —— 这是唯一一处渲染端能触发的写盘，
 *  路径一旦可控就等于给页面开了个任意写口子。ring buffer ≤60 条，整段重写，人不看的时候也不会长胖。
 *  值得写的理由：这次报障时盘上一条记录都没有，只能靠猜；有了它，麦克风送没送进来声音、
 *  引擎报没报错、听成了什么，事后一眼能看出来。 */
function voiceLogPath() {
  // [发布版补丁 P1] 原来写死成一个固定的家目录路径（%USERPROFILE%\.dsh\...）：现在跟着数据根走
  const os = require('node:os');
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-pet', 'screen-watch', 'voice-log.json');
}

/** 只留我们认识的 9 个字段（ts/device/rms/voicedMs/speechMs/gain/heard/route/dropped），
 *  渲染端塞别的键一律不进盘；字符串字段去掉换行并截断，避免把日志写成一大坨。 */
function voiceLogClean(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const str = (v, n) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/[\r\n]+/g, ' ').slice(0, n);
    return s || null;
  };
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
  };
  const ts = Number(src.ts);
  const gain = num(src.gain);
  return {
    ts: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now(),
    device: str(src.device, 40) || '默认麦克风',
    rms: num(src.rms),
    voicedMs: Math.round(num(src.voicedMs)),
    // v6：Silero VAD 判出的"真语音"毫秒数（0 = 一句人声都没有）。**没给就是 null**，不能补成 0：
    // 补 0 等于替渲染端撒谎说"VAD 测过了、是 0"。给了但不是数（NaN/字符串）也记 null（不知道就别编）；
    // 只有真给了数字才 clamp 到非负整数（负数/小数都是我们自己的脏数据，夹回合法区间）。
    speechMs: src.speechMs === null || src.speechMs === undefined || !Number.isFinite(Number(src.speechMs))
      ? null
      : Math.max(0, Math.round(Number(src.speechMs))),
    // B 段增益：保留 2 位小数；没给/非正数当 1（= 没放大，如实）
    gain: Math.round((gain > 0 ? gain : 1) * 100) / 100,
    heard: str(src.heard, 200),
    route: src.route === 'intent' || src.route === 'chat' ? src.route : 'none',
    dropped: str(src.dropped, 60),
  };
}

/** ring buffer：最多 60 条，新的一律在后面，超了丢最老的那条。 */
function voiceLogPush(list, entry) {
  const MAX = 60;
  const out = (Array.isArray(list) ? list.slice(-(MAX - 1)) : []).concat([entry]);
  return out.slice(-MAX);
}

function voiceLogAppend(raw) {
  const fs = require('node:fs');
  const entry = voiceLogClean(raw);
  let list = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(voiceLogPath(), 'utf8'));
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = []; // 不存在/坏了都从空开始：日志绝不能影响语音链路
  }
  const next = voiceLogPush(list, entry);
  fs.writeFileSync(voiceLogPath(), JSON.stringify(next, null, 2));
  return { ok: true, n: next.length };
}

/** 自检留录音的固定路径（**写死、不接受任何参数** —— 和 voiceLogPath 同一条纪律：
 *  路径一旦能被渲染端影响，就等于给它开了个任意写口子）。 */
function voiceSelfTestPath() {
  // [发布版补丁 P2] 同 P1：路径跟着数据根走，仍然写死在一个函数里、不接受任何参数
  const os = require('node:os');
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-pet', 'screen-watch', 'voice-selftest.wav');
}

/** 自检留录音：把这段**原始**（未加增益）16kHz 单声道 PCM 覆盖成 wav。
 *  只写 voiceSelfTestPath() 这一个路径；目录不在/写不进就如实回失败（**不 mkdir**、不改别的东西）。 */
function voiceSelfTestWav(pcm) {
  const fs = require('node:fs');
  const samples = voiceToSamples(pcm);
  if (!samples.length) return { ok: false, error: 'empty-audio' };
  const buf = voiceWavBuffer(samples, 16000);
  fs.writeFileSync(voiceSelfTestPath(), buf);
  return { ok: true, bytes: buf.length, path: voiceSelfTestPath() };
}

ipcMain.handle('pet:voice-mode', (event, payload) => {
  // 门控必须在渲染端 getUserMedia **之前**注册好：渲染端先 setVoiceMode(true) 再要麦克风
  const on = !!(payload && payload.on);
  VOICE.on = on;
  voiceBindPermission();
  if (!on) {
    const proc = VOICE.proc;
    VOICE.proc = null;
    voiceFailAll('worker-stopped');
    if (proc) {
      try {
        proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      } catch {
        /* 管道已断 */
      }
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* 已经退出 */
        }
      }, 400);
    }
  }
  return { ok: true, on: VOICE.on, node: VOICE.on ? voiceFindNode() : null };
});

ipcMain.handle('pet:voice-transcribe', async (event, payload) => {
  const pcm = payload && payload.pcm;
  const lang = payload && payload.lang; // 只认 'zh' / 'auto'，收口在 voiceTranscribePcm 里
  try {
    return await voiceTranscribePcm(pcm, lang);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('pet:voice-log', (event, payload) => {
  // 渲染端只说「这一段听到了什么」；路径由 voiceLogPath() 写死，payload 里没有也不接受任何路径
  try {
    return voiceLogAppend(payload);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }; // 写不进去就如实回，不假装成功
  }
});

ipcMain.handle('pet:voice-selftest-wav', (event, payload) => {
  // 自检留录音：payload 只给 PCM；落盘路径写死在 voiceSelfTestPath()，不接受文件名
  try {
    return voiceSelfTestWav(payload && payload.pcm);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* [local patch T] 语音输出（TTS）：把她的回话念出来（Edge 朗读：联网、免费、无 Key）
 * 为什么长这样（tts-proto/TTS-SPEC.md 的实测结论，别改回去）：
 *   ① 端点只认 mp3 输出（audio-24khz-48kbitrate-mono-mp3），pcm 一律 "Unsupported Edge output format"；
 *   ② Sec-MS-GEC 必须用 **float64** 复现 python 的舍入（ticks 乘 1e7 超过 2^53，BigInt 精确整数被判 403）；
 *   ③ 必须自带 Origin（chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold）与 Edg/143 的 UA/版本号：
 *      本机 Node v24 的内置 WebSocket 对这个端点一律 1006，而且 WHATWG 接口改不了这两个头，
 *      所以这里自带一个只做文本/二进制帧、ping-pong、关闭的极简 WS 客户端（实测 12–26 KB/句，1.2–1.4 s/句）；
 *   ④ 主进程本身就是 Node ⇒ **不 spawn、不落盘**：mp3 在内存里合成，Buffer 原样回渲染层，
 *      由 decodeAudioData 播放（渲染端仍然不碰 fs，"唯一 spawn"那条不变量一个字都没动）。
 * 出错一律 return {ok:false,error}（绝不抛）：渲染端据此如实说"连不上朗读服务"。
 * 明确不做：不克隆音色、不写缓存文件、不起子进程、不碰麦克风/权限。 */

const TTS_TLS = require('node:tls');
const TTS_CRYPTO = require('node:crypto');

const TTS_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const TTS_CHROMIUM_FULL_VERSION = '143.0.3650.75';
const TTS_SEC_MS_GEC_VERSION = '1-' + TTS_CHROMIUM_FULL_VERSION;
const TTS_MAX_TEXT = 200;   // 一句的上限（切句在渲染端做）：太长又慢又容易被端点截
const TTS_MAX_INFLIGHT = 2; // 同时最多 2 句在合成：正好对上渲染端的预取 2 句
const TTS_HEADERS = {
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'en-US,en;q=0.9',
};
// 音色白名单（菜单只放 6 个中文音色，这里按 SPEC 收全 8 个：渲染端给别的值一律回落默认）
const TTS_VOICES = [
  'zh-CN-XiaoyiNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunxiaNeural',
  'zh-CN-YunyangNeural', 'zh-CN-YunjianNeural', 'zh-CN-liaoning-XiaobeiNeural', 'zh-CN-shaanxi-XiaoniNeural',
];

/** 与 edge-tts（python）逐位一致：ticks 乘 1e7 后超过 2^53，float64 会把尾数舍入，
 *  所以必须用 float64 复现（用 BigInt 精确整数会被端点判 403）。 */
function ttsSecMsGec(nowMs) {
  const t = (nowMs === undefined ? Date.now() : nowMs) / 1000 + 11644473600;
  const rounded = t - (t % 300);
  const ticks = (rounded * 1e7).toFixed(0);
  return TTS_CRYPTO.createHash('sha256').update(ticks + TTS_TRUSTED_TOKEN, 'ascii').digest('hex').toUpperCase();
}

function ttsSsmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* [发布版补丁 T2] 音高可调：从 <DSH_HOME>\\dsh-pet\\tts-pitch.txt 读（控制台「她的声音」写它），
 *  文件没有 / 值不合法就回落 +0Hz；收在 ±80Hz 的整数里 —— 写坏一个值不该让她变哑巴。 */
function ttsPitchFromConfig() {
  const def = '+0Hz';
  try {
    const fs = require('node:fs');
    const os = require('node:os');
    const file = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-pet', 'tts-pitch.txt');
    const raw = String(fs.readFileSync(file, 'utf8')).split(/\r?\n/)[0].trim();
    if (!/^[+-]?\d{1,3}Hz$/.test(raw)) return def;
    const n = Number(raw.replace(/Hz$/, ''));
    if (!Number.isFinite(n) || n < -80 || n > 80) return def;
    return (n >= 0 ? '+' : '') + n + 'Hz';
  } catch (e) {
    return def;
  }
}

function ttsBuildSsml(text, voice, rate, pitch) {
  return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
    "<voice name='" + voice + "'><prosody pitch='" + (pitch || '+0Hz') + "' rate='" + rate + "' volume='+0%'>" +
    ttsSsmlEscape(text) + '</prosody></voice></speak>';
}

/** 极简 WebSocket 客户端（够这个端点用：文本/二进制帧、分片、ping-pong、关闭）。 */
function ttsConnect(rawUrl, extraHeaders, handlers) {
  const u = new URL(rawUrl);
  const key = TTS_CRYPTO.randomBytes(16).toString('base64');
  const sock = TTS_TLS.connect({ host: u.hostname, port: Number(u.port || 443), servername: u.hostname });
  let handshaked = false, closed = false, buf = Buffer.alloc(0);
  let fragOp = 0, fragParts = [];
  const emit = (name, arg) => { if (handlers && typeof handlers[name] === 'function') handlers[name](arg); };
  if (handlers && typeof handlers.onSocket === 'function') handlers.onSocket(sock); // 让调用方掐得断
  const finish = (err) => {
    if (closed) return;
    closed = true;
    try { sock.destroy(); } catch (e) { /* 已经断了 */ }
    if (err) emit('error', err);
  };
  const sendFrame = (op, payload) => {
    if (sock.destroyed) return;
    const mask = TTS_CRYPTO.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(6); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(8); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(14); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | op;
    mask.copy(header, header.length - 4);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    try { sock.write(Buffer.concat([header, body])); } catch (e) { finish(e); }
  };

  sock.on('error', (e) => finish(e));
  sock.on('close', () => finish(new Error('连接被关闭')));
  sock.on('connect', () => {
    const lines = [
      'GET ' + u.pathname + u.search + ' HTTP/1.1',
      'Host: ' + u.hostname,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + key,
      'Sec-WebSocket-Version: 13',
    ];
    for (const k of Object.keys(extraHeaders || {})) lines.push(k + ': ' + extraHeaders[k]);
    sock.write(lines.join('\r\n') + '\r\n\r\n');
  });
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!handshaked) {
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buf.subarray(0, idx).toString('latin1');
      buf = buf.subarray(idx + 4);
      const status = Number((head.match(/^HTTP\/1\.1 (\d+)/) || [])[1]);
      if (status !== 101) return finish(new Error('TTS 握手失败 HTTP ' + status + ': ' + head.split('\r\n')[0]));
      const acc = (head.match(/sec-websocket-accept:\s*(\S+)/i) || [])[1];
      const want = TTS_CRYPTO.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (acc !== want) return finish(new Error('TTS 握手校验不通过'));
      handshaked = true;
      emit('open');
    }
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > (1n << 40n)) return finish(new Error('TTS 帧过大')); len = Number(big); off = 10; }
      let mask;
      if (masked) { if (buf.length < off + 4) return; mask = buf.subarray(off, off + 4); off += 4; }
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      buf = buf.subarray(off + len);
      if (masked) { const p = Buffer.from(payload); for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3]; payload = p; }
      if (op === 0x8) { const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; const reason = payload.subarray(2).toString('utf8'); finish(new Error('TTS 连接关闭 code=' + code + (reason ? ' reason=' + reason : ''))); return; }
      if (op === 0x9) { sendFrame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x0) { fragParts.push(payload); }
      else { fragOp = op; fragParts = [payload]; }
      if (fin) {
        const data = Buffer.concat(fragParts);
        fragParts = [];
        emit('message', { binary: fragOp === 0x2, data: fragOp === 0x2 ? data : data.toString('utf8') });
      }
    }
  });
  return {
    send: (text) => sendFrame(0x1, Buffer.from(text, 'utf8')),
    close: () => { if (!closed) { sendFrame(0x8, Buffer.alloc(0)); closed = true; try { sock.end(); } catch (e) { /* 已经关了 */ } } },
  };
}

/** 合成一句话：resolve 成 mp3 Buffer，失败 reject（调用方 catch 后如实回 {ok:false}）。 */
function ttsSynthesize(opts) {
  const text = String((opts && opts.text) || '').trim();
  const voice = (opts && opts.voice) || 'zh-CN-XiaoyiNeural';
  const rate = (opts && opts.rate) || '+0%';
  const timeoutMs = (opts && opts.timeoutMs) || 15000;
  if (!text) return Promise.reject(new Error('TTS 文本为空'));
  const url = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
    '?TrustedClientToken=' + TTS_TRUSTED_TOKEN +
    '&Sec-MS-GEC=' + ttsSecMsGec(opts && opts.nowMs) +
    '&Sec-MS-GEC-Version=' + TTS_SEC_MS_GEC_VERSION +
    '&ConnectionId=' + TTS_CRYPTO.randomUUID().replace(/-/g, '');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false, lastText = '', sockRef = null;
    const timer = setTimeout(() => fail(new Error('TTS 超时 ' + timeoutMs + 'ms')), timeoutMs);
    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sockRef) TTS_LIVE.delete(sockRef);
      try { ws.close(); } catch (e) { /* 已经关了 */ }
      reject(err);
    }
    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sockRef) TTS_LIVE.delete(sockRef);
      try { ws.close(); } catch (e) { /* 已经关了 */ }
      if (!chunks.length) return reject(new Error('TTS 没有返回音频'));
      resolve(Buffer.concat(chunks));
    }
    const ws = ttsConnect(url, TTS_HEADERS, {
      onSocket: (s) => { sockRef = s; TTS_LIVE.add(s); },
      open: () => {
        ws.send('X-Timestamp:' + new Date().toISOString() + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
        ws.send('X-RequestId:' + TTS_CRYPTO.randomUUID().replace(/-/g, '') + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + new Date().toISOString() + '\r\nPath:ssml\r\n\r\n' +
          ttsBuildSsml(text, voice, rate, (opts && opts.pitch) || ttsPitchFromConfig()));
      },
      message: (m) => {
        if (!m.binary) { lastText = String(m.data).slice(0, 300); if (/Path:turn\.end/.test(lastText)) done(); return; }
        const hlen = m.data.readUInt16BE(0);
        const hdr = m.data.subarray(2, 2 + hlen).toString('utf8');
        if (/Path:\s*audio/i.test(hdr)) chunks.push(m.data.subarray(2 + hlen));
        else lastText = hdr.slice(0, 200);
      },
      error: (e) => fail(e && e.message ? e : new Error(String(e))),
    });
  });
}

let TTS_INFLIGHT = 0;       // 正在合成的句数
const TTS_LIVE = new Set(); // 客户端自带的在途 socket 记账（WS 代码照搬已实测的 tts-client.cjs，不改它）

ipcMain.handle('pet:tts-speak', async (event, payload) => {
  // 渲染端只说"念这句"；音色/语速白名单在**主进程**再校验一遍（渲染端被改坏也不能乱发 SSML）
  const p = payload && typeof payload === 'object' ? payload : {};
  const raw = typeof p.text === 'string' ? p.text : '';
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!text) return { ok: false, error: 'empty-text' };
  if (text.length > TTS_MAX_TEXT) return { ok: false, error: 'text-too-long' };
  const voice = typeof p.voice === 'string' && TTS_VOICES.indexOf(p.voice) >= 0 ? p.voice : 'zh-CN-XiaoyiNeural';
  const rate = typeof p.rate === 'string' && /^[+-]\d{1,3}%$/.test(p.rate) ? p.rate : '+0%';
  if (TTS_INFLIGHT >= TTS_MAX_INFLIGHT) return { ok: false, error: 'busy（已经有 2 句在合成）' };
  const t0 = Date.now();
  TTS_INFLIGHT++;
  try {
    const pitch = ttsPitchFromConfig(); // 顺便回报给调用方（试听时能一眼看到用的什么音高）
    const audio = await ttsSynthesize({ text: text, voice: voice, rate: rate, pitch: pitch, timeoutMs: 15000 });
    // 成功字段名以 Lead 裁决为准：mp3（Buffer 原样带回，preload 负责转成精确字节）
    return { ok: true, mp3: audio, bytes: audio.length, ms: Date.now() - t0, voice: voice, rate: rate, pitch: pitch };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    TTS_INFLIGHT--;
  }
});
/* [local patch X] 清理缓存 —— 她自己的文件 + 浏览器缓存（**只手动**：主人明确不要定时、不要启动时清）
 * 边界写死在这里，别放宽：
 *   ① 删文件只认「写死的三条」：screen-watch 下的 shot.jpg / voice-log.json / voice-selftest.wav，
 *      加 %TEMP% 里有前缀白名单的临时产物（dsh-pet-voice-*.wav / dsh-pet-smoke*.png）。
 *      不递归删目录、不按通配删任意文件；memory.json（聊天记忆）、main-config.json（人设）、
 *      state.json（屏幕监测设置）、capture.ps1、Local Storage（她的设置与权限审计）一律不碰。
 *   ② 浏览器缓存**不 rm 目录**（Chromium 正开着，删目录会打架），只走 Electron 官方 API：
 *      session.defaultSession.clearCache() + clearStorageData({storages:['shadercache','cachestorage']})。
 *      只清缓存类 storages ⇒ 她的 localStorage / cookies 一个都不动。
 *   ③ dryRun 只统计不删（菜单里「看看能清多少」用）；删不掉如实计入 failed，绝不抛。
 * 这段要被测试直接抽出来跑：cachePlanFiles / cacheCleanRun / cacheDirBytes 都是纯函数（fs 注入）。 */

// [发布版补丁 P3] 原来写死成一个固定的家目录路径（清缓存只清数据根，别碰别人的东西）
const CACHE_PET_DIR = path.join(process.env.DSH_HOME || path.join(require('node:os').homedir(), '.dsh'), 'dsh-pet');
const CACHE_FIXED = [
  { rel: ['screen-watch', 'shot.jpg'], what: '截屏' },
  { rel: ['screen-watch', 'voice-log.json'], what: '语音日志' },
  { rel: ['screen-watch', 'voice-selftest.wav'], what: '自检录音' },
];
// %TEMP% 里只认这两类前缀 + 后缀（都是我们自己的产物；%TEMP% 里别的文件一个都不动）
const CACHE_TMP_OK = [
  { prefix: 'dsh-pet-voice-', suffix: '.wav', what: '临时录音' },
  { prefix: 'dsh-pet-smoke', suffix: '.png', what: '冒烟截图' },
];
const CACHE_BROWSER_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];

/** 纯函数：白名单 + 两个根目录 ⇒ 候选清单（不碰盘；测试直接抽这段跑）。 */
function cachePlanFiles(petDir, tmpDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  const out = [];
  for (const f of CACHE_FIXED) out.push({ path: path.join(petDir, f.rel[0], f.rel[1]), what: f.what });
  let names = [];
  try { names = fs.readdirSync(tmpDir); } catch { names = []; }
  for (const n of names) {
    const hit = CACHE_TMP_OK.find((r) => n.indexOf(r.prefix) === 0 && n.slice(-r.suffix.length) === r.suffix);
    if (hit) out.push({ path: path.join(tmpDir, n), what: hit.what });
  }
  return out;
}

/** 纯函数（fs 注入）：按 plan 统计 + 删除。dryRun 只统计；不存在算 missing，删不掉/是目录算 failed，都不抛。 */
function cacheCleanRun(plan, fs, dryRun) {
  const out = { ok: true, dryRun: !!dryRun, freedBytes: 0, deleted: 0, missing: 0, failed: 0, items: [] };
  for (const it of plan) {
    let size = 0;
    try {
      const st = fs.statSync(it.path);
      if (!st || typeof st.isFile !== 'function' || !st.isFile()) { out.failed++; continue; }
      size = Number(st.size) || 0;
    } catch (e) {
      if (e && e.code === 'ENOENT') { out.missing++; continue; }
      out.failed++;
      continue;
    }
    if (!out.dryRun) {
      try { fs.unlinkSync(it.path); } catch { out.failed++; continue; }
    }
    out.freedBytes += size;
    out.deleted++;
    out.items.push({ what: it.what, bytes: size });
  }
  return out;
}

/** 纯函数（fs 注入）：量这几个目录当前占多少字节（读不动就当 0，绝不影响清理本身）。 */
function cacheDirBytes(dir, names, fs) {
  const path = require('node:path');
  let total = 0;
  for (const n of names) {
    const d = path.join(dir, n);
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e || typeof e.isFile !== 'function' || !e.isFile()) continue;
      try { total += Number(fs.statSync(path.join(d, e.name)).size) || 0; } catch { /* 正在被写：跳过 */ }
    }
  }
  return total;
}

ipcMain.handle('pet:cache-clean', async (event, payload) => {
  const dryRun = !!(payload && payload.dryRun);
  try {
    const fs = require('node:fs');
    const os = require('node:os');
    const rep = cacheCleanRun(cachePlanFiles(CACHE_PET_DIR, os.tmpdir()), fs, dryRun);
    let userData = null;
    try { userData = app.getPath('userData'); } catch { userData = null; }
    rep.browserBefore = userData ? cacheDirBytes(userData, CACHE_BROWSER_DIRS, fs) : 0;
    if (userData && !dryRun) {
      try {
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData({ storages: ['shadercache', 'cachestorage'] });
      } catch (e) { rep.browserError = String((e && e.message) || e); } // 清不动就如实带回去，文件那边照样算数
    }
    rep.browserAfter = userData ? cacheDirBytes(userData, CACHE_BROWSER_DIRS, fs) : 0;
    rep.browserFreed = Math.max(0, rep.browserBefore - rep.browserAfter);
    rep.freedBytes += rep.browserFreed;
    rep.at = Date.now();
    return rep;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.on('pet:set-bounds', (event, bounds) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const x = Number(bounds?.x);
    const y = Number(bounds?.y);
    const width = Number(bounds?.width);
    const height = Number(bounds?.height);
    if (![x, y, width, height].every(Number.isFinite)) return;
    // 去重必须比较**我们上一次请求的值**，绝不能拿 win.getContentBounds() 回读值来比：
    // 跨缩放屏的 DIP↔物理 往返有 ScaleToEnclosingRect（向外取整）与 origin 舍入，
    // 读回值与设定值永远不相等，去重永远不生效，反而变成每帧强制重设窗口位置。
    const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    const key = rect.x + ',' + rect.y + ',' + rect.width + ',' + rect.height;
    if (lastRequestedBounds.get(win.id) !== key) {
      lastRequestedBounds.set(win.id, key);
      win.setContentBounds(rect, false);
    }
    // 碰撞站场：位置必须用**包围盒左上角**（renderer 显式上报 boxX/boxY）——
    // 窗口坐标 = 包围盒 − margin（半只宠物宽），直接拿窗口坐标会让跨窗检测整体错位
    const petId = [...windows.keys()].find((id) => windows.get(id) === win);
    if (petId) {
      const bx = Number(bounds?.boxX);
      const by = Number(bounds?.boxY);
      const size = Number(bounds?.size);
      const bottomPad = Number(bounds?.bottomPad);
      const vx = Number(bounds?.vx);
      const vy = Number(bounds?.vy);
      // 位置 + 尺寸 + 速度一并登记：set-bounds 是每次位置变化都会触发的全量上报
      // （此前只更新 x/y，静止宠物 size 永远为 0，跨窗碰撞检测 `!o.size` 直接跳过它）；
      // 速度取渲染端上报值（飞行中实时、静止/拖拽 = 0），落地后不再残留旧飞行速度。
      updatePetState(petId, {
        x: Number.isFinite(bx) ? bx : x,
        y: Number.isFinite(by) ? by : y,
        size: Number.isFinite(size) && size > 0 ? size : petStates.get(petId)?.size || 0,
        bottomPad: Number.isFinite(bottomPad) && bottomPad > 0 ? bottomPad : petStates.get(petId)?.bottomPad || 0,
        vx: Number.isFinite(vx) ? vx : 0,
        vy: Number.isFinite(vy) ? vy : 0,
      });
    }
  });

  // 飞行状态上报（碰撞站场）：renderer 飞行中每 ~30ms 上报一次自己的位置/速度/尺寸
  ipcMain.on('pet:report-flight', (event, state) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const petId = [...windows.keys()].find((id) => windows.get(id) === win);
    if (!petId) return;
    const s = state || {};
    const x = Number(s.x);
    const y = Number(s.y);
    const vx = Number(s.vx);
    const vy = Number(s.vy);
    const size = Number(s.size);
    const bottomPad = Number(s.bottomPad);
    if (![x, y, vx, vy, size, bottomPad].every(Number.isFinite)) return;
    updatePetState(petId, { x, y, vx, vy, size, bottomPad });
  });

  // 碰撞结果转发：飞行方窗口检测到撞到 targetId → 把动量结果（目标新初速）转发给目标窗口
  ipcMain.on('pet:collide-result', (event, payload) => {
    const targetId = payload && typeof payload === 'object' ? String(payload.targetId || '') : '';
    const vx = Number(payload?.vx);
    const vy = Number(payload?.vy);
    if (!targetId || !Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const targetWin = windows.get(targetId);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('pet:hit', { vx, vy });
    }
  });

  // 点击穿透翻转：renderer 在光标进/出身体命中区时上报；穿透期间仍保留 forward（mousemove 继续转发）。
  // 兜底轮询（见 createPetWindows）也走同一个出口 setWindowIgnore，两条通道共享同一份镜像状态。
  ipcMain.on('pet:set-interactive', (event, interactive) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    setWindowIgnore(win, !interactive);
  });

  // 渲染端正拿着鼠标输入（拖拽中 / 菜单开着 / 对话弹窗开着）：兜底轮询据此绝不翻回穿透。
  // 只存标记、不直接翻转窗口——**唯一出口**仍是 setWindowIgnore（在兜底轮询里按完整规则判定），
  // 否则会出现"两条通道抢着翻同一个窗口"的竞态。
  ipcMain.on('pet:input-busy', (event, busy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    inputBusy.set(win.id, !!busy);
  });

  // 右键菜单「打开网站」：交给**系统默认浏览器**打开（等效于网页里 Ctrl+点击链接新标签页），
  // 不建专属窗口——宠物窗口机制是透明小窗，不该承载常规网页浏览。URL 由渲染端从
  // configUrl 推导 = DSH webServer 端口，端口变化自动跟随
  ipcMain.on('pet:open-site', (event, payload) => {
    const url = payload && typeof payload === 'object' ? String(payload.url || '') : '';
    if (!/^https?:[/][/]/.test(url)) return;
    shell.openExternal(url).catch((error) => {
      console.error('[dsh-pet-desktop-helper] openExternal failed:', error);
    });
  });

  // 显示器热更新：分辨率/缩放变化、插拔屏、旋转都会让桌面几何失效。原先几何只在
  // createPetWindows() 算一次并经 URL query 注入，渲染端 VIEW 是模块顶层常量，运行期永不更新——
  // 表现为「改了分辨率后可移动范围还是旧的」。这里重算并推给所有窗口，渲染端就地重挂。
  let displaysTimer = null;
  const pushDisplays = () => {
    const geo = deskGeometry();
    lastRequestedBounds.clear(); // 坐标系变了，去重缓存作废，下一帧必须真的重设一次
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('pet:displays', geo);
    }
    console.error('[dsh-pet-desktop-helper] displays changed: ' + JSON.stringify(geo));
    // 主屏缩放可能一起变了（它决定宠物的尺寸补偿）。线性化生效期间 screen API 只报被强制的值，
    // 真实值只能靠探测子进程拿；不一致就刷新缓存，下次启动自动用上。
    if (FORCED_SCALE > 0) {
      setTimeout(() => {
        const real = probePrimaryScale();
        if (real > 0 && Math.abs(real - PRIMARY_SCALE) > 1e-6) {
          console.error(
            '[dsh-pet-desktop-helper] primary scaleFactor changed ' +
              PRIMARY_SCALE +
              ' -> ' +
              real +
              '; restart the desktop pet to resize',
          );
        }
      }, 1000).unref?.();
    }
  };
  /** 显示器事件会连发（一次改动能来好几条），去抖后只重算一次 */
  const scheduleDisplays = () => {
    if (displaysTimer) clearTimeout(displaysTimer);
    displaysTimer = setTimeout(() => {
      displaysTimer = null;
      pushDisplays();
    }, 300);
  };
  screen.on('display-metrics-changed', scheduleDisplays);
  screen.on('display-added', scheduleDisplays);
  screen.on('display-removed', scheduleDisplays);

  // 冒烟自检模式（默认关闭）：DSH_PET_SMOKE=1 时延时截图到 DSH_PET_SMOKE_OUT 后退出，
  // 用于验证窗口/渲染/动画链路（如 CI 或本地验证）。
  if (process.env.DSH_PET_SMOKE === '1') {
    const smokeOut = process.env.DSH_PET_SMOKE_OUT || path.join(app.getPath('temp'), 'dsh-pet-smoke.png');
    const afterMs = Number(process.env.DSH_PET_SMOKE_AFTER_MS || 9000);
    const target = windows.values().next().value;
    if (target) {
      // 转发渲染端 console（定位动画/余额/错误问题）
      target.webContents.on('console-message', (event) => {
        console.log(`[renderer:${event.level}] ${event.message}`);
      });
    }
    setTimeout(async () => {
      try {
        const first = windows.values().next().value;
        if (first && !first.isDestroyed()) {
          const dump = await first.webContents.executeJavaScript(`(async () => ({
            hasBridge: typeof window.petBridge !== 'undefined',
            hasSetInteractive: typeof window.petBridge?.setInteractive === 'function',
            viewport: window.innerWidth + 'x' + window.innerHeight,
            dpr: window.devicePixelRatio,
            debug: window.__dshPetDebug || null,
            sprites: document.querySelectorAll('.pet-sprite').length,
            errorVisible: document.getElementById('pet-error').classList.contains('visible'),
            errorText: document.getElementById('pet-error').textContent,
            firstBubble: (document.querySelector('.pet-bubble.is-on') || { textContent: '' }).textContent.slice(0, 120),
            hitCursor: (function () {
              var hit = document.querySelector('.pet-hit');
              return hit ? getComputedStyle(hit).cursor : '';
            })(),
            dragTransform: (function () {
              var hit = document.querySelector('.pet-hit');
              var stage = document.querySelector('.pet-stage');
              if (!hit || !stage) return 'no-sprite';
              var out = { idle: stage.style.transform };
              hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 120, screenX: 120, screenY: 120, pointerId: 91 }));
              out.duringClick = stage.style.transform;
              hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 120, clientY: 120, screenX: 120, screenY: 120, pointerId: 91 }));
              out.afterClick = stage.style.transform;
              hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200, screenX: 200, screenY: 200, pointerId: 92 }));
              hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 280, clientY: 240, screenX: 280, screenY: 240, pointerId: 92 }));
              out.duringDrag = stage.style.transform;
              window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 280, clientY: 240, screenX: 280, screenY: 240, pointerId: 92 }));
              out.afterDrag = stage.style.transform;
              return out;
            })(),
            releaseKeptPosition: await (async function () {
              // 独立不变量：把宠物先拖到工作区内的固定安全点（600,300），松手后窗口位置必须原地不动。
              // 拖拽抛掷物理（弹簧跟手+甩抛）下：指针长距跳跃后弹簧需要 ~0.3s 收敛，
              // 松手前停留超过 RELEASE_STALE_MS(150ms) 判为「温柔放下」（估速 null，不抛掷）——
              // 所以先等弹簧到位、再停留才松手，只测"释放瞬间是否位移"。
              var d = window.__dshPetDebug;
              var hit = document.querySelector('.pet-hit');
              if (!d || !d.dragPos || !hit) return null;
              var P = { x: d.dragPos.x, y: d.dragPos.y };
              var T = { x: 600, y: 300 }; // 目标窗口左上角（1708×1020 工作区内，远离四边）
              var upX = 1000 + (T.x - P.x);
              var upY = 600 + (T.y - P.y);
              var sleep = function (ms) {
                return new Promise(function (r) {
                  setTimeout(r, ms);
                });
              };
              hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1000, clientY: 600, screenX: 1000, screenY: 600, pointerId: 93 }));
              hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: upX, clientY: upY, screenX: upX, screenY: upY, pointerId: 93 }));
              await sleep(400); // 弹簧跟随收敛
              var during = { x: d.dragPos.x, y: d.dragPos.y };
              await sleep(200); // 轨迹过期 → 估速 null → 温柔放下（不抛掷）
              window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: upX, clientY: upY, screenX: upX, screenY: upY, pointerId: 93 }));
              await sleep(80); // 释放处理完成
              var released = d.lastDragRelease ? { x: d.lastDragRelease.x, y: d.lastDragRelease.y } : null;
              return {
                during: during,
                released: released,
                kept: !!(released && Math.abs(released.x - during.x) <= 1 && Math.abs(released.y - during.y) <= 1),
              };
            })(),
            interactiveFlip: (function () {
              // 点击穿透命中判定：光标在命中区内→可交互；移出→穿透；拖拽中（pointer 已捕获）→强制可交互。
              // hitRect 是 sprite 坐标，mousemove 用窗口坐标——测试事件需加上窗口外扩余量 winMargin。
              var d = window.__dshPetDebug;
              var hit = document.querySelector('.pet-hit');
              if (!d || !d.hitRect || !d.winMargin || !hit) return null;
              var r = d.hitRect;
              var m = d.winMargin;
              var xIn = m.l + r.x + r.w / 2;
              var yIn = m.t + r.y + r.h / 2;
              var xOut = Math.max(0, m.l + r.x - 20);
              var yOut = Math.max(0, m.t + r.y - 20);
              var out = {};
              window.dispatchEvent(new MouseEvent('mousemove', { clientX: xIn, clientY: yIn, screenX: xIn, screenY: yIn }));
              out.inside = d.interactive === true;
              window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut }));
              out.outside = d.interactive === false;
              hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: xIn, clientY: yIn, screenX: xIn, screenY: yIn, pointerId: 94 }));
              window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut }));
              out.duringDragForced = d.interactive === true;
              window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut, pointerId: 94 }));
              return out;
            })(),
            videoSrcA: (document.querySelectorAll('.pet-sprite video')[0] || { src: '' }).src,
            videoSrcB: (document.querySelectorAll('.pet-sprite video')[1] || { src: '' }).src,
            // 右键菜单自检：在命中区派发 contextmenu → 校验菜单挂载/根文案/子面板/运行错误
            menuSmoke: await (async function () {
              // 前面 drag/release/interactive 测试刚拖过宠：justDragged 100ms 内屏蔽右键，
              // 真实用户不会拖完立刻右键——先等 250ms 消除该时序影响
              await new Promise(function (resolve) {
                setTimeout(resolve, 250);
              });
              var hit = document.querySelector('.pet-hit');
              var d = window.__dshPetDebug;
              if (!hit || !d) return null;
              var errsBefore = (d.errors || []).length;
              try {
                hit.dispatchEvent(
                  new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 260, screenX: 400, screenY: 260 }),
                );
              } catch (err) {
                return { threw: String(err), menuMounted: false };
              }
              // 菜单是**异步**弹出来的：onContextMenu 要先 await fetchWatchState()（最多 2.5s）
              // 再 await textModelMenuInfo()（最多 1.2s），所以派发完 contextmenu 立刻查会误判
              // 「没弹出来」。这里轮询等它挂上，最多 8s；顺带记下等了多久，便于分辨慢/坏。
              var menu = null;
              var waitedMs = 0;
              for (var w = 0; w < 40; w++) {
                menu = document.querySelector('.dsh-pet-menu');
                if (menu) break;
                await new Promise(function (resolve) {
                  setTimeout(resolve, 200);
                });
                waitedMs += 200;
              }
              var out = {
                waitedMs: waitedMs,
                threw: null,
                menuMounted: !!menu,
                menuOpen: d.menuOpen === true,
                rootText: menu ? menu.textContent.slice(0, 60) : '',
                errsNew: (d.errors || []).length - errsBefore,
              };
              if (menu) {
                var branch = menu.querySelector('.dsh-pet-menu-branch');
                if (branch) {
                  branch.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, relatedTarget: menu }));
                  var panels = Array.prototype.slice.call(
                    menu.querySelectorAll('.dsh-pet-menu-column'),
                  );
                  var visible = function () {
                    return panels.filter(function (p) {
                      return p.style.display !== 'none';
                    });
                  };
                  out.panelCount = panels.length;
                  out.lvl2AfterHoverRoot = visible().length;
                  // 二级：悬停「动作」下的第一个分类 → 打开三级面板（具体动画）
                  var panel1 = visible().filter(function (p) {
                    return p !== panels[0];
                  })[0];
                  if (panel1) {
                    var cat = panel1.querySelector('.dsh-pet-menu-branch');
                    if (cat) {
                      cat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, relatedTarget: panel1 }));
                      await new Promise(function (resolve) {
                        setTimeout(resolve, 50);
                      });
                      out.lvl3AfterHoverCat = visible().length;
                      // 重放用户路径：鼠标从分类项移向三级面板（先离开分类项进入 4px 缝隙，
                      // 再进入三级面板）——缝隙里 mouseleave 会排 160ms 关闭定时器
                      cat.dispatchEvent(
                        new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }),
                      );
                      await new Promise(function (resolve) {
                        setTimeout(resolve, 60);
                      });
                      var panel2 = visible()[visible().length - 1];
                      if (panel2) {
                        panel2.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                      }
                      await new Promise(function (resolve) {
                        setTimeout(resolve, 220);
                      });
                      out.lvl3SurvivedAfterReenter = visible().length;
                      // 极端情况：缝隙停留超过关闭延时（鼠标犹豫）
                      cat.dispatchEvent(
                        new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }),
                      );
                      await new Promise(function (resolve) {
                        setTimeout(resolve, 260);
                      });
                      out.lvl3AfterGapHover = visible().length;
                    }
                  }
                }
              }
              return out;
            })(),
          }))()`);
          console.log(
            '[dsh-pet-desktop-helper] smoke dump: windows=' +
              windows.size +
              ' ids=' +
              JSON.stringify([...windows.keys()]) +
              ' => ' +
              JSON.stringify(dump),
          );
          console.log('[dsh-pet-desktop-helper] smoke bounds:', JSON.stringify(first.getContentBounds()));
          // 点击穿透 round-trip：setInteractive(true)→窗口捕获输入（忽略鼠标=false）；
          // setInteractive(false)→恢复整窗穿透（忽略鼠标=true）。状态取自主进程镜像 windowIgnore。
          // 期间暂停兜底轮询：它按真实光标位置翻转，冒烟时鼠标不在宠物身上会覆盖本断言的状态。
          pointerFallbackPaused = true;
          await first.webContents.executeJavaScript('window.petBridge.setInteractive(true); true;');
          await new Promise((r) => setTimeout(r, 80));
          const interactiveIgnoring = windowIgnore.get(first.id);
          await first.webContents.executeJavaScript('window.petBridge.setInteractive(false); true;');
          await new Promise((r) => setTimeout(r, 80));
          const passthroughIgnoring = windowIgnore.get(first.id);
          pointerFallbackPaused = false;
          console.log(
            '[dsh-pet-desktop-helper] smoke interactive round-trip:',
            JSON.stringify({ interactiveIgnoring, passthroughIgnoring }),
          );
          const image = await first.webContents.capturePage();
          writeFileSync(smokeOut, image.toPNG());
          console.log('[dsh-pet-desktop-helper] smoke capture:', smokeOut);
        }
      } catch (error) {
        console.error('[dsh-pet-desktop-helper] smoke capture failed:', error);
      }
      setTimeout(() => app.quit(), 500);
    }, afterMs);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
