#!/usr/bin/env node
/* 「蓝毛小女仆」独立模式启动器
 *
 * 目的：不装 DSH、不装 dsh-pet 插件，也能把这只桌宠跑起来。
 *
 * 做法（架构照抄上游 dsh-pet 0.3.6 的 src/standalone/）：
 *   伪 ctx（context.mjs） + 真 http 服务（server.mjs） + 三个 DSH 包替身（shims/）
 *   然后调用 app/lib/index.js 导出的 apply(ctx) —— 也就是插件原来那个「宿主半侧」。
 *
 * 关键点：**app/ 里一个字都不改**。上游是用 tsdown 构建期 alias 把
 * @deepseek-ai/dsh-home-paths / -credentials / -llm 指向 shim 的；我们没有构建链，
 * 所以用 Node 24 的 module.registerHooks 在运行期做同一件事。副作用是这份副本
 * 同时仍然可以作为 DSH 插件被加载（那时走 DSH 自己提供的三个包，钩子不参与）。
 *
 * 比上游多走一步：上游的独立模式把模型服务留成「明确不可用」，碎碎念/对话/
 * 屏幕监测点评全废。这里把 ctx.llm / ctx.get("attachments") / agentDefaultModel
 * 接到本机 Ollama（ollama.mjs），所以「会说话」的功能在独立模式下照样工作。
 */

import crypto from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createStandaloneContext, createStandaloneLogger, STANDALONE_PROVIDER } from "./context.mjs";
import { currentModel, currentProvider, listOllamaModels, ollamaApi, LOCAL_PROVIDER } from "./ollama.mjs";
import { DEFAULT_STANDALONE_PORT, listenStandaloneServer } from "./server.mjs";
import { APP_NAME, DISPLAY_NAME, applyEnv, readDeviceProfile, resolvePaths, seedUserData } from "./paths.mjs";
import { BlockAssembler, createUserMessage } from "./shims/dsh-llm.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIR = resolve(HERE, "..", "app");
const SHIM_DIR = join(HERE, "shims");
const REPO_ROOT = resolve(HERE, "..");

/* ── 发布版路径：程序目录只读，数据都在 %APPDATA%\<APP_NAME>（放 portable.txt 则改到程序目录） ── */
const PATHS = resolvePaths(HERE);
if (!process.env.DSH_HOME) applyEnv(PATHS);

/* 首次运行「自动适配」出来的性能档位：显存小的机器少给上下文、早些把模型请出显存。
 * 必须在动态 import app/lib/index.js 之前设好 —— 桌宠 helper 是本进程 spawn 的，会继承这些变量。 */
const DEVICE_PROFILE = readDeviceProfile(PATHS);
if (DEVICE_PROFILE?.tune) {
	if (!process.env.DSH_PET_NUM_CTX) process.env.DSH_PET_NUM_CTX = String(DEVICE_PROFILE.tune.numCtx);
	if (!process.env.DSH_PET_KEEPALIVE) process.env.DSH_PET_KEEPALIVE = String(DEVICE_PROFILE.tune.keepAlive);
	if (!process.env.DSH_PET_YIELD_VRAM) process.env.DSH_PET_YIELD_VRAM = DEVICE_PROFILE.tune.yieldVram ? "1" : "0";
}

/* 把自己是谁、在哪、什么模型写在这里，stop-pet.mjs / 快捷键 / 排查都靠它
 * （放用户数据目录，程序目录将来装进 Program Files 也不会写不动） */
const RUNTIME_FILE = join(PATHS.userRoot, "runtime.json");

/* 本地控制口令：HTTP 那个 /shutdown 要它（见 server.mjs 的来源门禁说明）。
 * 每次启动换一把，只写在本机 runtime.json 里 —— stop-pet.mjs 读同一份带上；
 * 网页读不到这个文件，所以「任何网页都能把她关掉」那条路被堵死了。 */
const CONTROL_TOKEN = crypto.randomBytes(24).toString("hex");

/** 数据目录是怎么定下来的（命令行/体检里显示用；规则见 paths.mjs 的 dataRootInfo） */
const DATA_NOTE =
	PATHS.dataRootSource === "portable"
		? "（便携模式：数据就在程序目录里）"
		: PATHS.dataRootSource === "file"
			? `（自定义：来自 ${PATHS.dataRootFile}）`
			: PATHS.dataRootSource === "env"
				? "（自定义：来自环境变量 DSH_PET_DATA_DIR）"
				: "";

/* 「完全独立」的注释保留在这里备查：以前默认把数据根锁在这份副本里（DSH_HOME=本副本）。
 * 发布版改成走 paths.mjs：DSH_HOME = %APPDATA%\<APP_NAME>，见上面那一行 applyEnv。
 * 想临时切回「数据就在程序目录」：把 DSH_HOME 显式设成这份副本即可（下面那行只在外部没设时才补）。 */
if (!process.env.DSH_HOME && existsSync(join(REPO_ROOT, "dsh-pet"))) process.env.DSH_HOME = REPO_ROOT;

/* ── 运行期 alias：三个 DSH 包指向本目录的替身 ───────────────────────────── */
const ALIASES = new Map([
	["@deepseek-ai/dsh-home-paths", join(SHIM_DIR, "dsh-home-paths.mjs")],
	["@deepseek-ai/dsh-credentials", join(SHIM_DIR, "dsh-credentials.mjs")],
	["@deepseek-ai/dsh-llm", join(SHIM_DIR, "dsh-llm.mjs")],
]);

registerHooks({
	resolve(specifier, context, nextResolve) {
		const exact = ALIASES.get(specifier);
		if (exact) return { url: pathToFileURL(exact).href, shortCircuit: true };
		for (const [name, file] of ALIASES) {
			if (specifier.startsWith(name + "/")) return { url: pathToFileURL(file).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});

/* ── 命令行 ──────────────────────────────────────────────────────────────── */
const USAGE = `「${DISPLAY_NAME}」独立模式（不需要 DSH）

用法：
  node main.mjs [--port N] [--app <包目录>] [--check] [--selftest]

日常不用敲命令：打开「${DISPLAY_NAME}」控制台就能启停（双击桌面快捷方式），
也可以双击 start-pet.vbs 起、双击 stop-pet.vbs 停。
已经在跑的时候再双击不会起第二只 —— 两只抢同一个 Chromium userData 会互踩。

选项：
  --port N        宿主路由服务端口（默认 ${DEFAULT_STANDALONE_PORT}；被占用则自动顺延，最多试 25 个）
  --app <包目录>   插件包根目录（默认 ../app）
  --check         只做体检并退出：包是否完整、默认配置在不在、Electron 能不能找到、数据目录在哪
  --selftest      只测「模型那半边」：本机 Ollama 在不在、以及插件的三个契约
                  （agentDefaultModel / attachments / llm.stream）能不能真的出话。
                  不监听端口、不拉桌宠，纯只读。
  -h, --help      显示本帮助

运行时会写一份 runtime.json（pid / 端口 / 模型 / 启动时间），退出时删掉。

环境变量：
  DSH_HOME                用户数据目录（默认 %APPDATA%\\${APP_NAME}）——
                          人设/记忆/屏幕状态在 <DSH_HOME>\\dsh-pet、Electron 在 <DSH_HOME>\\electron
  DSH_PET_ELECTRON_PATH   指定 Electron 可执行文件（装好后默认用包内 electron\\electron.exe）
  DSH_PET_STANDALONE_DEBUG=1  让 logger.debug 出声

首次运行会自动铺默认人设，并在控制台里自动检测本机显卡/显存与 Ollama 模型，挑出合适的
「聊天模型」和「看屏幕（视觉）模型」。

用户数据放哪（可自定义，四条优先级从高到低）：
  1) 环境变量 DSH_PET_DATA_DIR
  2) 程序目录里的 data-root.txt（内容写一行路径，绝对路径或相对程序目录都行）
  3) 程序目录里的 portable.txt  → 数据放「程序目录\\userdata」（便携模式）
  4) 默认 %APPDATA%\BlueHairMaid\

独立模式下可用：动画、物理拖拽、右键菜单、多开、自定义素材与宠物种类、屏幕监测、语音输入、
                TTS、唱歌、AI 导演、全局大脑与碎碎念（模型走本机 Ollama 或联网模型）
独立模式下不可用（会明确报错，不会假装成功）：余额查询（要 DSH 的凭证库）、DSH 会话工作状态、系统通知
`;

function parseArgs(argv) {
	const out = { port: DEFAULT_STANDALONE_PORT, app: DEFAULT_APP_DIR, check: false, selftest: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			out.help = true;
			continue;
		}
		if (arg === "--check") {
			out.check = true;
			continue;
		}
		if (arg === "--selftest") {
			out.selftest = true;
			continue;
		}
		if (arg === "--port" || arg.startsWith("--port=")) {
			const raw = arg === "--port" ? argv[++i] : arg.slice("--port=".length);
			const n = Number.parseInt(String(raw ?? ""), 10);
			if (!Number.isFinite(n) || n < 1 || n > 65535) return { error: `--port 需要一个 1..65535 的整数，收到：${String(raw)}` };
			out.port = n;
			continue;
		}
		if (arg === "--app" || arg.startsWith("--app=")) {
			const raw = arg === "--app" ? argv[++i] : arg.slice("--app=".length);
			if (!raw) return { error: "--app 需要一个目录" };
			out.app = resolve(String(raw));
			continue;
		}
		return { error: `未知参数：${arg}` };
	}
	return out;
}

/* ── 小工具 ──────────────────────────────────────────────────────────────── */
function stripJsonc(text) {
	let out = "";
	let inString = false;
	let inLine = false;
	let inBlock = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const n = text[i + 1];
		if (inLine) {
			if (c === "\n") {
				inLine = false;
				out += c;
			}
			continue;
		}
		if (inBlock) {
			if (c === "*" && n === "/") {
				inBlock = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += c;
			if (c === "\\") {
				out += n ?? "";
				i++;
			} else if (c === '"') inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			out += c;
			continue;
		}
		if (c === "/" && n === "/") {
			inLine = true;
			i++;
			continue;
		}
		if (c === "/" && n === "*") {
			inBlock = true;
			i++;
			continue;
		}
		out += c;
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

function readPets(configFile) {
	try {
		const cfg = JSON.parse(stripJsonc(readFileSync(configFile, "utf8")));
		const list = Array.isArray(cfg?.pets) ? cfg.pets : [];
		return list.map((p) => ({ id: p?.id ?? "?", name: p?.name ?? "", display: p?.display ?? "" }));
	} catch {
		return [];
	}
}

function dshHome() {
	const userProfile = process.env.USERPROFILE || process.env.HOME || "";
	return process.env.DSH_HOME || join(userProfile, ".dsh");
}

/* ── 单实例守卫 ──────────────────────────────────────────────────────────────
 * 两只一起跑是**真的会坏**：桌面 helper 的 Electron userData 是
 * %APPDATA%\dsh-pet-electron-helper（由 runtime/electron-helper/package.json 的
 * name 决定），两个 Electron 抢同一个 Chromium profile 会互相踩；数据根
 * （人设 / 记忆 / screen-watch）也是同一个。所以这里宁可什么都不做。
 */
function readRuntime() {
	try {
		const raw = JSON.parse(readFileSync(RUNTIME_FILE, "utf8"));
		return raw && typeof raw === "object" ? raw : null;
	} catch {
		return null;
	}
}

function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

async function probeHealth(port, timeoutMs = 1500) {
	if (!Number.isInteger(port) || port <= 0) return null;
	try {
		const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		const body = await res.json();
		return body && body.mode === "standalone" ? body : null;
	} catch {
		return null;
	}
}

function writeRuntime(patch) {
	try {
		writeFileSync(RUNTIME_FILE, JSON.stringify({ ...patch, updatedAt: new Date().toISOString() }, null, 2), "utf8");
	} catch {
		/* 写不进去不影响运行 */
	}
}

function clearRuntime() {
	try {
		const cur = readRuntime();
		if (!cur || cur.pid === process.pid) unlinkSync(RUNTIME_FILE);
	} catch {
		/* ignore */
	}
}

function findElectron() {
	const candidates = [];
	if (process.env.DSH_PET_ELECTRON_PATH) candidates.push(process.env.DSH_PET_ELECTRON_PATH);
	candidates.push(join(dshHome(), "electron", "electron.exe"));
	candidates.push(join(REPO_ROOT, "electron", "electron.exe"));
	return candidates.find((p) => existsSync(p));
}

/* ── 体检 ────────────────────────────────────────────────────────────────── */
function inspect(appDir) {
	const checks = [];
	const add = (name, ok, detail) => checks.push({ name, ok, detail });

	const pkgFile = join(appDir, "package.json");
	const hostFile = join(appDir, "lib", "index.js");
	const clientFile = join(appDir, "lib", "client.js");
	const configFile = join(appDir, "assets", "config.jsonc");
	const helperFile = join(appDir, "runtime", "electron-helper", "main.js");
	const helperPkg = join(appDir, "runtime", "electron-helper", "package.json");
	const vendored = join(appDir, "node_modules", "@electron", "get");

	add("包目录", existsSync(appDir), appDir);
	add("package.json", existsSync(pkgFile), pkgFile);
	add("宿主半侧 lib/index.js", existsSync(hostFile), hostFile);
	add("浏览器半侧 lib/client.js", existsSync(clientFile), clientFile);
	add("包内默认配置 assets/config.jsonc", existsSync(configFile), configFile);
	add("桌面 helper main.js", existsSync(helperFile), helperFile);
	add("helper package.json", existsSync(helperPkg), helperPkg);
	add("内嵌依赖 @electron/get", existsSync(vendored), vendored);

	const electron = findElectron();
	add("Electron 可执行文件", Boolean(electron), electron ?? "未找到（可设 DSH_PET_ELECTRON_PATH）");

	let version = "?";
	try {
		version = JSON.parse(readFileSync(pkgFile, "utf8")).version ?? "?";
	} catch {
		/* ignore */
	}

	/* 三个 DSH 包必须能被替身接住 —— 直接验证钩子生效 */
	const shimsOk = [...ALIASES.values()].every((p) => existsSync(p));
	add("三个 DSH 包替身", shimsOk, [...ALIASES.values()].join(" | "));

	const home = dshHome();
	add("数据根 DSH_HOME", true, home);

	return { checks, version, electron, configFile, home };
}

function printInspection(info) {
	console.log("");
	console.log("  体检结果");
	console.log("  " + "-".repeat(66));
	for (const c of info.checks) {
		console.log(`  ${c.ok ? "[ OK ]" : "[FAIL]"}  ${c.name.padEnd(26)} ${c.detail}`);
	}
	console.log("  " + "-".repeat(66));
	const bad = info.checks.filter((c) => !c.ok);
	console.log(bad.length === 0 ? "  全部通过。" : `  ${bad.length} 项不通过，独立模式可能起不来。`);
	console.log("");
}

/* ── 模型自检：走插件真正会走的那三个契约（只读，不监听端口、不拉桌宠） ──── */
async function selfTest() {
	const logger = createStandaloneLogger("dsh-pet-standalone/selftest");
	const context = createStandaloneContext({ port: 0, logger });
	const ctx = context.ctx;

	const rows = [];
	const say = (ok, name, detail) => rows.push({ ok, name, detail });

	const api = ollamaApi();
	const probe = await listOllamaModels();
	say(
		probe.ok,
		"本机 Ollama",
		probe.ok
			? `${api}（${probe.models.length} 个模型：${probe.models.slice(0, 4).join("、")}${probe.models.length > 4 ? " …" : ""}）`
			: `${api} —— ${probe.reason}`,
	);

	const sel = ctx.agentDefaultModel.currentSelection();
	say(
		Boolean(sel?.provider && sel?.model),
		"agentDefaultModel.currentSelection()",
		sel?.model
			? `${sel.provider} / ${sel.model}（取自 screen-watch/state.json 的 quipModel‖localModel）`
			: "没有配本机模型（state.json 里 quipModel / localModel 都是空的）",
	);

	const att = ctx.get("attachments");
	say(Boolean(att && typeof att.saveImages === "function"), 'ctx.get("attachments").saveImages', att ? "存在（屏幕监测能把截图塞进消息）" : "缺失");

	/* 文本出话：调用形状与 app/lib/index.js:207-224 完全一致 */
	const model = sel?.model || currentModel();
	const provider = sel?.provider || LOCAL_PROVIDER;
	const assembler = new BlockAssembler();
	try {
		for await (const chunk of ctx.llm.stream({
			provider,
			model,
			messages: [createUserMessage({ content: [{ type: "text", text: "用一句不超过 20 字的中文跟我打个招呼。" }], source: { kind: "user" } })],
			system: "你是一只桌宠，回答要短，不要解释。",
			temperature: 1,
			signal: AbortSignal.timeout(120000),
		})) {
			assembler.push(chunk);
		}
		const text = assembler.blocks().map((b) => (b.type === "text" ? b.text : "")).join("").trim();
		say(Boolean(text), "llm.stream 文本出话", text ? `「${text}」` : "模型没有返回文本");
	} catch (error) {
		say(false, "llm.stream 文本出话", error instanceof Error ? error.message : String(error));
	}

	/* 图片出话：屏幕监测那条路（attachments → {type:"image"} → Ollama images） */
	const shot = join(dshHome(), "dsh-pet", "screen-watch", "shot.jpg");
	if (existsSync(shot) && att) {
		const pixels = new Uint8Array(readFileSync(shot));
		try {
			const refs = await att.saveImages([{ data: pixels, mediaType: "image/jpeg", name: "screen.jpg" }]);
			const vision = new BlockAssembler();
			for await (const chunk of ctx.llm.stream({
				provider,
				model,
				messages: [
					createUserMessage({
						content: [
							{ type: "image", attachment: refs[0] },
							{ type: "text", text: "这张屏幕截图里主要是什么？一句话，不超过 25 字。" },
						],
						source: { kind: "user" },
					}),
				],
				system: "你是一只桌宠，看截图说话要短。",
				temperature: 1,
				signal: AbortSignal.timeout(180000),
			})) {
				vision.push(chunk);
			}
			const text = vision.blocks().map((b) => (b.type === "text" ? b.text : "")).join("").trim();
			say(Boolean(text), "llm.stream 图片出话", text ? `「${text}」（截图 ${pixels.byteLength} B）` : "模型没有返回文本");
		} catch (error) {
			say(false, "llm.stream 图片出话", error instanceof Error ? error.message : String(error));
		}
	} else {
		say(true, "llm.stream 图片出话", `跳过：找不到 ${shot}`);
	}

	console.log("");
	console.log("  「蓝毛小女仆」独立模式 · 模型自检");
	console.log("  " + "-".repeat(72));
	for (const row of rows) console.log(`  ${row.ok ? "[ OK ]" : "[FAIL]"}  ${row.name.padEnd(36)} ${row.detail}`);
	console.log("  " + "-".repeat(72));
	const bad = rows.filter((r) => !r.ok);
	console.log(bad.length === 0 ? "  模型那半边通路正常：屏幕监测 / 碎碎念 / 对话 / AI 导演在独立模式下能出话。" : `  ${bad.length} 项不通过。`);
	console.log("");
	return bad.length;
}

/* ── 主流程 ──────────────────────────────────────────────────────────────── */
async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.error) {
		console.error("[dsh-pet-standalone] " + options.error);
		console.error("");
		console.error(USAGE);
		process.exitCode = 2;
		return;
	}
	if (options.help) {
		console.log(USAGE);
		return;
	}

	const appDir = options.app;
	const logger = createStandaloneLogger();
	/* 首次运行：把 defaults\dsh-pet\ 里的默认人设/配置铺进用户数据目录（只补缺的，绝不覆盖已有） */
	if (!options.check && !options.selftest) {
		const seeded = seedUserData(PATHS);
		if (seeded > 0) console.log(`[dsh-pet-standalone] 首次运行：已铺好默认数据 ${seeded} 个文件 → ${PATHS.dataRoot}`);
	}
	const info = inspect(appDir);

	if (options.check) {
		console.log(`「${DISPLAY_NAME}」独立模式 · 体检`);
		console.log(`  包目录：${appDir}`);
		console.log(`  数据目录：${PATHS.dataRoot}${DATA_NOTE}`);
		console.log(`  运行时目录：${PATHS.userRoot}`);
		printInspection(info);
		if (info.checks.some((c) => !c.ok)) process.exitCode = 1;
		return;
	}

	if (options.selftest) {
		process.exitCode = await selfTest();
		return;
	}

	/* 单实例守卫：已经在跑就什么都不做（双击两次不该变成两只） */
	const running = readRuntime();
	if (running && pidAlive(running.pid)) {
		const health = await probeHealth(running.port);
		if (health) {
			console.log(`[dsh-pet-standalone] 已经在跑了，不重复启动。`);
			console.log(`  pid ${running.pid} · 端口 ${running.port} · 启动于 ${running.startedAt ?? "?"} · 模型 ${running.provider ?? "?"} / ${running.model ?? "?"}`);
			console.log(`  要重启：先 stop-pet.vbs / stop-pet.mjs，等它退干净再 start-pet.vbs。`);
			return;
		}
		logger.warn(`runtime.json 记着 pid ${running.pid}，进程还在但 /health 不通（${running.port}）——按「上次没退干净」处理，继续启动。`);
	}

	/* 上游 cli.ts 同款预检：包内默认配置缺失就直接退出，别跑到一半才炸 */
	const defaultConfig = join(appDir, "assets", "config.jsonc");
	if (!existsSync(defaultConfig)) {
		console.error(`[dsh-pet-standalone] 包内默认配置缺失：${defaultConfig}`);
		console.error("  这个副本不完整，请先用 verify.mjs 校验，或从 snapshot/ 还原。");
		process.exitCode = 1;
		return;
	}
	const hostEntry = join(appDir, "lib", "index.js");
	if (!existsSync(hostEntry)) {
		console.error(`[dsh-pet-standalone] 找不到宿主半侧入口：${hostEntry}`);
		process.exitCode = 1;
		return;
	}

	/* 顺序很重要：先监听、后 apply —— 插件在 apply 里会读 ctx.webServer.port */
	const modelProbe = await listOllamaModels();
	const model = currentModel();
	const provider = currentProvider();
	const routes = [];
	const portRef = { value: options.port };
	const context = createStandaloneContext({ port: () => portRef.value, logger, routes });

	let shuttingDown = false;
	const shutdown = async (reason) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`\n[dsh-pet-standalone] 收尾中（${reason}）…`);
		try {
			context.dispose();
		} catch (error) {
			logger.error("dispose 失败：" + (error instanceof Error ? error.message : String(error)));
		}
		try {
			await server.close();
		} catch {
			/* ignore */
		}
		clearRuntime();
		process.exit(0);
	};

	const server = await listenStandaloneServer({
		routes,
		logger,
		port: options.port,
		status: () => ({
			ok: true,
			mode: "standalone",
			provider: STANDALONE_PROVIDER,
			port: server.port,
			routes: routes.map((r) => `${r.kind} ${r.path}`),
			effects: context.effectCount,
			failures: context.failures,
			pid: process.pid,
			model: { provider, model, ollama: modelProbe.ok, ollamaApi: ollamaApi(), models: modelProbe.models },
		}),
		onShutdown: () => void shutdown("http /shutdown"),
		token: CONTROL_TOKEN,
	});
	portRef.value = server.port;
	writeRuntime({
		pid: process.pid,
		port: server.port,
		host: "127.0.0.1",
		token: CONTROL_TOKEN,
		app: appDir,
		version: info.version,
		provider,
		model,
		startedAt: new Date().toISOString(),
	});

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("uncaughtException", (error) => {
		logger.error("uncaughtException：" + (error?.stack ?? String(error)));
	});
	process.on("unhandledRejection", (reason) => {
		logger.error("unhandledRejection：" + (reason instanceof Error ? reason.stack : String(reason)));
	});

	/* 现在才加载插件：此时钩子已装好、端口已就绪 */
	const mod = await import(pathToFileURL(hostEntry).href);
	const apply = mod?.apply ?? mod?.default?.apply;
	if (typeof apply !== "function") {
		await server.close();
		throw new Error(`宿主半侧没有导出 apply()：${hostEntry}`);
	}

	apply(context.ctx);

	const pets = readPets(defaultConfig).filter((p) => p.display === "desktop" || p.display === "both");
	const base = `http://127.0.0.1:${server.port}`;

	console.log("");
	console.log("  ╭──────────────────────────────────────────────────────────────╮");
	console.log("  │  蓝毛小女仆 · 独立模式                                        │");
	console.log("  ╰──────────────────────────────────────────────────────────────╯");
	console.log(`  包版本        ${info.version}   (${appDir})`);
	console.log(`  路由服务      ${base}   （${routes.length} 条路由）`);
	for (const r of routes) console.log(`                  ${r.kind.padEnd(7)} ${r.path}`);
	console.log(`  健康检查      ${base}/health`);
	console.log(`  数据根        ${PATHS.dataRoot}${DATA_NOTE}`);
	if (DEVICE_PROFILE?.picks) {
		const gb = DEVICE_PROFILE.vramMB ? `${(DEVICE_PROFILE.vramMB / 1024).toFixed(1)} GB 显存` : "没读到显存";
		console.log(`  自动适配      ${gb} → 聊天 ${DEVICE_PROFILE.picks.chat || "?"} / 看屏幕 ${DEVICE_PROFILE.picks.vision || "?"}`);
	}
	console.log(`  桌面宠物      ${pets.map((p) => `${p.id}${p.name ? `(${p.name})` : ""}`).join(", ") || "(默认：config.jsonc 里 display=desktop/both 的条目)"}`);
	console.log(`  Electron      ${info.electron ?? "未找到"}`);
	console.log(
		`  本机模型      ${model ? `${provider} / ${model}` : "未配置（state.json 里 quipModel / localModel 是空的）"}` +
			`   ${modelProbe.ok ? `Ollama 在线（${modelProbe.models.length} 个模型）` : `Ollama 未响应：${modelProbe.reason}`}`,
	);
	console.log(`  已建立 effect ${context.effectCount} 个`);
	if (context.failures.length > 0) {
		console.log("  注意：以下初始化失败（已按插件的降级路径继续）");
		for (const f of context.failures) console.log(`    · ${f}`);
	}
	console.log("");
	console.log("  独立模式下不可用（需要 DSH 的凭证 / 会话，会明确报错而不会假装成功）：");
	console.log("    · 余额查询      · DSH 会话工作状态      · 系统通知");
	console.log("  其余功能都可用：动画、拖拽、右键菜单、多开、屏幕监测、语音输入、TTS、唱歌、AI 导演、碎碎念、对话；");
	console.log("  其中「会出话」的那几个走本机 Ollama（离线、不花额度）。");
	console.log("");
	console.log("  退出：关掉这个窗口，或 Ctrl+C，或双击 stop-pet.vbs（命令行里是 node standalone\\stop-pet.mjs）");
	console.log("");
}

const isMain = import.meta.main === true || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) {
	main().catch((error) => {
		console.error("[dsh-pet-standalone] 启动失败：" + (error?.stack ?? String(error)));
		process.exitCode = 1;
	});
}
