/**
 * 本机能力检测 —— 「装完自动适配」的大脑（只用 node 内置能力，不装任何依赖）
 * ---------------------------------------------------------------------------
 * 检测三件事：
 *   1) 显卡真正的显存大小（注册表 HardwareInformation.qwMemorySize 才是真值；
 *      WMI 的 AdapterRAM 是 32 位，超过 4GB 会溢出成 4294967295，不能信）
 *   2) 本机有没有 Ollama、服务在不在、装了哪些模型、各自多大 / 是不是视觉 / 是不是思考型
 *   3) 按显存算「能同时放下什么」，挑出「聊天用的」和「看屏幕用的」，并给出性能档位参数
 *
 * 结果写两处：
 *   %APPDATA%\BlueHairMaid\device-profile.json   本机档案（给人看的 + 下次启动直接读）
 *   ...\dsh-pet\screen-watch\state.json          桌宠真正读的配置（只补空项，不覆盖主人选过的）
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const GPU_CLASS = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const DEFAULT_API = "http://127.0.0.1:11434";

/* ------------------------------------------------------------------ 显卡 */

async function regQuery(key, value) {
  try {
    const { stdout } = await execFileP("reg.exe", ["query", key, "/v", value], { windowsHide: true, maxBuffer: 1 << 20 });
    return stdout;
  } catch {
    return "";
  }
}

/** 读注册表拿真显存；拿不到就返回 0 */
export async function detectGpus() {
  const gpus = [];
  for (const sub of ["0000", "0001", "0002", "0003", "0004", "0005"]) {
    const key = `${GPU_CLASS}\\${sub}`;
    const descOut = await regQuery(key, "DriverDesc");
    const name = (descOut.match(/DriverDesc\s+REG_SZ\s+(.+)/i) || [])[1]?.trim() || "";
    if (!name) continue;
    let vramBytes = 0;
    const qw = await regQuery(key, "HardwareInformation.qwMemorySize");
    const mq = qw.match(/qwMemorySize\s+REG_QWORD\s+(0x[0-9a-fA-F]+)/i);
    if (mq) vramBytes = Number(BigInt(mq[1]));
    if (!vramBytes) {
      const dw = await regQuery(key, "HardwareInformation.MemorySize");
      const md = dw.match(/MemorySize\s+REG_DWORD\s+(0x[0-9a-fA-F]+)/i);
      if (md) vramBytes = Number(BigInt(md[1])); // 这一步最多只能到 4GB-1，仅作兜底
    }
    gpus.push({ name, vramBytes, vramMB: Math.round(vramBytes / 1048576), source: vramBytes ? "registry" : "unknown" });
  }
  if (!gpus.length) {
    // 注册表路径变了的老机器：退回 CIM 只为拿到显卡名字（显存不可信）
    try {
      const { stdout } = await execFileP(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"],
        { windowsHide: true, maxBuffer: 1 << 20 }
      );
      const raw = JSON.parse(stdout.trim() || "[]");
      for (const g of Array.isArray(raw) ? raw : [raw]) {
        if (!g?.Name) continue;
        gpus.push({ name: String(g.Name), vramBytes: 0, vramMB: 0, source: "wmi-unreliable" });
      }
    } catch {
      /* 完全没有也继续跑 */
    }
  }
  return gpus;
}

/* ---------------------------------------------------------------- Ollama */

export async function findOllama() {
  const candidates = [
    process.env.OLLAMA_EXE,
    join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama.exe"),
    join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Ollama", "ollama.exe"),
    join(process.env.LOCALAPPDATA || "", "Ollama", "ollama.exe"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const { stdout } = await execFileP("where.exe", ["ollama"], { windowsHide: true });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  } catch {
    /* 不在 PATH */
  }
  return "";
}

export function ollamaApi() {
  let api = process.env.OLLAMA_HOST || DEFAULT_API;
  if (!/^https?:\/\//i.test(api)) api = `http://${api}`;
  return api.replace(/\/+$/, "");
}

async function fetchJson(url, timeoutMs, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Ollama 装没装 / 在不在跑 / 有哪些模型 */
export async function ollamaInfo() {
  const api = ollamaApi();
  const exe = await findOllama();
  const info = { installed: Boolean(exe), exe, api, running: false, models: [], error: "" };
  try {
    const data = await fetchJson(`${api}/api/tags`, 3500);
    info.running = true;
    info.models = (Array.isArray(data.models) ? data.models : []).map((m) => ({
      name: String(m.name || m.model || ""),
      sizeBytes: Number(m.size) || 0,
      sizeMB: Math.round((Number(m.size) || 0) / 1048576),
      params: String(m.details?.parameter_size || ""),
      quant: String(m.details?.quantization_level || ""),
      family: String(m.details?.family || ""),
    })).filter((m) => m.name);
  } catch (e) {
    info.error = String(e?.message || e);
  }
  return info;
}

/* ------------------------------------------------- 模型分类 / 挑选 / 测速 */

const RE_VISION = /(vl|vision|llava|minicpm-?v|moondream|pixtral|internvl|gemma3|llama3\.2-vision)/i;
const RE_REASON = /(^|[^a-z0-9])(r1|qwq|qwen3|thinking|reason|deepseek-r1)/i;

export function parseParams(name, params) {
  const s = String(params || name || "").toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*b\b/);
  return m ? Number(m[1]) : 0;
}

export function classify(model) {
  const name = String(model?.name || "");
  return {
    vision: RE_VISION.test(name),
    reasoning: RE_REASON.test(name),
    params: parseParams(name, model?.params),
  };
}

/**
 * 按显存挑模型：
 *   预算 = 显存 × 0.72（留 28% 给桌面合成 / 上下文 KV / 驱动）
 *   聊天优先「不思考的文本模型」→「不思考的」「思考型的」（思考型会先写一长串内心戏，
 *   小机器上很容易把预算吃光，实测 qwen3:4b 的 thinking 能占掉全部 num_predict）
 *   看屏幕必须是真的视觉模型
 */
export function pickModels(gpus, models) {
  const vramMB = Math.max(0, ...gpus.map((g) => g.vramMB || 0), 0);
  const cpuOnly = vramMB === 0;
  const budgetMB = cpuOnly ? 2600 : Math.floor(vramMB * 0.72);
  const list = models.map((m) => ({ ...m, ...classify(m) }));
  const fits = list.filter((m) => m.sizeMB > 0 && m.sizeMB <= budgetMB);
  const pool = fits.length ? fits : list.filter((m) => m.sizeMB > 0).slice(0, 1);
  const bySizeDesc = (a, b) => b.sizeMB - a.sizeMB;

  const chatPool = pool.filter((m) => !m.vision && !m.reasoning).sort(bySizeDesc);
  let chat =
    chatPool[0] ||
    pool.filter((m) => !m.reasoning).sort(bySizeDesc)[0] ||
    pool.filter((m) => m.reasoning).sort((a, b) => a.sizeMB - b.sizeMB)[0] ||
    null;

  const visionPool = pool.filter((m) => m.vision).sort(bySizeDesc);
  const vision = visionPool[0] || null;

  return {
    vramMB,
    cpuOnly,
    budgetMB,
    chat: chat ? chat.name : "",
    vision: vision ? vision.name : visionPool.length ? "" : "",
    chatInfo: chat || null,
    visionInfo: vision || null,
    candidates: list.map((m) => ({ name: m.name, sizeMB: m.sizeMB, vision: m.vision, reasoning: m.reasoning, params: m.params, fits: m.sizeMB <= budgetMB })),
  };
}

/** 真跑一下量速度：tok/s 用 Ollama 自己回报的 eval_count / eval_duration 算，不要用墙钟猜 */
export async function probeModel(model, { api = ollamaApi(), timeoutMs = 90000, numPredict = 12 } = {}) {
  const t0 = Date.now();
  const res = await fetchJson(`${api}/api/generate`, timeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: "你好", stream: false, keep_alive: "10m", options: { num_predict: numPredict, temperature: 0.2 } }),
  });
  const evalCount = Number(res.eval_count) || 0;
  const evalNs = Number(res.eval_duration) || 0;
  const loadMs = Math.round((Number(res.load_duration) || 0) / 1e6);
  return {
    model,
    ok: true,
    totalMs: Date.now() - t0,
    loadMs,
    evalCount,
    tokPerSec: evalNs > 0 ? Math.round((evalCount / (evalNs / 1e9)) * 10) / 10 : 0,
    answer: String(res.response || "").trim().slice(0, 40),
  };
}

/* -------------------------------------------------------------- 档案/应用 */

export function buildTune(picks) {
  const mb = picks.vramMB;
  const weak = !picks.cpuOnly && mb > 0 && mb < 6500;
  return {
    numCtx: mb >= 12000 ? 4096 : mb >= 8000 ? 3072 : 2048,
    keepAlive: picks.cpuOnly ? "2m" : weak ? "10m" : "30m",
    yieldVram: Boolean(picks.chat && picks.vision && picks.chat !== picks.vision),
    intervalSec: picks.cpuOnly ? 60 : weak ? 30 : 20,
    maxCallsPerHour: picks.cpuOnly ? 10 : weak ? 20 : 35,
    weak,
  };
}

function notesFor(gpus, ollama, picks, tune) {
  const notes = [];
  const gpuLine = gpus.length
    ? gpus.map((g) => `${g.name}${g.vramMB ? `（显存 ${(g.vramMB / 1024).toFixed(1)} GB）` : "（显存读不到，按最小档算）"}`).join("；")
    : "没检测到独立显卡";
  notes.push(`显卡：${gpuLine}`);
  if (!ollama.installed) {
    notes.push("本机没有装 Ollama —— 想用本地模型请先装 Ollama，或者在上面填联网模型的接口地址与 API Key。");
  } else if (!ollama.running) {
    notes.push(`装了 Ollama（${ollama.exe}）但服务没在跑 —— 点「启动 Ollama」或重启电脑后它一般会自启。`);
  } else if (!ollama.models.length) {
    notes.push("Ollama 在跑，但一个模型都没有 —— 可以点「帮我装一个小模型」，或者填联网模型。");
  } else {
    notes.push(`本机 Ollama 有 ${ollama.models.length} 个模型，按 ${(picks.vramMB / 1024).toFixed(1)} GB 显存算，能舒服跑的是 ${picks.budgetMB} MB 以内的。`);
  }
  if (picks.chat) notes.push(`聊天 / 碎碎念建议用：${picks.chat}${picks.chatInfo ? `（${picks.chatInfo.sizeMB} MB${picks.chatInfo.reasoning ? "，思考型，说话前会先想一会儿" : ""}）` : ""}`);
  if (picks.vision) notes.push(`看屏幕（视觉）建议用：${picks.vision}${picks.visionInfo ? `（${picks.visionInfo.sizeMB} MB）` : ""}`);
  else if (ollama.models.length) notes.push("本机没有视觉模型 —— 屏幕监测会用不了，要么拉一个（例如 `ollama pull qwen2.5vl:3b`），要么填联网的视觉模型。");
  if (picks.chat && picks.vision && picks.chat !== picks.vision) {
    notes.push("两个模型不一样，出话前会先把另一个从显存里请出去（自动，yieldVram=" + String(tune.yieldVram) + "），否则会互相挤到很卡。");
  }
  if (tune.weak) notes.push("这台机器显存偏小，已经自动把监测频率和上下文调小，画面会更省。");
  if (picks.cpuOnly) notes.push("没有可用的显存，只能靠 CPU 跑 —— 会很慢，建议优先用联网模型。");
  return notes;
}

/** 一次做完检测（不测速；测速要单独点，因为要花时间） */
export async function detectAll({ log = () => {} } = {}) {
  log("检测显卡…");
  const gpus = await detectGpus();
  log("检测 Ollama…");
  const ollama = await ollamaInfo();
  const picks = pickModels(gpus, ollama.models);
  const tune = buildTune(picks);
  const profile = {
    at: new Date().toISOString(),
    app: "BlueHairMaid",
    gpus,
    vramMB: picks.vramMB,
    cpuOnly: picks.cpuOnly,
    budgetMB: picks.budgetMB,
    ollama: { installed: ollama.installed, running: ollama.running, api: ollama.api, exe: ollama.exe, modelCount: ollama.models.length, error: ollama.error },
    models: ollama.models,
    picks: { chat: picks.chat, vision: picks.vision, chatMB: picks.chatInfo?.sizeMB || 0, visionMB: picks.visionInfo?.sizeMB || 0, candidates: picks.candidates },
    tune,
    notes: notesFor(gpus, ollama, picks, tune),
  };
  return profile;
}

function readStateFile(paths) {
  try {
    return JSON.parse(readFileSync(join(paths.dataRoot, "screen-watch", "state.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeStateFile(paths, patch) {
  const file = join(paths.dataRoot, "screen-watch", "state.json");
  const cur = readStateFile(paths);
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, "\t"), "utf8");
  return next;
}

/**
 * 把检测结果落到配置里。
 *   force=false（默认）只填空项 —— 主人自己在控制台选过的模型绝不被悄悄改掉
 *   force=true   按检测结果重写（控制台「按本机重新适配」按钮）
 * setState：可选，正在跑的时候通过运行器的 /set-state 走（会广播给控制台与桌宠）
 */
export async function applyProfile(paths, profile, { force = false, setState = null } = {}) {
  mkdirSync(dirname(paths.deviceProfile), { recursive: true });
  writeFileSync(paths.deviceProfile, JSON.stringify(profile, null, "\t"), "utf8");

  const cur = readStateFile(paths);
  const pick = (key, value) => (force || !cur[key] ? value : cur[key]);
  const patch = {
    localProvider: "ollama",
    localApi: profile.ollama?.api || DEFAULT_API,
    localModel: profile.picks?.vision || cur.localModel || "",
    quipModel: profile.picks?.chat || cur.quipModel || "",
    intervalSec: pick("intervalSec", profile.tune.intervalSec),
    maxCallsPerHour: pick("maxCallsPerHour", profile.tune.maxCallsPerHour),
  };
  if (force || !cur.brain) patch.brain = profile.picks?.chat ? "local" : "dsh";

  if (setState) {
    try {
      await setState(patch);
      return { ok: true, via: "set-state", patch };
    } catch {
      /* 运行器不在就退回直接写文件 */
    }
  }
  const next = writeStateFile(paths, patch);
  return { ok: true, via: "file", patch, state: next };
}

/** 拉一个小模型（给「本机什么都没有」的人用），返回日志行回调 */
export async function pullModel(model, { exe, onLine = () => {}, api = ollamaApi() } = {}) {
  if (!exe) throw new Error("找不到 ollama.exe");
  const ctl = new AbortController();
  const res = await fetch(`${api}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal: ctl.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        onLine(o);
      } catch {
        /* 忽略半行 */
      }
    }
  }
  return { ok: true, model };
}
