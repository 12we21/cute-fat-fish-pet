#!/usr/bin/env node
/* 「蓝毛小女仆」独立模式 —— 停止器
 *
 * 优先走 http://127.0.0.1:<port>/shutdown（main.mjs 会 context.dispose() →
 * 顺带停掉 Electron helper → 关服务 → 删 runtime.json）；
 * 连不上就按 runtime.json 里的 pid 兜底 kill。
 *
 * 也可以在命令行手动跑：node stop-pet.mjs
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "./paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PATHS = resolvePaths(HERE);
const RUNTIME_FILE = join(PATHS.userRoot, "runtime.json");
const LOG_FILE = join(PATHS.userRoot, "logs", "pet-control.log");
try {
	mkdirSync(dirname(LOG_FILE), { recursive: true });
} catch {
	/* ignore */
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function say(message) {
	const line = `[${new Date().toISOString()}] ${message}`;
	console.log(line);
	try {
		appendFileSync(LOG_FILE, line + "\n", "utf8");
	} catch {
		/* ignore */
	}
}

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

const rt = readRuntime();
if (!rt) {
	say("没有 runtime.json —— 看起来这只桌宠没在跑（或已经被停掉了）。");
	process.exit(0);
}

const { pid, port, token } = rt;
let graceful = false;

if (Number.isInteger(port) && port > 0) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/shutdown`, {
			method: "POST",
			/* /shutdown 从 1.1.0 起要口令（来源门禁 + token，见 server.mjs）。
			   口令就在 runtime.json 里，网页读不到。老版本没有 token 字段就照旧不带。 */
			headers: typeof token === "string" && token ? { authorization: `Bearer ${token}`, "x-pet-token": token } : undefined,
			signal: AbortSignal.timeout(8000),
		});
		graceful = res.ok;
		say(`POST http://127.0.0.1:${port}/shutdown → ${res.status}${res.ok ? "（已请求收尾）" : ""}`);
	} catch (error) {
		say(`/shutdown 不通（${error instanceof Error ? error.message : String(error)}），改用 pid 兜底。`);
	}
}

/* 等它自己退干净：helper 退出 + 服务关闭一般 1~5 秒 */
for (let i = 0; i < 30 && pidAlive(pid); i++) await sleep(500);

if (pidAlive(pid)) {
	say(`pid ${pid} 还活着，强制结束。`);
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		say(`SIGTERM 失败：${error instanceof Error ? error.message : String(error)}`);
	}
	await sleep(1500);
	if (pidAlive(pid)) {
		try {
			process.kill(pid, "SIGKILL");
			await sleep(500);
		} catch {
			/* ignore */
		}
	}
}

const alive = pidAlive(pid);
say(alive ? `没停掉（pid ${pid} 仍在）。检查 run.err.log。` : `已停止（pid ${pid}${graceful ? "，优雅收尾" : ""}）。`);
if (!alive && existsSync(RUNTIME_FILE)) {
	try {
		unlinkSync(RUNTIME_FILE);
		say("runtime.json 已清理。");
	} catch {
		/* ignore */
	}
}
process.exit(alive ? 1 : 0);
