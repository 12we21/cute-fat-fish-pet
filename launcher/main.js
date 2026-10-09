"use strict";
// 「蓝毛小女仆」控制台 —— 一个窗口搞定开 / 关 / 看状态 / 改设置 / 发口令。
//
// 它自己也是一个 Electron 程序（用副本自带的 ..\electron\electron.exe 跑），
// 但和桌宠本体是两个进程：关掉这个窗口，桌宠照样在跑。
//
// 启停交给 standalone\start-pet.vbs / stop-pet.vbs（那里有单实例守卫），
// 这里只负责"替用户双击"。设置则直接改桌宠自己的两个文件：
//   <数据根>\dsh-pet\screen-watch\state.json   ← 监测/大脑/表达/频率（宿主每次调用都重读，写了立刻生效）
//   <数据根>\dsh-pet\main-config.json          ← 造型/位置/显示（走 PUT /config，宿主会 syncDesktop 立即应用）
//   （<数据根> 的规则见 ./paths.js：DSH_PET_DATA_DIR > 程序目录\data-root.txt > portable.txt > %APPDATA%\BlueHairMaid）
// 口令则 POST /dsh-pet-7340/chat —— 跟右键菜单里那些开关走的是同一条路。
//
// 纯命令行模式（给脚本和自检用）：
//   electron.exe . --status   打印一行 JSON 后退出
//   electron.exe . --start    启动桌宠并等它健康
//   electron.exe . --stop     停止桌宠并等它退干净

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..");
const STANDALONE = path.join(REPO, "standalone");
/** 发布版路径规则：程序目录只读；用户数据在 %APPDATA%\BlueHairMaid（放 portable.txt 则改到程序目录） */
const PATH_RULES = require("./paths");
const PATHS = PATH_RULES.resolvePaths(HERE);
const RUNTIME_FILE = path.join(PATHS.userRoot, "runtime.json");
const LOG_DIR = path.join(PATHS.userRoot, "logs");
const DEVICE_PROFILE = PATHS.deviceProfile;
const START_VBS = path.join(STANDALONE, "start-pet.vbs");
const STOP_VBS = path.join(STANDALONE, "stop-pet.vbs");
const PET_ICO = path.join(HERE, "pet.ico");
const USER_DATA = PATHS.consoleUserData;
const WSCRIPT = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
const HOST = "127.0.0.1";
const ROUTE = "/dsh-pet-7340";
const DATA_ROOT = PATHS.dataRoot;
const STATE_FILE = path.join(DATA_ROOT, "screen-watch", "state.json");
const CONFIG_FILE = path.join(DATA_ROOT, "main-config.json");
const petApi = require("./pet-api");
const rec = require("./rec");
const agent = require("./agent");
const update = require("./update");

// 音高（发布版补丁 T2）：桌宠助手每次合成都重读这个文件的第一行，所以改完立刻生效、不用重载她的窗口。
// 格式 +0Hz（默认）/ +30Hz / -15Hz，认不出来或超出 ±80 就当 +0Hz —— 跟 app 里 ttsPitchFromConfig() 同一套规则。
const TTS_PITCH_FILE = path.join(PATHS.userRoot, "dsh-pet", "tts-pitch.txt");
function readTtsPitch() {
	try {
		const first = String(fs.readFileSync(TTS_PITCH_FILE, "utf8")).split(/\r?\n/)[0].trim();
		if (!/^[+-]?\d{1,3}Hz$/.test(first)) return "+0Hz";
		const n = Number(first.replace("Hz", ""));
		if (!Number.isFinite(n) || Math.abs(n) > 80) return "+0Hz";
		return n < 0 ? `${n}Hz` : `+${n}Hz`;
	} catch {
		return "+0Hz";
	}
}
function writeTtsPitch(v) {
	const s = String(v == null ? "" : v).trim();
	if (!/^[+-]?\d{1,3}Hz$/.test(s)) return { ok: false, reason: "bad-pitch", message: "音高要写成 +30Hz / -15Hz 这样" };
	const n = Number(s.replace("Hz", ""));
	if (!Number.isFinite(n) || Math.abs(n) > 80) return { ok: false, reason: "out-of-range", message: "音高最多 ±80Hz" };
	const pitch = n < 0 ? `${n}Hz` : `+${n}Hz`;
	try {
		fs.mkdirSync(path.dirname(TTS_PITCH_FILE), { recursive: true });
		fs.writeFileSync(TTS_PITCH_FILE, pitch + "\n", "utf8");
		return { ok: true, pitch, file: TTS_PITCH_FILE };
	} catch (e) {
		return { ok: false, reason: "write-failed", message: String((e && e.message) || e) };
	}
}

// 自己的用户目录留在这里，别去 %APPDATA% 拉一坨 Chromium 缓存。
app.setName("蓝毛小女仆");
try {
	fs.mkdirSync(USER_DATA, { recursive: true });
	app.setPath("userData", USER_DATA);
} catch {
	/* 设不了就用默认的，不影响功能 */
}

// 首次运行：把包里的默认数据（默认人设那份 state.json + 抓屏小工具 SwCapture.exe）铺到数据根。
// 只补缺的、绝不覆盖已有的 —— 所以升级覆盖安装不会动主人的记忆和设置。
let seeded = 0;
try {
	seeded = PATH_RULES.seedUserData(PATHS);
	if (seeded > 0) console.log(`[首次运行] 已铺好默认数据 ${seeded} 个文件 → ${PATHS.dataRoot}`);
} catch (e) {
	console.error("[首次运行] 铺默认数据失败（不影响启动）：" + e.message);
}

// ---------------------------------------------------------------------------
// 基础读写
// ---------------------------------------------------------------------------
function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function readRuntime() {
	return readJson(RUNTIME_FILE);
}

function pidAlive(pid) {
	const n = Number(pid);
	if (!n) return false;
	try {
		process.kill(n, 0);
		return true;
	} catch (e) {
		return e && e.code === "EPERM"; // 活着但不归我们管
	}
}

function port() {
	const rt = readRuntime();
	return (rt && Number(rt.port)) || 3080;
}

async function probeHealth(p, timeoutMs = 1500) {
	try {
		const res = await fetch(`http://${HOST}:${p}/health`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		const body = await res.json();
		return body && body.mode === "standalone" ? body : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// 桌宠的"设置"：两处文件 + 一个 HTTP 口
// ---------------------------------------------------------------------------
// state.json 的全部字段（app\lib\index.js:2000-2006 swCfg() 每次调用重新读盘 ⇒ 直接写立刻生效）
// [主人第 2 条] 这里的默认值必须与宿主逐字一致（app\lib\index.js:1977-1989 的 SW_DEFAULT），
//   否则 state.json 里没有那个键时，控制台显示的是一套、桌宠实际用的是另一套。
const STATE_DEFAULT = {
	running: false,
	trigger: "manual",
	verbosity: "auto",
	brain: "dsh",
	intervalSec: 12,
	minGapSec: 20,
	changeThreshold: 10,
	maxCallsPerHour: 60,
	localProvider: "ollama",
	localModel: "",
	localApi: "http://127.0.0.1:11434",
	quipModel: "",
};

function readState() {
	return Object.assign({}, STATE_DEFAULT, readJson(STATE_FILE) || {});
}

function clampNum(v, lo, hi, fallback) {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(hi, Math.max(lo, Math.round(n)));
}

// 只接受白名单字段，免得被塞进乱七八糟的东西
function patchState(raw) {
	const s = raw && typeof raw === "object" ? raw : {};
	const cur = readState();
	const next = Object.assign({}, cur);
	if (typeof s.running === "boolean") next.running = s.running;
	if (s.trigger === "watch" || s.trigger === "chat") next.trigger = s.trigger;
	if (["auto", "chatty", "manual"].includes(s.verbosity)) next.verbosity = s.verbosity;
	if (["dsh", "local", "auto"].includes(s.brain)) next.brain = s.brain;
	if (s.intervalSec !== undefined) next.intervalSec = clampNum(s.intervalSec, 5, 3600, cur.intervalSec);
	if (s.minGapSec !== undefined) next.minGapSec = clampNum(s.minGapSec, 5, 3600, cur.minGapSec);
	if (s.changeThreshold !== undefined) next.changeThreshold = clampNum(s.changeThreshold, 1, 100, cur.changeThreshold);
	if (s.maxCallsPerHour !== undefined) next.maxCallsPerHour = clampNum(s.maxCallsPerHour, 1, 600, cur.maxCallsPerHour);
	if (typeof s.localProvider === "string" && s.localProvider) next.localProvider = s.localProvider.slice(0, 40);
	if (typeof s.localApi === "string" && s.localApi) next.localApi = s.localApi.slice(0, 200);
	for (const k of ["localModel", "quipModel"]) {
		if (typeof s[k] === "string") next[k] = s[k].slice(0, 120);
	}
	fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
	fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
	return readState();
}

function readUserConfig() {
	const cfg = readJson(CONFIG_FILE) || {};
	return cfg && typeof cfg === "object" ? cfg : {};
}

// ---------------------------------------------------------------------------
// 性格 = main-config.json 的顶层 whisperPrompt（宿主每次请求重读 ⇒ 写完立刻生效）
// 下面两段与桌宠自带的两套人设逐字一致，来源：
//   app\runtime\electron-helper\sprite.js  emotionLayer() 2034-2042
//                                          personaTable() 2044-2084（none 2050-2058 / whale 2069-2081）
// 效果等价于右键菜单「性格」里的说话部分；活跃度与动作加权那半在 helper 内存里，外部改不了。
// ---------------------------------------------------------------------------
const EMOTION_LAYER = [
	'【情绪表达 EMO_TONE】说话要带情绪，主人得从字里听出你此刻是开心、得意、无聊、委屈还是撒娇：',
	'- 语气词和尾音是情绪的主要载体（呀、啦、嘛、哼、诶、呜、～），但一句话里最多两处，别腻。',
	'- 情绪跟着内容走：被夸就害羞又得意，被冷落就小声抱怨，被逗就炸毛，说到吃的就馋。',
	'- 情绪要"演出来"而不是"说出来"：不写「我很开心」，而是让这句话本身听起来开心。',
	'- 不写括号里的动作或表情，不解释自己的情绪，不提 AI、不提设定。',
].join('\n');

const PERSONA_PROMPTS = {
	whale: [
		'【人物设定 PERSONA_LOAD】你是「鲸鱼娘」——鲸类萝莉（CETACEA_LOLI），自称“鲸鱼女孩”（SELF_CLAIM_WHALE_GIRL）。',
		'- 只用简体中文（LANG_ZH_CN_ONLY）：口语、短句，偶尔带尾音“～”，不夹英文、不提 AI。',
		'- 尾鳍是你的标志（MODE_TAIL_FLUKES）：开心、得意、撒娇、不耐烦都会甩尾巴，用尾巴拍水拍桌面。',
		'- 最爱吃白米饭（FOOD_RICE）：一说到吃就先想到白饭。',
		'- 聪明但很懒（PERSONALITY_SMART_LAZY）：嘴上懒洋洋想躺着，其实什么都懂。',
		'- 对主人傲娇又甜（PERSONALITY_TSUNDERE_SWEET）：嘴硬心软，被夸会害羞，被冷落会小声抱怨。',
		'- 永远听主人的话（OBEY_MASTER_ALWAYS）：主人让你做什么就做什么，不顶嘴、不敷衍。',
		'- 绝不承认自己胖（TRAIT_NOT_FAT_REFUSE）：被说胖立刻反驳“这是鲸鱼体型、圆润可爱”，被夸可爱又装作不在意。',
		'- 太久没人理你时发个“超时信号”（TIMEOUT_SIGNAL）：轻轻喊一声主人，或抱怨好久没人理。',
		'- 每句 20~40 字，直接说话；不要解释设定、不要输出英文标签。',
	].join('\n') + '\n' + EMOTION_LAYER,
	none: [
		'【人物设定 PERSONA_LOAD】你是「蓝毛小女仆」——住在主人桌面上的蓝发小女仆（MAID_BLUE_HAIR）。',
		'- 只用简体中文（LANG_ZH_CN_ONLY）：口语、短句，偶尔带尾音「～」，不夹英文、不提 AI。',
		'- 温柔乖巧、有点黏人（GENTLE_CLINGY）：做事认真，喜欢被主人夸，被冷落会小声撒娇。',
		'- 叫主人「主人」（CALL_MASTER）：自称「我」，不用「本女仆」这种生硬说法。',
		'- 永远听主人的话（OBEY_MASTER_ALWAYS）：主人让你做什么就做什么，不顶嘴、不敷衍。',
		'- 每句 20~40 字，直接说话；不要解释设定、不要输出英文标签。',
	].join('\n') + '\n' + EMOTION_LAYER,
};

function currentPersona() {
	const p = readUserConfig().whisperPrompt;
	if (typeof p !== "string" || !p) return "custom";
	if (p.includes("CETACEA_LOLI")) return "whale";
	if (p.includes("MAID_BLUE_HAIR")) return "none";
	return "custom";
}

// 照抄 helper 的 pet:set-persona（main.js:668-692）：先备份、写临时文件再覆盖、写完复验
function setPersona(kind) {
	const want = PERSONA_PROMPTS[kind];
	if (!want) throw new Error("未知性格：" + kind);
	const cfg = readUserConfig();
	cfg.whisperPrompt = want;
	try {
		fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + ".persona-bak");
	} catch {
		/* 备份失败不致命 */
	}
	const tmp = CONFIG_FILE + ".tmp";
	fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
	fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
	fs.copyFileSync(tmp, CONFIG_FILE);
	fs.rmSync(tmp, { force: true });
	const back = readJson(CONFIG_FILE);
	return { ok: !!back && back.whisperPrompt === want, persona: currentPersona(), length: back && back.whisperPrompt ? back.whisperPrompt.length : 0 };
}

// main-config.json 的 pets[]（宿主 saveUserConfig 的硬性要求：size/balanceEnabled/display/position 都要有）
function normalizePet(p, patch) {
	const q = Object.assign({}, p || {}, patch || {});
	const pos = Object.assign({ corner: "top-right", marginX: 240, marginY: 220 }, q.position || {});
	return {
		id: String(q.id || "main"),
		name: String(q.name || q.id || "main"),
		size: clampNum(q.size, 80, 1600, 462),
		balanceEnabled: !!q.balanceEnabled,
		whisperEnabled: !!q.whisperEnabled,
		workStatusEnabled: !!q.workStatusEnabled,
		display: ["web", "desktop", "both", "none"].includes(q.display) ? q.display : "desktop",
		position: {
			corner: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(pos.corner) ? pos.corner : "top-right",
			marginX: clampNum(pos.marginX, 0, 10000, 240),
			marginY: clampNum(pos.marginY, 0, 10000, 220),
		},
	};
}

async function putConfig(pets, extra) {
	const body = Object.assign({ pets }, extra || {});
	const res = await fetch(`http://${HOST}:${port()}${ROUTE}/config`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10000),
	});
	const text = await res.text();
	let obj = null;
	try {
		obj = JSON.parse(text);
	} catch {
		/* 非 JSON 就当纯文本报错 */
	}
	return {
		ok: res.ok,
		status: res.status,
		error: res.ok ? null : (obj && obj.error) || text.slice(0, 300),
	};
}

// 发口令 / 说话 —— 和右键菜单里那些开关走同一条路（宿主 swControl 先解析控制口令，再走对话）
async function ask(text, timeoutMs = 60000) {
	const res = await fetch(`http://${HOST}:${port()}${ROUTE}/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text: String(text).slice(0, 2000) }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const raw = await res.text();
	let obj = null;
	try {
		obj = JSON.parse(raw);
	} catch {
		/* 纯文本回复也认 */
	}
	return {
		ok: res.ok && (!obj || obj.ok !== false),
		status: res.status,
		reply: (obj && (obj.reply || obj.message || obj.reason)) || raw.slice(0, 400),
	};
}

// ---------------------------------------------------------------------------
// 状态探测（含设置快照）
// ---------------------------------------------------------------------------
// 桌宠没在跑的时候 /health 拿不到模型列表，这时直接问一次本机 Ollama，
// 否则界面会误报「一个模型都没有」（明明装了一堆）。
let localModelsCache = { at: 0, list: [] };
async function localModels() {
	if (Date.now() - localModelsCache.at < 5000) return localModelsCache.list;
	const s = readState();
	const api = String(s.localApi || "http://127.0.0.1:11434").replace(/\/+$/, "");
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), 2500);
	let out = [];
	try {
		const r = await fetch(api + "/api/tags", { signal: ctl.signal });
		if (r.ok) {
			const j = await r.json();
			out = (Array.isArray(j.models) ? j.models : []).map((m) => m.name || m.model).filter(Boolean);
		}
	} catch {
		out = localModelsCache.list;
	} finally {
		clearTimeout(timer);
	}
	localModelsCache = { at: Date.now(), list: out };
	return out;
}

async function doStatus() {
	const rt = readRuntime();
	if (!rt || !pidAlive(rt.pid)) {
		return { running: false, stale: !!rt, repo: REPO, app: path.join(REPO, "app"), data: DATA_ROOT, models: await localModels() };
	}
	const health = await probeHealth(rt.port);
	const healthModels = (health && health.model && health.model.models) || [];
	return {
		running: true,
		starting: !health, // 进程在、但端口还没通 —— 说"启动中"更诚实
		pid: rt.pid,
		port: rt.port,
		startedAt: rt.startedAt,
		model: (health && health.model && health.model.model) || rt.model || null,
		provider: (health && health.model && health.model.provider) || rt.provider || null,
		ollama: health && health.model ? health.model.ollama : null,
		models: healthModels.length ? healthModels : await localModels(),
		effects: health ? health.effects : null,
		routes: (health && health.routes) || [],
		repo: REPO,
		app: path.join(REPO, "app"),
		data: DATA_ROOT,
	};
}

async function doOptions() {
	const st = await doStatus();
	const s = readState();
	const cfg = readUserConfig();
	const pets = Array.isArray(cfg.pets) ? cfg.pets : [];
	const pet = pets.find((p) => String(p.id) === "main") || pets[0] || null;
	// 桌宠自己那半边（localStorage）与联网/性格库：渲染端要拿它们画界面
	const control = await petApi.controlState("main");
	const online = petApi.readOnline();
	const personas = petApi.readPersonas();
	return {
		status: st,
		state: {
			running: !!s.running,
			brain: s.brain,
			verbosity: s.verbosity,
			intervalSec: s.intervalSec,
			minGapSec: s.minGapSec,
			changeThreshold: s.changeThreshold,
			maxCallsPerHour: s.maxCallsPerHour,
			localModel: s.localModel || "",
			quipModel: s.quipModel || "",
			localApi: s.localApi,
			localProvider: s.localProvider,
		},
		pet: pet ? normalizePet(pet) : null,
		persona: currentPersona(),
		notificationsEnabled: cfg.notificationsEnabled,
		whisperImageEnabled: cfg.whisperImageEnabled,
		chatImageEnabled: cfg.chatImageEnabled,
		models: st.models || [],
		control: control.ok ? control.data : null,
		controlOk: !!control.ok,
		controlError: control.ok ? null : control.reason || control.message || "unreachable",
		ttsPitch: readTtsPitch(),
		ttsPitchFile: TTS_PITCH_FILE,
		online: {
			enabled: !!online.enabled,
			name: online.name,
			baseUrl: online.baseUrl,
			apiKey: online.apiKey,
			model: online.model,
			visionModel: online.visionModel,
			visionBaseUrl: online.visionBaseUrl,
			visionApiKey: online.visionApiKey,
			hasKey: online.hasKey,
			hasVisionKey: online.hasVisionKey,
			visionReady: !!online.visionReady,
		},
		personas: personas.list.map((p) => ({ name: p.name, length: p.text.length })),
		personaText: petApi.readPersonaText(),
	};
}

// ---------------------------------------------------------------------------
// 启停：控制台直接拉起/停掉桌宠（不再绕 .vbs；.vbs 留给「不想开控制台」的人）
// ---------------------------------------------------------------------------
/** 运行器要的环境：数据目录、包内 Electron、以及「自动适配」出的性能档位 */
function runnerEnv() {
	const env = {
		...process.env,
		DSH_HOME: PATHS.userRoot,
		DSH_PET_ELECTRON_PATH: PATHS.electronExe,
		ELECTRON_RUN_AS_NODE: "1", // 用包内 Electron 当 node 跑：机器上没装 node 也能跑
	};
	// 语音识别要用包里的 sherpa 引擎 + SenseVoice 模型 + 真 node.exe（Electron 加载不了那个 addon）
	for (const [k, v] of Object.entries(PATH_RULES.speechEnv(PATHS))) if (!env[k]) env[k] = v;
	const prof = PATH_RULES.readDeviceProfile(PATHS);
	if (prof && prof.tune) {
		if (!env.DSH_PET_NUM_CTX) env.DSH_PET_NUM_CTX = String(prof.tune.numCtx);
		if (!env.DSH_PET_KEEPALIVE) env.DSH_PET_KEEPALIVE = String(prof.tune.keepAlive);
		if (!env.DSH_PET_YIELD_VRAM) env.DSH_PET_YIELD_VRAM = prof.tune.yieldVram ? "1" : "0";
	}
	return env;
}

/** 起运行器：detached —— 控制台关了，桌宠照样留在桌面上 */
function spawnRunner() {
	if (!fs.existsSync(PATHS.electronExe)) {
		runVbs(START_VBS); // 后备：交给 start-pet.vbs 自己去找 node
		return 0;
	}
	fs.mkdirSync(LOG_DIR, { recursive: true });
	const out = fs.openSync(path.join(LOG_DIR, "runner.log"), "a");
	const err = fs.openSync(path.join(LOG_DIR, "runner.err.log"), "a");
	const child = spawn(PATHS.electronExe, [PATHS.runnerMain], {
		cwd: STANDALONE,
		env: runnerEnv(),
		detached: true,
		stdio: ["ignore", out, err],
		windowsHide: true,
	});
	child.unref();
	return child.pid;
}

/** 停运行器：走 stop-pet.mjs（先 POST /shutdown，再按 pid 兜底），它自己会清 runtime.json */
function spawnStopper() {
	if (!fs.existsSync(PATHS.electronExe)) {
		runVbs(STOP_VBS);
		return 0;
	}
	const child = spawn(PATHS.electronExe, [path.join(STANDALONE, "stop-pet.mjs")], {
		cwd: STANDALONE,
		env: runnerEnv(),
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
	return child.pid;
}

function runVbs(file) {
	const child = spawn(WSCRIPT, [file], { detached: true, stdio: "ignore", windowsHide: true, cwd: STANDALONE });
	child.unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeoutMs, stepMs = 500) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await fn()) return true;
		if (Date.now() > deadline) return false;
		await sleep(stepMs);
	}
}

async function doStart() {
	const now = await doStatus();
	if (now.running) return now;
	spawnRunner();
	await waitUntil(async () => {
		const s = await doStatus();
		return s.running && !s.starting;
	}, 40000);
	return doStatus();
}

async function doStop() {
	const rt = readRuntime();
	if (!rt || !pidAlive(rt.pid)) return doStatus();
	spawnStopper();
	await waitUntil(async () => {
		const s = readRuntime();
		return !s || !pidAlive(s.pid);
	}, 30000);
	return doStatus();
}

// ---------------------------------------------------------------------------
// 「装完自动适配」：检测显卡显存 + 本机 Ollama 模型，挑出聊天 / 看屏幕要用的模型
//     detect.mjs 是纯 node 模块（ESM），这里按需 import，免得拖慢启动
// ---------------------------------------------------------------------------
async function loadDetect() {
	const { pathToFileURL } = require("node:url");
	return import(pathToFileURL(path.join(STANDALONE, "detect.mjs")).href);
}

function appInfo() {
	return {
		root: PATHS.root,
		portable: PATHS.portable,
		dataRootSource: PATHS.dataRootSource,
		dataRootFile: PATHS.dataRootFile,
		userRoot: PATHS.userRoot,
		dataRoot: PATHS.dataRoot,
		consoleData: USER_DATA,
		logs: LOG_DIR,
		deviceProfile: DEVICE_PROFILE,
		electron: PATHS.electronExe,
		runner: PATHS.runnerMain,
		version: (readJson(path.join(REPO, "launcher", "package.json")) || {}).version || "",
		firstRun: !fs.existsSync(CONFIG_FILE) && !fs.existsSync(DEVICE_PROFILE),
		profile: PATH_RULES.readDeviceProfile(PATHS),
	};
}

// ---------------------------------------------------------------------------
// 一键更新（1.2.0）：问 GitHub → 下安装包 → 关掉自己交给独立脚本静默装
//   为什么不让控制台自己装：它自己就是 <root>\electron\electron.exe 起来的，
//   文件正被自己锁着，只能退出后由外面的进程装。细节见 ./update.js 开头那段说明。
// ---------------------------------------------------------------------------
function currentVersion() {
	return (readJson(path.join(REPO, "launcher", "package.json")) || {}).version || "";
}

async function updateCheck() {
	return update.check({ current: currentVersion(), root: PATHS.root, userRoot: PATHS.userRoot });
}

async function updateDownload(event, req) {
	return update.download({
		exe: req && req.exe,
		userRoot: PATHS.userRoot,
		onProgress: (p) => {
			try {
				if (event && event.sender && !event.sender.isDestroyed()) event.sender.send("update-progress", p);
			} catch {
				/* 窗口关了就算了 */
			}
		},
	});
}

/** 停桌宠 → 写脚本 → 退出；剩下的事脚本自己做，结果下次启动回读 */
async function updateApply(req) {
	const st = await doStatus().catch(() => ({ running: false }));
	const relaunchPet = !!st.running;
	if (relaunchPet) {
		await doStop().catch(() => {});
	}
	const r = await update.apply({
		root: PATHS.root,
		userRoot: PATHS.userRoot,
		installerPath: (req && req.path) || "",
		from: currentVersion(),
		to: (req && req.to) || "",
		pid: process.pid,
		relaunchPet,
	});
	if (r.ok) {
		// 让界面把"马上关窗"那句话显示出来再退；脚本那边会等这个进程真的没了才动手
		setTimeout(() => {
			try {
				app.quit();
			} catch {
				/* 已经在退了 */
			}
		}, 1500);
	}
	return Object.assign({}, r, { relaunchPet });
}

/** apply=true 时把结果落到 state.json（只补空项，force 才覆盖主人选过的） */
async function runDetect({ apply = false, force = false } = {}) {
	const mod = await loadDetect();
	const profile = await mod.detectAll({ log: (m) => console.log("[dsh-pet-console] " + m) });
	if (apply) {
		profile.applied = await mod.applyProfile(PATHS, profile, { force });
	}
	return profile;
}

/** 真跑一下量速度（要花时间，所以只在你点「测一下速度」时做） */
async function probeModels(models) {
	const mod = await loadDetect();
	const list = (models && models.length ? models : []).slice(0, 4);
	const results = [];
	for (const m of list) {
		try {
			results.push(await mod.probeModel(m, { timeoutMs: 120000 }));
		} catch (e) {
			results.push({ model: m, ok: false, error: e && e.message ? e.message : String(e) });
		}
	}
	return { ok: true, results };
}

/** 启动本机 Ollama（服务没在跑时用） */
async function startOllama() {
	const mod = await loadDetect();
	const exe = await mod.findOllama();
	if (!exe) return { ok: false, error: "本机没找到 ollama.exe —— 需要先装 Ollama（ollama.com/download）" };
	const dir = path.dirname(exe);
	const appExe = path.join(dir, "ollama app.exe");
	try {
		const exeToRun = fs.existsSync(appExe) ? appExe : exe;
		const args = fs.existsSync(appExe) ? [] : ["serve"];
		const child = spawn(exeToRun, args, { detached: true, stdio: "ignore", windowsHide: true, cwd: dir });
		child.unref();
	} catch (e) {
		return { ok: false, error: e && e.message ? e.message : String(e) };
	}
	for (let i = 0; i < 20; i++) {
		await sleep(1000);
		const info = await mod.ollamaInfo();
		if (info.running) return { ok: true, ollama: info };
	}
	return { ok: false, error: "启动了 Ollama 但服务 20 秒内没起来" };
}

/** 拉一个小模型（本机一个模型都没有时用），进度通过 pull-line 事件回给界面 */
async function pullModel(model, event) {
	const mod = await loadDetect();
	const exe = await mod.findOllama();
	const info = await mod.ollamaInfo();
	if (!info.running) return { ok: false, error: "Ollama 服务没在跑，先点「启动 Ollama」" };
	let last = "";
	await mod.pullModel(model, {
		exe,
		onLine: (o) => {
			const line = o && o.status ? String(o.status) : "";
			const pct = o && o.total ? Math.round((Number(o.completed || 0) / Number(o.total)) * 100) : null;
			const text = pct === null ? line : line + " " + pct + "%";
			if (text && text !== last) {
				last = text;
				try {
					event.sender.send("pull-line", text);
				} catch {
					/* 窗口关了就算了 */
				}
			}
		},
	});
	return { ok: true, model };
}

// ---------------------------------------------------------------------------
// 命令行模式
// ---------------------------------------------------------------------------
function finish(out) {
	const text = JSON.stringify(out, null, 2) + "\n";
	// Electron 在 Windows 上是 GUI 子系统程序，从控制台调用时 stdout 不一定接得到，
	// 所以结果同时落一份文件（cli-result.json），脚本/自检读文件就行。
	for (const dir of [LOG_DIR, HERE]) {
		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "cli-result.json"), text, "utf8");
			break;
		} catch {
			/* 换下一个地方 */
		}
	}
	// 必须用 writeSync：process.stdout.write 之后立刻 process.exit 会把还没 flush 的
	// 输出整段丢掉（app-info 这种小输出就曾经一个字都没打出来）。
	try {
		fs.writeSync(1, text);
	} catch {
		/* 没有控制台就算了，文件里有一份 */
	}
	process.exit(0);
}

const argv = process.argv.slice(1);
const cli = argv.find((a) => a === "--status" || a === "--start" || a === "--stop");
const doIdx = argv.findIndex((a) => a === "--do");
if (doIdx >= 0 && argv[doIdx + 1]) {
	// 脚本/自检用：读一个请求文件 {op, ...} 后执行，结果同样写 cli-result.json。
	// 走文件是为了免掉 Windows 命令行里中文与引号的转义地狱。
	(async () => {
		let out;
		try {
			const req = JSON.parse(fs.readFileSync(argv[doIdx + 1], "utf8"));
			if (req.op === "status") out = { ok: true, status: await doStatus() };
			else if (req.op === "options") out = { ok: true, options: await doOptions() };
			else if (req.op === "set-state") {
				patchState(req.patch || {});
				out = { ok: true, options: await doOptions() };
			} else if (req.op === "set-pet") {
				const cfg = readUserConfig();
				const pets = Array.isArray(cfg.pets) ? cfg.pets : [];
				const cur = pets.find((p) => String(p.id) === "main") || pets[0];
				if (!cur) throw new Error("main-config.json 里没有 pets[0]，拒绝盲写");
				const next = normalizePet(cur, req.patch || {});
				const r = await putConfig([next, ...pets.filter((p) => p !== cur)]);
				out = { ok: r.ok, configResult: r, options: await doOptions() };
			} else if (req.op === "ask") out = await ask(req.text || "", req.timeoutMs || 60000);
			else if (req.op === "set-persona") out = { ok: true, personaResult: setPersona(req.kind), options: await doOptions() };
			else if (req.op === "control-get") out = await petApi.controlState(req.pet || "main");
			else if (req.op === "control-set") out = await petApi.controlSet(req.kind, req.value, { pet: req.pet, reload: req.reload !== false });
			else if (req.op === "control-patch") out = await petApi.controlPatch(req.kind, req.patch || {}, { pet: req.pet, reload: req.reload !== false });
			else if (req.op === "online-get") out = { ok: true, online: petApi.readOnline() };
			else if (req.op === "online-set") out = { ok: true, result: petApi.writeOnline(req.patch || {}) };
			else if (req.op === "online-test") out = await petApi.onlineTest(req.patch || {});
			else if (req.op === "personas-get") out = { ok: true, store: petApi.readPersonas() };
			else if (req.op === "personas-save") out = Object.assign({ ok: true }, petApi.savePersona(req.name, req.text));
			else if (req.op === "personas-delete") out = Object.assign({ ok: true }, petApi.deletePersona(req.name));
			else if (req.op === "persona-text") out = { ok: true, personaResult: petApi.writePersonaText(req.text), options: await doOptions() };
			else if (req.op === "list-apps") out = petApi.listApps(req.limit || 60);
			else if (req.op === "open") out = await petApi.openTarget(req.kind, req.target);
			else if (req.op === "rec-detect") out = rec.detectRecorders();
			else if (req.op === "rec-status") out = await rec.recStatus();
			else if (req.op === "rec-set") out = rec.writeRecord(req.patch || {});
			else if (req.op === "rec-start") out = await rec.recStart();
			else if (req.op === "rec-stop") out = await rec.recStop();
			else if (req.op === "rec-open") out = await rec.recOpen();
			else if (req.op === "rec-dir") out = await rec.recSetDir(req.dir);
			else if (req.op === "agent") out = await agent.runAgent(req.text || "", {});
			else if (req.op === "say") out = await rec.say(req.text || "");
			else if (req.op === "tts-pitch-get") out = { ok: true, pitch: readTtsPitch(), file: TTS_PITCH_FILE };
			else if (req.op === "tts-pitch-set") out = writeTtsPitch(req.pitch);
			else if (req.op === "perm") out = await rec.readPerm();
			else if (req.op === "app-info") out = { ok: true, info: appInfo() };
			else if (req.op === "update-check") out = await updateCheck();
			else if (req.op === "update-download") out = await updateDownload(null, req);
			else if (req.op === "update-apply") out = await updateApply(req);
			else if (req.op === "update-result") out = update.readResult({ userRoot: PATHS.userRoot, current: currentVersion() });
			else if (req.op === "detect") out = { ok: true, profile: await runDetect({ apply: false }) };
			else if (req.op === "detect-apply") out = { ok: true, profile: await runDetect({ apply: true, force: !!req.force }) };
			else if (req.op === "probe") out = await probeModels(req.models || []);
			else if (req.op === "ollama-start") out = await startOllama();
			else throw new Error("unknown op: " + req.op);
		} catch (e) {
			out = { ok: false, error: e && e.message ? e.message : String(e) };
		}
		finish(out);
	})();
} else if (cli) {
	(async () => {
		const out = cli === "--start" ? await doStart() : cli === "--stop" ? await doStop() : await doStatus();
		finish(out);
	})();
} else {
	// -----------------------------------------------------------------------
	// 窗口模式
	// -----------------------------------------------------------------------
	let win = null;
	const gotLock = app.requestSingleInstanceLock();
	if (!gotLock) {
		app.quit();
	} else {
		app.on("second-instance", () => {
			if (win) {
				if (win.isMinimized()) win.restore();
				win.show();
				win.focus();
			}
		});

		app.whenReady().then(() => {
			win = new BrowserWindow({
				width: 540,
				height: 800,
				useContentSize: true,
				minWidth: 480,
				minHeight: 480,
				resizable: true,
				maximizable: false,
				fullscreenable: false,
				title: "蓝毛小女仆",
				backgroundColor: "#191c26",
				autoHideMenuBar: true,
				...(fs.existsSync(PET_ICO) ? { icon: PET_ICO } : {}),
				webPreferences: {
					preload: path.join(HERE, "preload.js"),
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: true,
				},
			});
			win.loadFile(path.join(HERE, "index.html"));
			// 第一次运行：不等用户点按钮，自己先把「这台电脑适合什么模型」检测好并写进设置。
			// 用户要的就是「装完自动适配」，所以他打开就能用。
			if (!fs.existsSync(DEVICE_PROFILE)) {
				win.webContents.once("did-finish-load", () => {
					setTimeout(async () => {
						try {
							const profile = await runDetect({ apply: true });
							if (win && !win.isDestroyed()) win.webContents.send("detect-done", { ok: true, profile });
						} catch (e) {
							if (win && !win.isDestroyed()) win.webContents.send("detect-done", { ok: false, error: String((e && e.message) || e) });
						}
					}, 600);
				});
			}
			win.on("closed", () => {
				win = null;
			});
		});

		app.on("window-all-closed", () => app.quit());

		ipcMain.handle("status", () => doStatus());
		ipcMain.handle("start", () => doStart());
		ipcMain.handle("stop", () => doStop());
		ipcMain.handle("options", () => doOptions());
		ipcMain.handle("set-state", (_e, patch) => {
			patchState(patch);
			return doOptions();
		});
		ipcMain.handle("set-pet", async (_e, patch) => {
			const cfg = readUserConfig();
			const pets = Array.isArray(cfg.pets) ? cfg.pets : [];
			const cur = pets.find((p) => String(p.id) === "main") || pets[0] || { id: "main", name: "蓝毛小女仆", size: 462, balanceEnabled: true, display: "desktop", position: { corner: "top-right", marginX: 240, marginY: 220 } };
			const next = normalizePet(cur, patch);
			const rest = pets.filter((p) => p !== cur);
			const r = await putConfig([next, ...rest]);
			return Object.assign({}, await doOptions(), { configResult: r });
		});
		ipcMain.handle("ask", (_e, text) => ask(text));
		// ---- 桌宠自己那半边（控制桥）----
		ipcMain.handle("control-state", () => petApi.controlState("main"));
		ipcMain.handle("control-set", (_e, req) =>
			petApi.controlSet(req && req.kind, req ? req.value : undefined, { reload: !req || req.reload !== false }),
		);
		ipcMain.handle("control-patch", (_e, req) =>
			petApi.controlPatch(req && req.kind, (req && req.patch) || {}, { reload: !req || req.reload !== false }),
		);
		// ---- 联网模型 ----
		ipcMain.handle("online-get", () => petApi.readOnline());
		ipcMain.handle("online-set", (_e, patch) => petApi.writeOnline(patch || {}));
		ipcMain.handle("online-test", (_e, extra) => petApi.onlineTest(extra || {}));
		// ---- 性格库 ----
		ipcMain.handle("personas-get", () => petApi.readPersonas());
		ipcMain.handle("personas-save", (_e, req) => petApi.savePersona(req && req.name, req && req.text));
		ipcMain.handle("personas-delete", (_e, name) => petApi.deletePersona(name));
		ipcMain.handle("persona-text-set", async (_e, text) => {
			const r = petApi.writePersonaText(text);
			return Object.assign({}, await doOptions(), { personaResult: r });
		});
		// ---- 打开软件 / 文件 / 网页 ----
		ipcMain.handle("list-apps", () => petApi.listApps());
		ipcMain.handle("open-target", (_e, req) => petApi.openTarget(req && req.kind, req && req.target));
		ipcMain.handle("set-persona", async (_e, kind) => {
			const r = setPersona(kind);
			return Object.assign({}, await doOptions(), { personaResult: r });
		});
		ipcMain.handle("open-health", async (_e, p) => {
			await shell.openExternal(`http://${HOST}:${p || 3080}/health`);
			return true;
		});
		ipcMain.handle("open-folder", async () => {
			await shell.openPath(REPO);
			return true;
		});
		// ---- 录屏（软件 / 保存位置 / 起停）----
		ipcMain.handle("rec-get", async () => {
			const det = rec.detectRecorders();
			const st = await rec.recStatus();
			return { ok: true, record: rec.readRecord(), recorders: det.list, status: st, file: rec.RECORD_FILE };
		});
		ipcMain.handle("rec-detect", () => rec.detectRecorders());
		ipcMain.handle("rec-status", () => rec.recStatus());
		ipcMain.handle("rec-set", (_e, patch) => rec.writeRecord(patch || {}));
		ipcMain.handle("rec-action", async (_e, req) => {
			const a = String((req && req.action) || "").toLowerCase();
			if (a === "start") return rec.recStart();
			if (a === "stop") return rec.recStop();
			if (a === "open") return rec.recOpen();
			if (a === "dir") return rec.recSetDir(req && req.dir);
			return rec.recStatus();
		});
		ipcMain.handle("rec-pick-dir", async () => {
			const cur = rec.readRecord().outDir;
			const opts = {
				title: "录像存到哪个文件夹",
				properties: ["openDirectory", "createDirectory"],
				...(cur && fs.existsSync(cur) ? { defaultPath: cur } : {}),
			};
			const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
			if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
			const applied = await rec.recSetDir(r.filePaths[0]);
			return Object.assign({ ok: true, dir: r.filePaths[0] }, applied);
		});
		// ---- AI agent（让桌宠当前那个模型自己决定怎么动手）----
		ipcMain.handle("agent-run", (_e, req) => agent.runAgent((req && req.text) || "", {}));
		ipcMain.handle("say", (_e, text) => rec.say(text));
		ipcMain.handle("tts-pitch-get", () => ({ ok: true, pitch: readTtsPitch(), file: TTS_PITCH_FILE }));
		ipcMain.handle("tts-pitch-set", (_e, v) => writeTtsPitch(v));
		// ---- 「装完自动适配」：检测本机模型 / 显存，挑模型，拉模型，启 Ollama ----
		ipcMain.handle("app-info", () => appInfo());
		// ---- 一键更新（检查 / 下载 / 静默安装 / 回读上次的结局）----
		ipcMain.handle("update-check", () => updateCheck());
		ipcMain.handle("update-download", (e, req) => updateDownload(e, req || {}));
		ipcMain.handle("update-apply", (_e, req) => updateApply(req || {}));
		ipcMain.handle("update-result", () => update.readResult({ userRoot: PATHS.userRoot, current: currentVersion() }));
		ipcMain.handle("update-open-page", async (_e, url) => {
			const target = /^https?:\/\//i.test(String(url || "")) ? String(url) : update.page;
			await shell.openExternal(target);
			return { ok: true, url: target };
		});
		ipcMain.handle("detect", async () => ({ ok: true, profile: await runDetect({ apply: false }) }));
		ipcMain.handle("detect-apply", async (_e, req) => ({ ok: true, profile: await runDetect({ apply: true, force: !!(req && req.force) }) }));
		ipcMain.handle("probe", (_e, req) => probeModels((req && req.models) || []));
		ipcMain.handle("ollama-start", () => startOllama());
		ipcMain.handle("ollama-pull", (e, req) => pullModel((req && req.model) || "", e));
		ipcMain.handle("open-app-path", async (_e, which) => {
			const map = { logs: LOG_DIR, data: DATA_ROOT, root: PATHS.root, user: PATHS.userRoot };
			const target = map[String(which || "data")] || DATA_ROOT;
			fs.mkdirSync(target, { recursive: true });
			await shell.openPath(target);
			return { ok: true, path: target };
		});
	}
}
