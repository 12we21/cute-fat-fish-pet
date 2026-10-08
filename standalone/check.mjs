#!/usr/bin/env node
// 「蓝毛小女仆」独立版自检 —— 确认这只桌宠真的不依赖宿主环境。
//
//   ..\node\bin\node.exe check.mjs
//
// 它只做只读检查：不启动、不停止、不改任何文件。桌宠没在跑时也会检查"零件齐不齐"。
// 退出码 0 = 全部通过；1 = 有不通过项（每项都会说明为什么）。

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const NODE_EXE = join(REPO, "node", "bin", "node.exe");
const ELECTRON_EXE = join(REPO, "electron", "electron.exe");
const APP_DIR = join(REPO, "app");
const DATA_DIR = join(REPO, "dsh-pet");
const RUNTIME_FILE = join(HERE, "runtime.json");

let failed = 0;
const ok = (what, extra = "") => console.log(`  [ OK ] ${what}${extra ? "  " + extra : ""}`);
const bad = (what, why) => {
	failed++;
	console.log(`  [FAIL] ${what}`);
	if (why) console.log(`         ${why}`);
};
const info = (s) => console.log(`         ${s}`);

const under = (p) => typeof p === "string" && resolve(p).toLowerCase().startsWith(REPO.toLowerCase() + sep);

function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e?.code === "EPERM"; // 存在但不属于我们，也算活着
	}
}

async function getJson(url, timeoutMs = 4000) {
	const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	const text = await res.text();
	return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

console.log("蓝毛小女仆 · 独立版自检");
console.log("副本根：" + REPO);
console.log("");

// ---- 1. 零件齐不齐（和桌宠跑不跑无关）---------------------------------------
console.log("1) 自带零件");
for (const [label, p, dir] of [["Node", NODE_EXE, false], ["Electron", ELECTRON_EXE, false], ["桌宠本体 app\\", APP_DIR, true], ["数据根 dsh-pet\\", DATA_DIR, true]]) {
	if (!existsSync(p)) { bad(label, "找不到：" + p); continue; }
	const st = statSync(p);
	if (dir && !st.isDirectory()) { bad(label, "不是目录：" + p); continue; }
	ok(label, dir ? `${p}  （${st.mtime.toISOString().slice(0, 10)}）` : `${p}  ${(st.size / 1048576).toFixed(1)} MB`);
}
for (const rel of ["lib/index.js", "runtime/electron-helper/main.js", "runtime/electron-helper/sprite.js", join("assets", "config.jsonc")]) {
	const p = join(APP_DIR, rel);
	existsSync(p) ? ok("app\\" + rel.replace(/\\/g, "/"), `${statSync(p).size} B`) : bad("app\\" + rel, "缺失");
}

// ---- 2. 正在跑吗 ----------------------------------------------------------
console.log("");
console.log("2) 运行状态");
if (!existsSync(RUNTIME_FILE)) {
	ok("runtime.json", "不存在 —— 现在没在跑（桌面双击「蓝毛小女仆（独立版）」即可启动）");
	console.log("");
	console.log(failed ? `结论：零件检查有 ${failed} 项不通过。` : "结论：零件齐全，现在没在跑。");
	process.exit(failed ? 1 : 0);
}
let rt = null;
try { rt = JSON.parse(readFileSync(RUNTIME_FILE, "utf8")); } catch (e) { bad("runtime.json", "解析失败：" + e.message); }
if (rt) {
	ok("runtime.json", `pid=${rt.pid} port=${rt.port} 启动于 ${rt.startedAt}`);
	pidAlive(Number(rt.pid)) ? ok("进程", `pid ${rt.pid} 活着`) : bad("进程", `runtime.json 里的 pid ${rt.pid} 已经不在了（残留锁，下次双击会自动清掉）`);
	under(rt.app) ? ok("记录的本体路径在本程序目录内", rt.app) : bad("记录的本体路径", `不在本程序目录内：${rt.app}`);

	// ---- 3. HTTP 面 ------------------------------------------------------
	console.log("");
	console.log("3) HTTP 面（端口 " + rt.port + "）");
	try {
		const h = await getJson(`http://127.0.0.1:${rt.port}/health`);
		if (h.status === 200 && h.json?.mode === "standalone" && h.json?.pid === rt.pid) {
			ok("/health", `effects=${h.json.effects} failures=${h.json.failures?.length ?? "?"} model=${h.json.model?.provider}/${h.json.model?.model}`);
		} else {
			bad("/health", `HTTP ${h.status}，内容不符：${h.text.slice(0, 200)}`);
		}
		const m = await getJson(`http://127.0.0.1:${rt.port}${h.json?.routes?.[0]?.replace(/^prefix /, "") ?? "/dsh-pet-7340"}/config/meta`);
		if (m.status === 200 && m.json) {
			const user = m.json.user, animations = m.json.animations, pkg = m.json.storage?.find((s) => s.key === "package")?.path;
			under(user) ? ok("人设文件在本程序目录内", user) : bad("人设文件", `不在本程序目录内：${user}`);
			under(animations) ? ok("动画配置在本程序目录内", animations) : bad("动画配置", `不在本程序目录内：${animations}`);
			under(pkg) ? ok("插件包在本程序目录内", pkg) : bad("插件包", `不在本程序目录内：${pkg}`);
			for (const s of m.json.storage ?? []) {
				if (!under(s.path) && s.key !== "desktopCache" && s.key !== "electronCache") {
					bad("存储项 " + s.key, `在副本之外：${s.path}`);
				}
			}
			const outside = (m.json.storage ?? []).filter((s) => !under(s.path));
			if (outside.length) info("副本之外的存储项（Windows 标准缓存，正常）：" + outside.map((s) => s.key).join(", "));
		} else {
			bad("/config/meta", `HTTP ${m.status}`);
		}
	} catch (e) {
		bad("HTTP 请求", e.message + "（进程活着但端口不通，看 run.err.log）");
	}
}

console.log("");
console.log(failed ? `结论：${failed} 项不通过，看上面的 [FAIL]。` : "结论：全部通过 —— 这只桌宠完整地活在本程序目录里。");
process.exit(failed ? 1 : 0);
