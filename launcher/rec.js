"use strict";
// 说明（1.1.0 独立仓库）：本文件**就是成品源码**，不再由「蓝本 + 生成脚本」产出——
// 老版本那套覆盖层（build\mk-rec-overlay.mjs）连同 overlay\、patch-app.mjs 一起取消了。
// 下面两点当年是「发布版改动」，现在就是本文件的本体行为：
//  ① 录屏设置 record.json 放在「每用户数据根」，不写进可能只读的程序目录；
//  ② petRoute() 读数据根里的 runtime.json，找不到运行中的实例就报「没在跑」，
//     不再回落到 3080（那是同一台机器上另一只桌宠常坐的端口）。
// 录屏 / 打开东西 / 让她说话 —— 控制台和 AI agent 共用的底层实现。
//
// 一、录屏：软件和保存位置都写在 <数据根>\dsh-pet\record.json 里（数据根见 paths.js），主人可以在控制台选，也可以让 AI 自己改。
//     - kind="obs"：用副本里的 app\runtime\electron-helper\obs-ctl.js（桌宠自己那套 OBS WebSocket 客户端），
//       能做全套：起录 / 停录 / 查状态 / 改保存目录（SetRecordDirectory）。
//       注意：我们只碰「保存目录」这一项 Output 设置，其余（分辨率/编码器/格式）仍然完全听 OBS 自己的。
//     - kind="xbox"：Windows 游戏录屏（Game Bar），Win+Alt+R 起停；保存位置由 Windows 自己定（Videos\Captures）。
//     - kind="other"：只能替主人把它打开，起停要主人自己按（没有任何通用接口能替别的软件按按钮）。
//
// 二、打开软件 / 文件 / 网页：交给 Electron 的 shell，纯本地动作，不经过桌宠、不走 shell。
//
// 三、permission 闸门：桌宠渲染进程里的 dsh-pet-perm-main（app / file / url 三个开关）说了算。
//     这是「她能不能动你的电脑」的唯一真相来源，控制台只读不改，AI 也无权打开它。

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const petApi = require("./pet-api");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..");
// [发布版改动 1] 数据根跟着「每用户数据根」走（%APPDATA%\BlueHairMaid，或 portable.txt /
// data-root.txt / DSH_PET_DATA_DIR 指定的地方），不再写进程序目录：装到 Program Files
// 这类只读目录时，主人的录屏设置会保存失败。
const PATHS = require("./paths").resolvePaths(HERE);
const DATA_ROOT = PATHS.dataRoot;
// 运行器写的 runtime.json 在**数据根**里（standalone/main.mjs 的 RUNTIME_FILE）。
const RUNTIME_FILE = path.join(PATHS.userRoot, "runtime.json");
const RECORD_FILE = path.join(DATA_ROOT, "record.json");
const OBS_CTL = path.join(REPO, "app", "runtime", "electron-helper", "obs-ctl.js");

const DEFAULT_RECORD = {
	software: { name: "OBS Studio", path: "", kind: "obs" },
	outDir: "",
	browser: "",
	search: "bing",
	updatedAt: 0,
};

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function writeJson(file, obj) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
	fs.copyFileSync(tmp, file);
	fs.rmSync(tmp, { force: true });
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
function readRecord() {
	const raw = readJson(RECORD_FILE) || {};
	const soft = raw.software && typeof raw.software === "object" ? raw.software : {};
	const name = String(soft.name || DEFAULT_RECORD.software.name);
	const kindRaw = String(soft.kind || "");
	// 没写过这个文件时别把 kind 判成 other —— 默认这台机器上就是 OBS（obs-ctl 自己知道 exe 在哪）。
	const kind = ["obs", "xbox", "psr", "other"].includes(kindRaw)
		? kindRaw
		: /obs/i.test(name) || !soft.name
			? "obs"
			: "other";
	return {
		software: { name, path: String(soft.path || ""), kind },
		outDir: String(raw.outDir || ""),
		browser: String(raw.browser || ""),
		search: raw.search === "baidu" ? "baidu" : "bing",
		updatedAt: Number(raw.updatedAt) || 0,
	};
}

function writeRecord(patch) {
	const cur = readRecord();
	const p = patch && typeof patch === "object" ? patch : {};
	const next = {
		software: Object.assign({}, cur.software, p.software && typeof p.software === "object" ? p.software : {}),
		outDir: p.outDir === undefined ? cur.outDir : String(p.outDir || ""),
		browser: p.browser === undefined ? cur.browser : String(p.browser || ""),
		search: p.search === undefined ? cur.search : p.search === "baidu" ? "baidu" : "bing",
		updatedAt: Date.now(),
	};
	if (!["obs", "xbox", "psr", "other"].includes(next.software.kind)) next.software.kind = "other";
	writeJson(RECORD_FILE, next);
	return { ok: true, record: next, file: RECORD_FILE };
}

// ---------------------------------------------------------------------------
// 一、录屏软件候选
// ---------------------------------------------------------------------------
const REC_WORDS = /录屏|录影|录像|录制|屏幕录制|obs|bandicam|camtasia|sharex|captura|screencast|screenrec|screentogif|ocam|apowerrec|faststone|ev录屏|超级录屏/i;

const FIXED_RECORDERS = [
	{ name: "Xbox Game Bar（Windows 自带）", path: "ms-gamingoverlay:", kind: "xbox" },
	{ name: "步骤记录器 psr.exe（Windows 自带）", path: "C:\\Windows\\System32\\psr.exe", kind: "psr" },
];

function obsCtl() {
	try {
		return require(OBS_CTL);
	} catch {
		return null;
	}
}

function exists(p) {
	try {
		return !!p && fs.existsSync(p);
	} catch {
		return false;
	}
}

/** 本机能用来录屏的软件：OBS（候选路径由 obs-ctl 现算：用户指定/常见安装位置）+ 开始菜单里名字带录屏关键词的 + 两个 Windows 自带。 */
function detectRecorders() {
	const list = [];
	const seen = new Set();
	const push = (name, p, kind) => {
		const key = `${name}|${p}`.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		list.push({ name, path: p, kind });
	};
	const ctl = obsCtl();
	const cands = typeof ctl?.obsExeCandidates === "function" ? ctl.obsExeCandidates() : [];
	for (const p of cands) if (exists(p)) push("OBS Studio（obs-websocket 全控制）", p, "obs");
	const apps = petApi.listApps(2000).apps || [];
	for (const a of apps) {
		if (!REC_WORDS.test(a.name)) continue;
		const isObs = /obs/i.test(a.name);
		if (isObs && list.some((x) => x.kind === "obs")) continue;
		push(a.name, a.path, isObs ? "obs" : "other");
	}
	for (const f of FIXED_RECORDERS) if (f.kind === "xbox" || exists(f.path)) push(f.name, f.path, f.kind);
	return { ok: true, list, current: readRecord().software };
}

// ---------------------------------------------------------------------------
// 二、录屏动作
// ---------------------------------------------------------------------------
async function recStatus() {
	const cfg = readRecord();
	const soft = cfg.software;
	const base = { ok: true, software: soft, outDir: cfg.outDir, file: RECORD_FILE };
	if (soft.kind === "obs") {
		const ctl = obsCtl();
		if (!ctl) return Object.assign(base, { ok: false, reason: "no-obs-ctl", message: "副本里找不到 obs-ctl.js" });
		const st = await ctl.status();
		let dir = "";
		if (st && st.ok && st.running) {
			try {
				const d = await ctl.call("GetRecordDirectory");
				dir = String((d && d.recordDirectory) || "");
			} catch {
				/* 老版本 OBS 没有这个请求，不影响别的 */
			}
		}
		return Object.assign(base, {
			kind: "obs",
			obsRunning: !!(st && st.running),
			recording: !!(st && st.recording),
			timecode: (st && st.timecode) || "",
			bytes: (st && st.bytes) || 0,
			obsDir: dir,
			obsExe: (ctl.findObsExe && ctl.findObsExe()) || "",
			error: st && st.ok ? "" : (st && st.error) || "",
		});
	}
	if (soft.kind === "xbox") return Object.assign(base, { kind: "xbox", note: "Windows 游戏录屏：保存位置由 Windows 定（视频\\捕获），无法从外面改" });
	if (soft.kind === "psr") return Object.assign(base, { kind: "psr", note: "步骤记录器只记录操作步骤，不录视频，起停要主人自己按" });
	return Object.assign(base, { kind: "other", note: "这个软件没有通用接口，只能替你打开，起停要主人自己按" });
}

async function recStart() {
	const cfg = readRecord();
	const soft = cfg.software;
	if (soft.kind === "obs") {
		const ctl = obsCtl();
		if (!ctl) return { ok: false, reason: "no-obs-ctl", message: "副本里找不到 obs-ctl.js" };
		const r = await ctl.start();
		return r && r.ok
			? { ok: true, already: !!r.already, startedObs: !!r.startedObs, obsStartMs: r.obsStartMs || 0, software: soft }
			: { ok: false, reason: "obs-start-failed", message: String((r && r.error) || "起录失败"), software: soft };
	}
	if (soft.kind === "xbox") return sendKeys("xbox-toggle");
	return { ok: false, reason: "no-interface", message: `「${soft.name}」没有可用的起录接口，我只能替你把它打开` };
}

async function recStop() {
	const cfg = readRecord();
	const soft = cfg.software;
	if (soft.kind === "obs") {
		const ctl = obsCtl();
		if (!ctl) return { ok: false, reason: "no-obs-ctl", message: "副本里找不到 obs-ctl.js" };
		const r = await ctl.stop();
		return r && r.ok
			? { ok: true, already: !!r.already, path: String((r && r.path) || ""), software: soft }
			: { ok: false, reason: "obs-stop-failed", message: String((r && r.error) || "停录失败"), software: soft };
	}
	if (soft.kind === "xbox") return sendKeys("xbox-toggle");
	return { ok: false, reason: "no-interface", message: `「${soft.name}」没有可用的停录接口` };
}

/** 改保存位置：OBS 走 SetRecordDirectory（要 OBS 开着，没开会先把它拉起来）；别的软件只能记在配置里。 */
async function recSetDir(dir) {
	const p = String(dir || "").trim();
	if (!p) return { ok: false, reason: "empty", message: "先给一个文件夹路径" };
	try {
		fs.mkdirSync(p, { recursive: true });
	} catch (e) {
		return { ok: false, reason: "mkdir-failed", message: `建不了这个文件夹：${(e && e.message) || e}` };
	}
	const cfg = readRecord();
	const written = writeRecord({ outDir: p });
	if (cfg.software.kind === "obs") {
		const ctl = obsCtl();
		if (!ctl) return { ok: false, reason: "no-obs-ctl", message: "副本里找不到 obs-ctl.js" };
		const ens = await ctl.ensureRunning();
		if (!ens.ok) return { ok: true, applied: false, outDir: p, message: `记下了，但 OBS 没起来（${ens.error}），等它开了再设一次`, record: written.record };
		// OBS 刚起来的那几秒端口虽然通了，但它自己还没 ready，会回 207 NotReady —— 轮询重试，
		// 跟 obs-ctl.start() 里面的做法一样，别把一条正常的设置当成失败。
		let last = "";
		for (let i = 0; i < 20; i++) {
			try {
				await ctl.call("SetRecordDirectory", { recordDirectory: p });
				return { ok: true, applied: true, outDir: p, message: "OBS 的保存位置已经改好（只改这一项，别的设置没动）", record: written.record };
			} catch (e) {
				last = String((e && e.message) || e);
				if (!/20[0-9]|not.?ready|not connected|timeout/i.test(last)) break;
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
		return { ok: true, applied: false, outDir: p, message: `记下了，但 OBS 拒绝了这条设置：${last}`, record: written.record };
	}
	return { ok: true, applied: false, outDir: p, message: `记下了（「${cfg.software.name}」的保存位置没法从外面改，需要主人在它自己的设置里指到这个文件夹）`, record: written.record };
}

/** 打开录屏软件（谁选的都行；xbox 用 ms-gamingoverlay: 协议唤出 Game Bar）。 */
async function recOpen() {
	const { shell } = require("electron");
	const soft = readRecord().software;
	let target = soft.path;
	if (!target && soft.kind === "obs") {
		const ctl = obsCtl();
		target = (ctl && ctl.findObsExe && ctl.findObsExe()) || "";
	}
	if (!target) return { ok: false, reason: "no-path", message: "还没选录屏软件（控制台里选一个，或让我用 list_recorders 看一眼）" };
	if (soft.kind === "xbox" || soft.kind === "psr") {
		try {
			await shell.openExternal(target);
			return { ok: true, opened: target, software: soft };
		} catch (e) {
			return { ok: false, reason: "open-failed", message: String((e && e.message) || e) };
		}
	}
	if (!exists(target)) return { ok: false, reason: "not-found", message: `找不到：${target}` };
	const err = await shell.openPath(target);
	return err ? { ok: false, reason: "open-failed", message: err } : { ok: true, opened: target, software: soft };
}

/** Win+Alt+R：Windows 游戏录屏的起停（纯合成按键，只按这一个组合，不敲别的）。 */
function sendKeys(which) {
	if (which !== "xbox-toggle") return { ok: false, reason: "bad-key", message: "只支持 xbox-toggle" };
	const ps = [
		"$sig='[DllImport(\"user32.dll\")]public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);';",
		"Add-Type -MemberDefinition $sig -Name K -Namespace W;",
		"$K=[W.K];",
		"$K::keybd_event(0x5B,0,0,[System.UIntPtr]::Zero);", // LWIN down
		"$K::keybd_event(0x12,0,0,[System.UIntPtr]::Zero);", // ALT down
		"$K::keybd_event(0x52,0,0,[System.UIntPtr]::Zero);", // R down
		"Start-Sleep -Milliseconds 60;",
		"$K::keybd_event(0x52,0,2,[System.UIntPtr]::Zero);", // R up
		"$K::keybd_event(0x12,0,2,[System.UIntPtr]::Zero);", // ALT up
		"$K::keybd_event(0x5B,0,2,[System.UIntPtr]::Zero);", // LWIN up
	].join("");
	try {
		const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			shell: false,
		});
		child.unref();
		return { ok: true, keys: "Win+Alt+R", note: "已经把 Win+Alt+R 按下去了（Windows 游戏录屏的起停开关）" };
	} catch (e) {
		return { ok: false, reason: "keys-failed", message: String((e && e.message) || e) };
	}
}

// ---------------------------------------------------------------------------
// 三、打开软件 / 文件 / 网页
// ---------------------------------------------------------------------------
const PATH_ALIAS = {
	edge: ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"],
	chrome: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
	"谷歌浏览器": ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
	"微软浏览器": ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
	notepad: ["C:\\Windows\\System32\\notepad.exe"],
	"记事本": ["C:\\Windows\\System32\\notepad.exe"],
	calc: ["C:\\Windows\\System32\\calc.exe"],
	"计算器": ["C:\\Windows\\System32\\calc.exe"],
	"画图": ["C:\\Windows\\System32\\mspaint.exe"],
	mspaint: ["C:\\Windows\\System32\\mspaint.exe"],
	explorer: ["C:\\Windows\\explorer.exe"],
	"资源管理器": ["C:\\Windows\\explorer.exe"],
	"文件管理器": ["C:\\Windows\\explorer.exe"],
	taskmgr: ["C:\\Windows\\System32\\Taskmgr.exe"],
	"任务管理器": ["C:\\Windows\\System32\\Taskmgr.exe"],
	cmd: ["C:\\Windows\\System32\\cmd.exe"],
};

function findBrowserExe(which) {
	const q = String(which || "").toLowerCase().trim();
	if (!q || q === "default" || q === "默认" || q === "系统默认") return "";
	const keys = Object.keys(PATH_ALIAS).filter((k) => k.toLowerCase().includes(q) || q.includes(k.toLowerCase()));
	for (const k of keys) for (const p of PATH_ALIAS[k]) if (exists(p)) return p;
	return "";
}

/** 找软件：先按字面路径，再按别名，再在开始菜单里模糊匹配。 */
function findApp(name) {
	const q = String(name || "").trim();
	if (!q) return null;
	if (exists(q)) return { name: path.basename(q), path: q };
	const ql = q.toLowerCase();
	const alias = PATH_ALIAS[ql] || [];
	for (const p of alias) if (exists(p)) return { name: q, path: p };
	const apps = petApi.listApps(2000).apps || [];
	const hit =
		apps.find((a) => a.name.toLowerCase() === ql) ||
		apps.find((a) => a.name.toLowerCase().includes(ql)) ||
		apps.find((a) => ql.length >= 2 && ql.includes(a.name.toLowerCase()));
	if (hit) return { name: hit.name, path: hit.path };
	const near = apps.filter((a) => a.name.toLowerCase().includes(ql.slice(0, 2))).slice(0, 8).map((a) => a.name);
	return { missing: true, near };
}

async function openApp(name) {
	const { shell } = require("electron");
	const hit = findApp(name);
	if (!hit) return { ok: false, reason: "empty", message: "没给软件名" };
	if (hit.missing) {
		return {
			ok: false,
			reason: "not-found",
			message: `开始菜单里没找到「${name}」${hit.near.length ? "，是不是： " + hit.near.join(" / ") : ""}`,
		};
	}
	const err = await shell.openPath(hit.path);
	return err ? { ok: false, reason: "open-failed", message: err } : { ok: true, opened: hit.path, name: hit.name };
}

/** 打开网址：主人指定的浏览器优先，否则用系统默认。只认 http/https。 */
async function openUrl(url, opts = {}) {
	const { shell } = require("electron");
	let u = String(url || "").trim();
	if (!u) return { ok: false, reason: "empty", message: "没给网址" };
	if (!/^[a-z]+:\/\//i.test(u)) u = `https://${u}`;
	if (!/^https?:\/\//i.test(u)) return { ok: false, reason: "bad-url", message: "只认 http/https" };
	const want = String(opts.browser || readRecord().browser || "").trim();
	const exe = findBrowserExe(want);
	if (exe) {
		try {
			const child = spawn(exe, [u], { detached: true, stdio: "ignore", shell: false });
			child.unref();
			return { ok: true, opened: u, browser: path.basename(exe) };
		} catch {
			/* 起不来就退回系统默认 */
		}
	}
	await shell.openExternal(u);
	return { ok: true, opened: u, browser: "系统默认" };
}

/** 浏览器里搜一下（不直接猜网址时用；B站这种有短路表）。 */
async function searchWeb(query, opts = {}) {
	const q = String(query || "").trim();
	if (!q) return { ok: false, reason: "empty", message: "没给要搜的词" };
	const engine = (opts.search || readRecord().search) === "baidu" ? "baidu" : "bing";
	const url =
		engine === "baidu"
			? `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`
			: `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
	const r = await openUrl(url, opts);
	return Object.assign({ engine, query: q }, r);
}

// ---------------------------------------------------------------------------
// 四、让她说话 + 记一笔「她最近做了什么」
// ---------------------------------------------------------------------------
/** pid 还活着吗（EPERM 也算活着，说明进程在、只是没权限发信号）。 */
function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return !!(e && e.code === "EPERM");
	}
}

/** 她这会儿在本机哪个端口（读数据根里的 runtime.json），**不回落到 3080**。 */
function petRoute() {
	// [发布版改动 2] 以前这里读 <repo>\standalone\runtime.json —— 运行器根本不写那儿，
	// 于是永远回落到 3080：同一台机器上 3080 常常坐着另一只桌宠，控制台的「让她说这句话」
	// 和 AI agent 的每一步（/quip）就会打到别人家的桌宠上。找不到运行中的实例就返回
	// port:0，调用方会当成「桌宠没在跑」。
	const rt = readJson(RUNTIME_FILE);
	const port = rt && Number(rt.port);
	if (!port || !pidAlive(Number(rt.pid))) return { port: 0, route: "/dsh-pet-7340", running: false };
	return { port, route: "/dsh-pet-7340", running: true };
}

/** 直接让她把这句话说出来（宿主 POST /say → 渲染端冒泡 + TTS），不走模型、不改她的记忆。 */
async function say(text, timeoutMs = 8000) {
	const t = String(text || "").trim();
	if (!t) return { ok: false, reason: "empty", message: "没给要说的话" };
	const { port, route, running } = petRoute();
	if (!running) return { ok: false, reason: "pet-offline", message: "桌宠没在跑 —— 先点「启动桌宠」" };
	try {
		const res = await fetch(`http://127.0.0.1:${port}${route}/say`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: t.slice(0, 500) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const obj = await res.json().catch(() => null);
		return obj && obj.ok ? { ok: true, said: t.slice(0, 120) } : { ok: false, reason: "say-failed", message: (obj && obj.message) || `HTTP ${res.status}` };
	} catch (e) {
		return { ok: false, reason: "pet-offline", message: `桌宠没在跑（${(e && e.message) || e}）` };
	}
}

/** 她自己的「最近做了什么」日志（渲染端 localStorage 的 perm.log）——外部动作也记进去，主人在控制台看得到。 */
async function appendPermLog(text) {
	const t = String(text || "").trim();
	if (!t) return { ok: false };
	try {
		const st = await petApi.controlState("main");
		if (!st || !st.ok) return { ok: false, reason: (st && st.error) || "no-control-bridge" };
		const perm = (st.data && st.data.perm) || {};
		const p = perm.perm && typeof perm.perm === "object" ? perm.perm : { app: false, file: false, url: false };
		const log = Array.isArray(perm.log) ? perm.log.slice(-19) : [];
		log.push({ t: Date.now(), text: t.slice(0, 120) });
		const r = await petApi.controlPatch("perm", { perm: p, log }, { reload: false });
		return { ok: !!(r && r.ok), count: log.length };
	} catch (e) {
		return { ok: false, reason: String((e && e.message) || e) };
	}
}

/** 读她的三个权限开关（唯一真相来源）。 */
async function readPerm() {
	try {
		const st = await petApi.controlState("main");
		if (!st || !st.ok) return { ok: false, reason: (st && st.error) || "no-control-bridge", perm: null };
		const perm = (st.data && st.data.perm) || {};
		const p = perm.perm && typeof perm.perm === "object" ? perm.perm : {};
		return { ok: true, perm: { app: p.app === true, file: p.file === true, url: p.url === true } };
	} catch (e) {
		return { ok: false, reason: String((e && e.message) || e), perm: null };
	}
}

module.exports = {
	REPO,
	DATA_ROOT,
	RECORD_FILE,
	OBS_CTL,
	readRecord,
	writeRecord,
	detectRecorders,
	recStatus,
	recStart,
	recStop,
	recSetDir,
	recOpen,
	findApp,
	findBrowserExe,
	openApp,
	openUrl,
	searchWeb,
	say,
	appendPermLog,
	readPerm,
	petRoute,
};
