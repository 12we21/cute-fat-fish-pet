"use strict";
// 说明（1.1.0 独立仓库）：本文件**就是成品源码**，不再由「蓝本 + 生成脚本」产出——
// 老版本那套覆盖层（build\mk-petapi-overlay.mjs）连同 overlay\、patch-app.mjs 一起取消了。
// 下面三点当年是「发布版改动」，现在就是本文件的本体行为，改这里就是改成品：
//  ① 控制桥 / 配置文件跟着「每用户数据根」走（见 ./paths.js 的 resolvePaths）；
//  ② 性格库放在用户数据目录（老位置只读回退）；
//  ③ 控制文件不在时不扫 3099+ 端口（免得连到同一台机器上另一只桌宠）。
// [bridge-auth@1] 本文件另外承担「控制桥密钥」这一层：读 helper-control.json 的 token 并带进
// Authorization / X-Pet-Token（readToken / authHeaders），401 时给人话提示——删掉它控制台就连不上了。
// 桌宠「够不着的那半边」的接口层。
//
// 一、控制桥（权限 / 语音模式 / 活跃度 / 自主说话 / AI 导演 / 本地文本模型偏好）
//     这些状态躺在桌宠渲染进程的 localStorage 里，外部进程本来够不着。
//     副本里的 helper 主进程开了一个只监听 127.0.0.1 的小服务（app\runtime\electron-helper\main.js 的
//     startControlBridge），端口写在 <repo>\dsh-pet\helper-control.json。这里负责找它、读它、写它。
//     注意：渲染进程只在启动时把那几个键读进内存，所以写完必须 reload 才真的生效（helper 会做）。
//
// 二、联网模型（OpenAI 兼容）配置：standalone\online.json —— 独立版的两条出话通路之一。
//
// 三、自定义性格：直接写 main-config.json 的 whisperPrompt（宿主每次请求都重读 ⇒ 立刻生效）。
//
// 四、打开软件 / 文件 / 网页：交给 Electron 的 shell，纯本地动作，不经过桌宠。

const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..");
// [发布版改动 1] 数据根不再是 <repo>\dsh-pet，而是「每用户数据根」下的 dsh-pet
//（%APPDATA%\BlueHairMaid，或 portable.txt / data-root.txt 指定的地方）——
// 桌宠助手就把 helper-control.json / main-config.json 写在那儿。
const PATHS = require("./paths").resolvePaths(HERE);
const DATA_ROOT = PATHS.dataRoot;
const CONTROL_FILE = path.join(DATA_ROOT, "helper-control.json");
const ONLINE_FILE = path.join(PATHS.standaloneDir, "online.json");
const CONFIG_FILE = path.join(DATA_ROOT, "main-config.json");
// [发布版改动 2] 性格库改放用户数据目录：安装到 Program Files 时程序目录可能只读，
// 写在那儿会保存失败。老位置留着当只读回退，升级上来的用户不会丢性格。
const PERSONAS_FILE = path.join(PATHS.consoleUserData, "personas.json");
const LEGACY_PERSONAS_FILE = path.join(HERE, "personas.json");
const HOST = "127.0.0.1";
const CONTROL_PORTS = Array.from({ length: 12 }, (_, i) => 3099 + i);

// 跟 helper 的 CONTROL_KEY_RE 对齐：只认这些族
const KINDS = ["perm", "voice", "mood", "talk", "textmodel", "tts", "speech", "cache"];
const KIND_SET = new Set(KINDS);

const keyFor = (kind, petId) => `dsh-pet-${kind}-${petId || "main"}`;

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function writeJson(file, obj, mode) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { encoding: "utf8", mode: mode || 0o644 });
	fs.copyFileSync(tmp, file);
	fs.rmSync(tmp, { force: true });
}

// ---------------------------------------------------------------------------
// 一、控制桥
// ---------------------------------------------------------------------------
let cachedPort = 0;

// [bridge-auth] 控制桥从 1.1 起带密钥：helper 启动时把随机 token 写进 helper-control.json
//（跟 port 同一个文件），读 /state、写 /set 都要在请求头里带上。文件里没有 token = 对面是
// 老版本 helper，照样把请求发出去（向后兼容），只是会收到 401 —— 那时下面的 401 分支会给出
// 人话提示，不会静默失败。
function readToken() {
	const rec = readJson(CONTROL_FILE);
	return rec && typeof rec.token === "string" && rec.token ? rec.token : "";
}

function authHeaders(extra) {
	const t = readToken();
	const h = Object.assign({}, extra || {});
	if (t) {
		h.authorization = `Bearer ${t}`;
		h["x-pet-token"] = t;
	}
	return h;
}

/** 读应答：JSON 解不出来（比如代理塞了个 HTML 错误页）也要能给出一句人话，别抛在调用方。 */
async function readBody(res) {
	const text = await res.text().catch(() => "");
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return { ok: false, reason: "bad-response", message: `控制桥回了非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}` };
	}
}

async function pingControl(p, timeoutMs = 700) {
	try {
		const res = await fetch(`http://${HOST}:${p}/health`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		const body = await res.json();
		return body && body.ok && body.mode === "helper-control" ? body : null;
	} catch {
		return null;
	}
}

/** 找控制桥：先看桌宠写在磁盘上的端口，再自己从 3099 往上扫。 */
async function controlPort(force) {
	if (!force && cachedPort && (await pingControl(cachedPort))) return cachedPort;
	const rec = readJson(CONTROL_FILE);
	if (rec && Number(rec.port) && (await pingControl(Number(rec.port)))) {
		cachedPort = Number(rec.port);
		return cachedPort;
	}
	// [发布版改动 3] 控制文件**根本不在**时不扫端口：那说明自家这只没在跑，
	// 而 3099 往上可能坐着别的实例（同一台机器上两只并存是常事）——扫过去就会改到别人家的设置。
	// 文件在、只是端口没响应（桌宠刚重启），才值得扫一圈找回它。
	if (!rec && !fs.existsSync(CONTROL_FILE)) {
		cachedPort = 0;
		return 0;
	}
	for (const p of CONTROL_PORTS) {
		if (await pingControl(p)) {
			cachedPort = p;
			return p;
		}
	}
	cachedPort = 0;
	return 0;
}

function parseState(raw) {
	const out = {};
	for (const [k, v] of Object.entries(raw || {})) {
		const m = /^dsh-pet-([a-z]+)-(.+)$/.exec(k);
		if (!m || !KIND_SET.has(m[1])) continue;
		let val = v;
		try {
			val = JSON.parse(v);
		} catch {
			/* 不是 JSON 就原样给字符串 */
		}
		out[m[1]] = val;
	}
	return out;
}

/** 读回桌宠渲染进程里那几个 localStorage 键（唯一能拿到它们的办法）。 */
async function controlState(petId) {
	const p = await controlPort();
	if (!p) return { ok: false, reason: "no-control-bridge", hint: "桌宠没在跑，或者 helper 还没起来" };
	try {
		const res = await fetch(`http://${HOST}:${p}/state?pet=${encodeURIComponent(petId || "main")}`, {
			headers: authHeaders(),
			signal: AbortSignal.timeout(4000),
		});
		const body = await readBody(res);
		if (res.status === 401 || (body && body.reason === "unauthorized")) {
			return { ok: false, reason: "unauthorized", message: `控制桥要密钥，但 ${CONTROL_FILE} 里没有可用的 token（或者对面是老版本 helper）——请让桌宠重启一次再试` };
		}
		if (!res.ok) {
			return { ok: false, reason: "control-error", message: (body && (body.message || body.reason)) || `HTTP ${res.status}` };
		}
		return { ok: true, port: p, pid: body && body.pid, data: parseState(body && body.state) };
	} catch (e) {
		return { ok: false, reason: "control-error", message: String((e && e.message) || e) };
	}
}

/** 写一个键（整值覆盖）。reload=true 时 helper 会刷新渲染进程让它立刻生效。 */
async function controlSet(kind, value, opts) {
	const o = opts || {};
	if (!KIND_SET.has(kind)) return { ok: false, reason: "bad-kind", kind };
	const p = await controlPort();
	if (!p) return { ok: false, reason: "no-control-bridge" };
	try {
		const res = await fetch(`http://${HOST}:${p}/set`, {
			method: "POST",
			headers: authHeaders({ "content-type": "application/json" }),
			body: JSON.stringify({
				pet: o.pet || "main",
				key: keyFor(kind, o.pet),
				// 字符串按键（textmodel 那种）桌宠是**原样**读的，不能再套一层 JSON 引号；
				// 对象按键（mood/talk/perm/voice/tts…）桌宠是 JSON.parse 读的，所以要序列化。
				value: typeof value === "string" ? value : JSON.stringify(value === undefined ? null : value),
				reload: o.reload !== false,
			}),
			signal: AbortSignal.timeout(8000),
		});
		const body = await readBody(res);
		if (res.status === 401 || (body && body.reason === "unauthorized")) {
			return { ok: false, reason: "unauthorized", port: p, message: `控制桥拒绝了这次写入：密钥不对或读不到（${CONTROL_FILE}），桌宠重启一次再来` };
		}
		return Object.assign({ ok: res.ok && (!body || body.ok !== false), port: p }, body || {});
	} catch (e) {
		return { ok: false, reason: "control-error", message: String((e && e.message) || e) };
	}
}

/** 改一部分字段（读-改-写；log 之类原样保留）。 */
async function controlPatch(kind, patch, opts) {
	const cur = await controlState((opts && opts.pet) || "main");
	if (!cur.ok) return cur;
	const base = cur.data[kind];
	const next = Object.assign({}, base && typeof base === "object" ? base : {}, patch || {});
	const r = await controlSet(kind, next, opts);
	return Object.assign(r, { value: next });
}

// ---------------------------------------------------------------------------
// 二、联网模型（OpenAI 兼容）
// ---------------------------------------------------------------------------
const ONLINE_DEFAULT = {
	enabled: false,
	name: "联网模型",
	baseUrl: "https://api.deepseek.com",
	apiKey: "",
	model: "deepseek-chat",
	visionModel: "",
	// 看屏幕那条路可以单独指一个「看得懂图」的服务；留空 = 跟聊天共用上面那套
	visionBaseUrl: "",
	visionApiKey: "",
};

function readOnline() {
	const raw = readJson(ONLINE_FILE) || {};
	const out = Object.assign({}, ONLINE_DEFAULT, raw);
	out.hasKey = !!out.apiKey;
	out.hasVisionKey = !!out.visionApiKey;
	// 视觉这条路「能不能用」：有模型名，且落到哪套地址/Key 上都齐
	out.visionReady = !!(
		out.visionModel &&
		(out.visionBaseUrl || out.baseUrl) &&
		(out.visionApiKey || out.apiKey)
	);
	return out;
}

function writeOnline(patch) {
	const next = Object.assign({}, readOnline(), patch || {});
	delete next.hasKey;
	delete next.hasVisionKey;
	delete next.visionReady;
	writeJson(ONLINE_FILE, next, 0o600);
	const back = readOnline();
	return { ok: back.baseUrl === next.baseUrl && back.model === next.model, config: back };
}

/** 真去问一次联网模型（走副本自带的 online.mjs，和桌宠用的是同一份代码）。
 *  which="vision" 是按「看屏幕」那套（视觉模型 / 视觉地址 / 视觉 Key，留空自动跟聊天共用）探测。
 *  注意：探测读的是**已经保存**的 online.json —— 所以按钮那边会先保存再测。 */
async function onlineTest(extra) {
	const cfg = Object.assign({}, readOnline(), extra || {});
	const which = cfg.which === "vision" ? "vision" : "chat";
	if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
		return { ok: false, reason: "missing", message: "baseUrl / apiKey / model 三样都要填" };
	}
	try {
		const mod = await import(require("node:url").pathToFileURL(path.join(REPO, "standalone", "online.mjs")).href);
		const r = await mod.onlinePing(20000, which);
		return r;
	} catch (e) {
		return { ok: false, reason: "import-failed", message: String((e && e.message) || e) };
	}
}

// ---------------------------------------------------------------------------
// 三、性格（自定义文本）
// ---------------------------------------------------------------------------
function readPersonas() {
	// 新位置没有就读老位置（老版本把性格库放在程序目录里）——只读回退，下次保存会写到新位置。
	const raw = readJson(PERSONAS_FILE) || readJson(LEGACY_PERSONAS_FILE);
	const list = raw && Array.isArray(raw.list) ? raw.list : [];
	return { list: list.filter((x) => x && typeof x.text === "string" && x.text.trim()) };
}

function savePersona(name, text) {
	const clean = String(name || "").trim().slice(0, 40);
	const body = String(text || "").trim();
	if (!clean) return { ok: false, reason: "bad-name", message: "给它起个名字" };
	if (body.length < 10) return { ok: false, reason: "too-short", message: "人设至少写 10 个字" };
	const store = readPersonas();
	const list = store.list.filter((x) => x.name !== clean);
	list.unshift({ name: clean, text: body, at: Date.now() });
	const next = { list: list.slice(0, 50) };
	try {
		writeJson(PERSONAS_FILE, next);
	} catch (e) {
		return { ok: false, reason: "save-failed", message: String((e && e.message) || e) };
	}
	return { ok: true, saved: clean, count: next.list.length };
}

function deletePersona(name) {
	const store = readPersonas();
	const list = store.list.filter((x) => x.name !== String(name || ""));
	writeJson(PERSONAS_FILE, { list });
	return { ok: true, count: list.length };
}

/** 把任意一段人设写进 main-config.json 的 whisperPrompt（备份 + 复验，跟桌宠自己的写法一致）。 */
function writePersonaText(text) {
	const want = String(text || "").trim();
	if (want.length < 10) return { ok: false, reason: "too-short", message: "人设至少写 10 个字" };
	const cfg = readJson(CONFIG_FILE);
	if (!cfg || typeof cfg !== "object") return { ok: false, reason: "no-config" };
	cfg.whisperPrompt = want;
	try {
		fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.persona-bak`);
	} catch {
		/* 备份失败不致命 */
	}
	writeJson(CONFIG_FILE, cfg);
	const back = readJson(CONFIG_FILE);
	return {
		ok: !!back && back.whisperPrompt === want,
		length: back && back.whisperPrompt ? back.whisperPrompt.length : 0,
	};
}

function readPersonaText() {
	const cfg = readJson(CONFIG_FILE);
	return (cfg && typeof cfg.whisperPrompt === "string" && cfg.whisperPrompt) || "";
}

// ---------------------------------------------------------------------------
// 四、打开软件 / 文件 / 网页
// ---------------------------------------------------------------------------
function startMenuDirs() {
	const dirs = [];
	if (process.env.ProgramData) dirs.push(path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"));
	if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"));
	return dirs.filter((d) => {
		try {
			return fs.statSync(d).isDirectory();
		} catch {
			return false;
		}
	});
}

/** 从开始菜单里找快捷方式（.lnk），给控制台的「打开软件」当候选。 */
function listApps(limit = 400) {
	const out = [];
	const walk = (dir, depth) => {
		if (depth > 4 || out.length >= limit) return;
		let items = [];
		try {
			items = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const it of items) {
			if (out.length >= limit) return;
			const full = path.join(dir, it.name);
			if (it.isDirectory()) walk(full, depth + 1);
			else if (/\.(lnk|exe|bat|cmd|url)$/i.test(it.name) && !/^uninstall/i.test(it.name)) {
				out.push({ name: it.name.replace(/\.(lnk|exe|bat|cmd|url)$/i, ""), path: full });
			}
		}
	};
	for (const d of startMenuDirs()) walk(d, 0);
	out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
	return { ok: true, apps: out };
}

async function openTarget(kind, target) {
	const { shell } = require("electron");
	const t = String(target || "").trim();
	if (!t) return { ok: false, reason: "empty", message: "先填要打开的东西" };
	if (kind === "url") {
		const url = /^[a-z]+:\/\//i.test(t) ? t : `https://${t}`;
		if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "bad-url", message: "只认 http/https" };
		await shell.openExternal(url);
		return { ok: true, opened: url };
	}
	if (!fs.existsSync(t)) return { ok: false, reason: "not-found", message: `找不到：${t}` };
	const err = await shell.openPath(t);
	return err ? { ok: false, reason: "open-failed", message: err } : { ok: true, opened: t };
}

module.exports = {
	REPO,
	DATA_ROOT,
	CONTROL_FILE,
	ONLINE_FILE,
	CONFIG_FILE,
	PERSONAS_FILE,
	KINDS,
	keyFor,
	controlPort,
	controlState,
	controlSet,
	controlPatch,
	readOnline,
	writeOnline,
	onlineTest,
	readPersonas,
	savePersona,
	deletePersona,
	writePersonaText,
	readPersonaText,
	listApps,
	openTarget,
};
