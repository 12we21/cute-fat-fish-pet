/* 独立模式的 HTTP 服务层
 *
 * 照抄上游 dsh-pet 0.3.6 src/standalone/server.ts 的分工，原文那句话是这么说的：
 *   「这里没有路由表 —— 路由表属于插件的宿主半边（apply 注册在 ctx.webServer 的
 *     prefix handler）；本模块只做四件事：绑 127.0.0.1（占用则顺延）、把前缀命中的
 *     请求原样交给那份 handler（handler 自己写响应头与 body）、提供 /、/health、
 *     /shutdown、兜住 handler 异常按插件口径回 500 JSON。」
 *
 * 也就是说：响应格式（JSON / 文本 / 文件）全由 app/lib/index.js 的 handler 决定，
 * 我们只负责「分发 + 兜底」，这样 app/ 的行为与在 DSH 里跑时完全一致。
 */

import crypto from "node:crypto";
import http from "node:http";

export const DEFAULT_STANDALONE_PORT = 3080;
export const PORT_SCAN_LIMIT = 25;

/* ── 来源门禁 + /shutdown 口令（1.1.0 安全加固） ─────────────────────────────
 * 以前这几个端点一律回 `access-control-allow-origin: *`，而 /shutdown 连方法都不挑，
 * 于是任何网页都能用一句
 *     <img src="http://127.0.0.1:3080/shutdown">
 * （跨源「无 Origin 的 GET」）把她的服务静默关掉。现在三道锁：
 *   1) 只认本机来源：没有 Origin（本机脚本、图片标签式请求）、`null`（file:// 页面）、
 *      http(s)://127.0.0.1 / localhost / [::1] 放行；别的来源一律 403，
 *      而且**不回任何 CORS 头** —— 恶意页面既发不出有效请求，也读不到响应。
 *   2) 认识的来源回显它自己的 Origin（回 `*` 的话浏览器配 credentials 会当场拒收）+ `vary: Origin`。
 *   3) /shutdown 只收 POST，并且要 token（token 由 main.mjs 生成、只写在本机
 *      runtime.json 里；stop-pet.mjs / stop-pet.vbs 读同一份，网页读不到）。
 * 插件路由同样受 1)+2) 保护：跨源简单 POST 会被 403 挡在 handler 之前。
 * 她自己的渲染端是同源、helper 抓配置用的是 Node fetch（无 Origin），都不受影响。 */
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

/** 认识的来源 → 该回的 CORS 头；外来来源 → null（调用方一律 403 且不回 ACAO） */
function corsFor(origin) {
	if (!origin) return {}; // 本机脚本 / 图片式请求：不需要 CORS 头
	const base = {
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type, authorization, x-pet-token",
		"access-control-max-age": "600",
		vary: "Origin",
	};
	if (origin === "null") return { ...base, "access-control-allow-origin": "null" };
	if (LOOPBACK_ORIGIN_RE.test(origin)) return { ...base, "access-control-allow-origin": origin };
	return null;
}

function tokenFrom(req) {
	const auth = req.headers.authorization;
	if (typeof auth === "string") {
		const matched = /^Bearer\s+(.+)$/i.exec(auth.trim());
		if (matched) return matched[1].trim();
	}
	const header = req.headers["x-pet-token"];
	return typeof header === "string" ? header.trim() : "";
}

function tokenOk(req, token) {
	const got = tokenFrom(req);
	if (!got || got.length !== token.length) return false;
	try {
		return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
	} catch {
		return false;
	}
}

const msg = (error) => (error instanceof Error ? error.message : String(error));

function sendJson(res, status, obj, extraHeaders) {
	const body = JSON.stringify(obj);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...(extraHeaders ?? {}) });
	res.end(body);
}

function findRoute(routes, pathname) {
	for (const route of routes) {
		if (route.kind === "exact") {
			if (pathname === route.path) return route;
		} else if (pathname === route.path || pathname.startsWith(route.path + "/")) {
			return route;
		}
	}
	return undefined;
}

export function createRequestListener({ routes, logger, status, onShutdown, token }) {
	const needToken = typeof token === "string" && token.length > 0;
	return (req, res) => {
		let pathname;
		try {
			pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
		} catch {
			sendJson(res, 400, { error: "dsh-pet standalone: bad url" });
			return;
		}

		const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
		const cors = corsFor(origin);
		if (!cors) {
			/* 外来网页：预检、读、写全都在这里结束，且故意不带 ACAO */
			sendJson(res, 403, { ok: false, reason: "forbidden-origin" });
			return;
		}

		if (req.method === "OPTIONS") {
			res.writeHead(204, cors);
			res.end();
			return;
		}

		if (pathname === "/" || pathname === "/health") {
			let payload;
			try {
				payload = status ? status() : { ok: true };
			} catch (error) {
				sendJson(res, 500, { error: msg(error) });
				return;
			}
			sendJson(res, 200, payload, cors);
			return;
		}

		if (pathname === "/shutdown") {
			/* 只收 POST：GET 是网页唯一能「无 Origin」发出来的跨源请求（<img>/<script>），
			   卡住方法就卡住了这条路；再叠一层 token。 */
			if (req.method !== "POST") {
				sendJson(
					res,
					405,
					{ ok: false, reason: "method-not-allowed", message: "/shutdown 只接受 POST" },
					{ ...cors, allow: "POST" },
				);
				return;
			}
			if (needToken && !tokenOk(req, token)) {
				sendJson(
					res,
					401,
					{
						ok: false,
						reason: "unauthorized",
						message: "缺少或不对的 token —— 口令写在数据目录的 runtime.json 里（stop-pet.mjs / stop-pet.vbs 会自动带上）",
					},
					cors,
				);
				return;
			}
			sendJson(res, 200, { ok: true, stopping: true }, cors);
			queueMicrotask(() => onShutdown?.("http /shutdown"));
			return;
		}

		const route = findRoute(routes, pathname);
		if (!route) {
			const known = routes.map((r) => r.path).join(", ") || "(none)";
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...cors });
			res.end(`dsh-pet standalone: no route for ${pathname}\nregistered paths: ${known}\n`);
			return;
		}

		Promise.resolve()
			.then(() => route.handler(req, res))
			.catch((error) => {
				logger.error(`route handler 失败 ${pathname}: ${msg(error)}`);
				try {
					if (res.headersSent) res.destroy();
					else sendJson(res, 500, { error: msg(error) });
				} catch {
					/* 响应已经废了就算了 */
				}
			});
	};
}

/**
 * 从 preferred 起逐个试绑 127.0.0.1，EADDRINUSE 就 +1，最多 PORT_SCAN_LIMIT 次。
 * 真实端口一定回读 server.address().port（传 0 时由系统分配）。 */
export async function listenStandaloneServer(options) {
	const { routes, logger, status, onShutdown } = options;
	const preferred = Number.isInteger(options.port) ? options.port : DEFAULT_STANDALONE_PORT;
	const listener = createRequestListener({ routes, logger, status, onShutdown, token: options.token });
	if (!(typeof options.token === "string" && options.token.length > 0)) {
		logger.warn("/shutdown 没有口令（调用方没传 token）—— 只剩来源门禁兜着");
	}
	const taken = [];

	for (let i = 0; i < PORT_SCAN_LIMIT; i++) {
		const candidate = preferred + i;
		if (candidate < 1 || candidate > 65535) break;
		const server = http.createServer(listener);
		server.on("clientError", (_error, socket) => socket.destroy());
		try {
			await new Promise((resolve, reject) => {
				const onError = (error) => {
					server.removeListener("listening", onListening);
					reject(error);
				};
				const onListening = () => {
					server.removeListener("error", onError);
					resolve();
				};
				server.once("error", onError);
				server.once("listening", onListening);
				server.listen(candidate, "127.0.0.1");
			});
		} catch (error) {
			try {
				server.close();
			} catch {
				/* ignore */
			}
			if (error && error.code === "EADDRINUSE") {
				taken.push(candidate);
				continue;
			}
			throw error;
		}

		const actual = server.address()?.port ?? candidate;
		if (taken.length > 0) logger.warn(`端口 ${taken.join(" / ")} 被占用，已改绑 ${actual}`);

		let closed = false;
		return {
			port: actual,
			skippedPorts: taken,
			close() {
				if (closed) return Promise.resolve();
				closed = true;
				try {
					/* keep-alive 连接会让 close() 一直等，必须先斩断 */
					server.closeAllConnections?.();
				} catch {
					/* ignore */
				}
				return new Promise((resolve) => server.close(() => resolve()));
			},
		};
	}

	throw new Error(`dsh-pet standalone: 从 ${preferred} 起连续 ${PORT_SCAN_LIMIT} 个端口都被占用，起不来`);
}
