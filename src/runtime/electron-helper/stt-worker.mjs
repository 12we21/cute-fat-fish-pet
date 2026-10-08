/* dsh-pet local patches: voice-worker@4 */
/* dsh-pet 语音模式 worker —— 本机离线 SenseVoice 转写（跑在真正的 node.exe 子进程里）
 *
 * 为什么必须另起子进程：SenseVoice 的原生 addon 在 Electron 里 require 会抛
 * "External buffers are not allowed"（实测），只有真正的 node.exe 能加载它。
 * 由 main.js 的 [local patch V] 用「固定 node 路径 + 固定本脚本」拉起（无 shell、无用户可控参数）。
 *
 * 协议：stdin 每行一个 JSON，stdout **只写协议行**（日志一律走 stderr，免得污染协议）。
 *   {"id":1,"cmd":"transcribe","wav":"C:\\...\\x.wav","lang":"zh"|"auto"}
 *      → {"id":1,"ok":true,"text":"…","lang":"zh","emotion":"…","speechMs":3622,"gain":1,"decoded":true,
 *         "vad":true,"vadMs":38,"ms":312,"engineMs":2545}
 *   lang 缺省/非法一律当 'zh'。**为什么要这个开关**：实测同一段底噪，zh = 「嗯。」、
 *   auto = 「그.」（韩文）—— 噪声被猜成韩文/日文就是 auto 的锅（见 tools/voice-lang-probe.mjs）。
 *   **v6：送引擎之前先增益归一化、再用 Silero VAD 切真语音**。一段都没切出/切出来短于 250ms ⇒
 *   **完全不碰引擎**，直接回下面这个形状（decoded:false 就是"没调引擎"的机器可读证据）：
 *      → {"id":1,"ok":true,"text":"","speechMs":0,"dropped":"no-speech","decoded":false,"gain":1,…}
 *   为什么非做不可（实测）：纯噪声 rms 0.012–0.12 判 0 段，而底噪上的小语音增益后就救得回来。
 *      → {"id":1,"ok":false,"error":"missing-wav" | "empty-audio" | "missing-model" | "missing-native-addon" | …}
 *   {"cmd":"warm"}   → {"ok":true,"warm":true,"engineMs":2545,"ms":2545}
 *   {"cmd":"quit"}   → {"ok":true,"bye":true} 然后退出（0）
 *
 * 只读：只读 wav 与模型文件；不写任何文件、不联网、不执行任何外部命令。
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);

/* 原生 addon（sherpa-onnx）在哪 —— **全部在运行时推导**，本文件不出现任何机器专属路径
 * （盘符、用户名、安装位置一个都不许写死；build\check-paths.mjs 会在打包时把这条件当门禁）。
 *
 * 为什么要改：以前只有一条写死的路径（作者开发机的 DSH 安装目录）。换台机器就找不到，
 * 而且把作者机器的盘符/用户信息带进了发布包。
 * 现在的候选择序（按可信度从高到低，第一个存在的就用）：
 *   ① 环境变量 DSH_PET_SHERPA_ADDON：精确路径。独立版 standalone\paths.mjs 的 speechEnv()
 *      就是这么注入的；手动指定也走它。
 *   ② 环境变量 DSH_SPEECH_DIR：语音包根（独立版注入 <程序根>\speech），引擎在它下面的 sherpa\。
 *   ③ 环境变量 DSH_PET_DSH_RESOURCES：**DSH 应用自己的 resources 目录**，由宿主
 *      helper-process.ts 用 process.resourcesPath 透传（这个事实只有宿主进程知道：helper 是被
 *      spawn 的另一个 Electron，它的 resourcesPath 指向自己的运行时）。DSH 把 sherpa-onnx-node
 *      的 JS 包装器打进 app.asar，盘上只有 app.asar.unpacked 里那份原生 addon，
 *      所以按这个根拼 unpacked 路径，顺带试一下未打包形态（resources\app\...）。
 *   ④ 包内相对路径：独立版布局里 worker 在 <程序根>\app\runtime\electron-helper\、
 *      引擎在 <程序根>\speech\sherpa\ —— 从 worker 自己的目录往上找几层即可，零配置。
 *   ⑤ os.homedir() 兜底：用户主目录下的默认安装位置（build\toolchain.mjs 的默认根之一）。
 * 全都没有 → findNative() 返回 null → loadNative() 抛 missing-native-addon。
 * 行为与改前一致：语音模式干净地失败并给出机器可读原因，其余功能一点不受影响。 */
const ADDON_FILE = 'sherpa-onnx.node';

/** addon 包名 sherpa-onnx-<win|linux|darwin>-<arch>（上游按平台发独立包；win-x64 那份即 sherpa-onnx-win-x64）。 */
function addonPackageName() {
  const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux';
  return 'sherpa-onnx-' + plat + '-' + process.arch;
}

/** 目录里所有 .node（上游改过包内文件名，不押注具体名字）；不存在/读不到就返回空数组。 */
function nodeFilesIn(dir) {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.node')).map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** 原生 addon 候选路径（运行时推导；成本只有几次 existsSync/readdirSync）。 */
function nativeCandidates() {
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  add(process.env.DSH_PET_SHERPA_ADDON);
  const speechDir = process.env.DSH_SPEECH_DIR;
  if (speechDir) {
    const dir = join(speechDir, 'sherpa');
    add(join(dir, ADDON_FILE));
    for (const p of nodeFilesIn(dir)) add(p);
  }
  const resources = process.env.DSH_PET_DSH_RESOURCES;
  if (resources) {
    for (const base of ['app.asar.unpacked', 'app']) {
      const dir = join(resources, base, 'dsh', 'node_modules', addonPackageName());
      add(join(dir, ADDON_FILE));
      for (const p of nodeFilesIn(dir)) add(p);
    }
  }
  /* 包内相对路径：worker 自己的目录往上最多找 5 层，每层试 <层>\speech\sherpa\ */
  let dir = import.meta.dirname;
  for (let up = 0; up < 5 && dir; up++) {
    const sherpa = join(dir, 'speech', 'sherpa');
    add(join(sherpa, ADDON_FILE));
    for (const p of nodeFilesIn(sherpa)) add(p);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  add(join(homedir(), 'BlueHairMaid', 'speech', 'sherpa', ADDON_FILE));
  return out;
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function findNative() {
  for (const p of nativeCandidates()) if (existsSync(p)) return p;
  return null;
}

/** 原生 addon 只 require 一次：VAD 和识别引擎共用同一个 sherpa 句柄。 */
let sherpaCache = null;
function loadNative() {
  if (sherpaCache) return sherpaCache;
  const p = findNative();
  if (!p) throw new Error('missing-native-addon');
  sherpaCache = require(p);
  return sherpaCache;
}

/** Silero VAD 模型（只读，1.8 MB）。路径可用环境变量覆盖（测试/换机时用）。 */
function findSileroModel() {
  const cands = [
    process.env.DSH_PET_SILERO_MODEL || '',
    join(dshHome(), 'speech-to-text', 'sensevoice', 'models', 'silero', 'silero_vad.onnx'),
  ].filter(Boolean);
  for (const p of cands) if (existsSync(p)) return p;
  return null;
}

function findModelDir() {
  const roots = [];
  roots.push(join(dshHome(), 'speech-to-text', 'sensevoice', 'models'));
  if (process.env.DSH_SPEECH_DIR) roots.push(join(process.env.DSH_SPEECH_DIR, 'sensevoice', 'models'));
  const picked = [];
  for (const root of roots) {
    picked.push(join(root, 'sensevoice-onnx'));
    try {
      for (const name of readdirSync(root)) picked.push(join(root, name));
    } catch {
      /* 目录不在就算了，继续试别的候选 */
    }
  }
  for (const d of picked) {
    if (existsSync(join(d, 'model.int8.onnx')) && existsSync(join(d, 'tokens.txt'))) return d;
  }
  return null;
}

let engine = null;
let engineLang = '';
let engineMs = 0;

/** 加载 addon + 建一个可复用的 offline recognizer（冷启 ~2.5s，只做一次）。
 *  lang: 'zh'（默认）或 'auto'。**换语言必须重建引擎**：sensevoice 那层自己的缓存键是
 *  native|model（不含 lang），光改参数不会真的换语言 —— 这里自己记着当前引擎是哪门语言。 */
function loadEngine(lang) {
  const want = lang === 'auto' ? 'auto' : 'zh';
  if (engine && engineLang === want) return engine;
  if (engine) engine = null; // 换语言：丢掉旧引擎重建（进程里只留一个）
  const t0 = Date.now();
  const native = findNative();
  if (!native) throw new Error('missing-native-addon');
  const dir = findModelDir();
  if (!dir) throw new Error('missing-model');
  const sherpa = loadNative();
  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: join(dir, 'model.int8.onnx'),
        language: want,
        useInverseTextNormalization: 1,
      },
      tokens: join(dir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  };
  const recognizer = sherpa.createOfflineRecognizer(config);
  engineMs = Date.now() - t0;
  engineLang = want;
  engine = { sherpa, recognizer, dir, native, lang: want };
  return engine;
}

/* ===================== v6：增益先行 → Silero VAD → 只在真有语音时调引擎 =====================
 * 顺序不能反（实测，探针 probe-silero-vad.cjs）：小语音 rms 0.015 直接过 VAD 只判出 33% 的
 * 有声时长，先 ×8 增益再判能到 85%；而纯噪声 rms 0.012 / 0.03 / 0.06 / 0.12 **四级全是 0 段**。
 * 也就是说：增益救得回"小声的人声"，VAD 挡得住"响的噪声"，两个都得有。
 * 主人那 30 多段 rms 0.012–0.045 的垃圾（连韩文幻觉都有）就是被这两级挡掉的现场。 */
const VAD_WINDOW = 512; // silero 固定 512 样本一窗（16 kHz = 32 ms），别改
const VAD_MIN_SPEECH_MS = 250; // 切出来的真语音短于此 ⇒ 不算人说话（与 VAD 的 minSpeechDuration 一致）
const GAIN_TARGET = 0.15; // 与渲染层 v5 voiceApplyGain 同一套数字（0.15 / ×8 / 只放大不缩小）
const GAIN_CAP = 8;

/** 峰值归一化增益：**只放大不缩小**、封顶 ×8、逐样本 clamp 到 [-1,1]。
 *  这是渲染层 v5 `voiceApplyGain` 的同一套规则（渲染层先做过一次，这里再做一次：
 *  那边封顶 ×8 之后仍可能只到 0.04，二级增益能把边界段落救回 VAD 的检出线）。 */
function voiceGainNormalize(samples) {
  if (!samples || !samples.length) return { samples, gain: 1 };
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  const want = peak > 0 ? GAIN_TARGET / peak : 1;
  const gain = Math.max(1, Math.min(GAIN_CAP, want));
  if (!(gain > 1)) return { samples, gain: 1 };
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return { samples: out, gain: Math.round(gain * 100) / 100 };
}

/** Silero VAD 的配置（字段名与取值以 sherpa-onnx 的 node 绑定为准）。 */
function voiceVadConfig(model) {
  return {
    sileroVad: { model, threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, windowSize: VAD_WINDOW, maxSpeechDuration: 12 },
    sampleRate: 16000,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
  };
}

let vadHandle = null;
let vadWhy = ''; // 非空 = VAD 不可用（模型缺了/建不起来），退回 v5 的"逐段直送"
/** 常驻 VAD：**只构造一次**，之后每句 reset 复用（模型 1.8 MB，每句重建会明显拖慢）。
 *  注意 SWIG 的严格 arity：createVoiceActivityDetector(config, 30) 必须**恰好 2 参**，
 *  少一个会直接抛 "Expect only 2 arguments. Given: 1"（踩过）。 */
function loadVad() {
  if (vadHandle) return vadHandle;
  if (vadWhy) return null;
  try {
    const model = findSileroModel();
    if (!model) throw new Error('missing-vad-model');
    const sherpa = loadNative();
    vadHandle = sherpa.createVoiceActivityDetector(voiceVadConfig(model), 30);
    return vadHandle;
  } catch (e) {
    vadWhy = String((e && e.message) || e);
    process.stderr.write('[stt-worker] silero vad 不可用，退回逐段直送: ' + vadWhy + '\n');
    return null;
  }
}

/** 喂满一窗就把切出来的语音段收走（Front/Pop），返回它们拼成的连续样本 + 有声毫秒数。 */
function voiceVadSpeech(sherpa, handle, samples) {
  const t0 = Date.now();
  const parts = [];
  let total = 0;
  let segments = 0;
  const drain = () => {
    while (!sherpa.voiceActivityDetectorIsEmpty(handle)) {
      const seg = sherpa.voiceActivityDetectorFront(handle);
      segments++;
      if (seg && seg.samples && seg.samples.length) {
        parts.push(seg.samples);
        total += seg.samples.length;
      }
      sherpa.voiceActivityDetectorPop(handle);
    }
  };
  sherpa.voiceActivityDetectorReset(handle); // 复用前先清（同一实例连着跑下一句）
  for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) {
    sherpa.voiceActivityDetectorAcceptWaveform(handle, samples.subarray(i, i + VAD_WINDOW));
    drain();
  }
  sherpa.voiceActivityDetectorFlush(handle);
  drain();
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return { samples: out, speechMs: Math.round((total / 16000) * 1000), segments, ms: Date.now() - t0 };
}

/** 只在这里碰识别引擎（一段 wav → 文本）。抽出来是为了让"到底调没调引擎"可被计数。 */
function voiceEngineDecode(sherpa, recognizer, samples) {
  const stream = sherpa.createOfflineStream(recognizer);
  // 注意：swig 是**严格 arity**，acceptWaveformOffline 只能 2 参
  // （写成 (stream, rate, samples) 会抛 "Expect only 2 arguments. Given: 3"，踩过）
  sherpa.acceptWaveformOffline(stream, { samples, sampleRate: 16000 });
  sherpa.decodeOfflineStream(recognizer, stream);
  const raw = JSON.parse(sherpa.getOfflineStreamResultAsJson(stream));
  return { text: String(raw.text || '').trim(), lang: String(raw.lang || ''), emotion: String(raw.emotion || '') };
}

/** 核心：增益 → VAD 切真语音 → **判出语音才解码**。
 *  decode 是**惰性回调**：一段都没切出来时它根本不会被调用 —— 「纯噪声不碰引擎」的结构保证
 *  （测试里用一个会计数的 decode 就能直接断言 0 次）。v 为 null（VAD 不可用）时退回逐段直送。 */
function voiceCoreTranscribe(sherpa, samples, v, decode) {
  const boosted = voiceGainNormalize(samples);
  let speech = null;
  if (v) {
    try {
      speech = voiceVadSpeech(sherpa, v, boosted.samples);
    } catch (e) {
      // VAD 中途出错：如实记下来，但别把整句弄丢 —— 退回直送
      process.stderr.write('[stt-worker] vad 出错，这一段直送引擎: ' + String((e && e.message) || e) + '\n');
      speech = null;
    }
  }
  if (speech && speech.speechMs < VAD_MIN_SPEECH_MS) {
    return { ok: true, text: '', speechMs: speech.speechMs, dropped: 'no-speech', decoded: false, gain: boosted.gain, vad: true, vadMs: speech.ms };
  }
  const raw = decode(speech ? speech.samples : boosted.samples);
  return Object.assign(raw, {
    // ok:true 不能少：渲染端 voiceHandlePcm 与自检都靠 `if (!r.ok)` 判成功，
    // 少了它每一次成功转写都会被当成失败（v6 第一版就漏在这里，被 verify-voice-live 第 3/4 节抓住）。
    ok: true,
    speechMs: speech ? speech.speechMs : null,
    dropped: null,
    decoded: true,
    gain: boosted.gain,
    vad: !!speech,
    vadMs: speech ? speech.ms : null,
  });
}

/** 转写一个 16kHz 单声道 WAV。永不抛：失败一律返回 {ok:false,error}。 */
function voiceWorkerTranscribe(wav, lang) {
  if (!wav || typeof wav !== 'string' || !existsSync(wav)) return { ok: false, error: 'missing-wav' };
  const t0 = Date.now();
  try {
    const sherpa = loadNative();
    const wave = sherpa.readWave(wav);
    if (!wave || !wave.samples || !wave.samples.length) return { ok: false, error: 'empty-audio' };
    if (wave.sampleRate !== 16000) return { ok: false, error: 'bad-sample-rate:' + wave.sampleRate };
    const v = loadVad();
    const out = voiceCoreTranscribe(sherpa, wave.samples, v, (seg) => voiceEngineDecode(sherpa, loadEngine(lang).recognizer, seg));
    return Object.assign(out, { ms: Date.now() - t0, engineMs, vadWhy });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

process.on('uncaughtException', (e) => {
  process.stderr.write('[stt-worker] uncaught: ' + String((e && e.stack) || e) + '\n');
  process.exit(1);
});

createInterface({ input: process.stdin, terminal: false })
  .on('line', (line) => {
    const s = String(line || '').trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch {
      reply({ ok: false, error: 'bad-json' });
      return;
    }
    const id = msg && msg.id;
    const cmd = msg && msg.cmd;
    if (cmd === 'quit') {
      reply({ ok: true, bye: true });
      process.exit(0);
    }
    if (cmd === 'warm') {
      const t0 = Date.now();
      try {
        loadEngine();
        reply({ ok: true, warm: true, engineMs, ms: Date.now() - t0 });
      } catch (e) {
        reply({ ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (cmd === 'transcribe') {
      reply(Object.assign({ id }, voiceWorkerTranscribe(msg.wav, msg.lang)));
      return;
    }
    reply({ id, ok: false, error: 'unknown-cmd' });
  })
  .on('close', () => process.exit(0));
