/* 独立模式的「联网模型」通路（OpenAI 兼容接口）
 *
 * 独立模式原来只有本机 Ollama 一条路。用户要的是「可自主选择本地与联网」，
 * 所以这里补上第二条：任何 OpenAI 兼容的 /chat/completions 端点都行
 * （DeepSeek、OpenAI、Moonshot、硅基流动、one-api / new-api 自建……）。
 *
 * 三条铁律（跟插件自己的语义对齐，app/lib/index.js:1700 附近的大脑三档）：
 *   local  = 只走本机，连不上就如实报错，**绝不偷偷联网**
 *   auto   = 本机优先，本机失败才联网
 *   dsh    = 在 DSH 里是「用 DSH 的模型」；在独立版里就是「用联网模型」，
 *            没配联网才退回本机（这样独立版也能有真正的在线大脑）
 *
 * 配置存在 standalone/online.json（控制台「联网模型」那一块写它）：
 *   { enabled, name, baseUrl, apiKey, model, visionModel, visionBaseUrl, visionApiKey }
 *
 * [local patch] 看屏幕（带图请求）单独一条路：
 *   「会聊天的模型」和「看得懂图的模型」经常不是同一个（deepseek-chat 不吃图，
 *   只有 deepseek-flash 这一类吃）。所以视觉可以单独指一套 地址 / Key / 模型名，
 *   留空就沿用聊天那套。**带图但视觉没配齐时直接报错，绝不把 JPEG 塞给纯文本模型**
 *   —— 服务端会静默忽略图片，宠物就会开始「看着屏幕瞎编」，比明说没配更糟。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { attachments } from "./ollama.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const ONLINE_PROVIDER = "online";
export const ONLINE_CONFIG_PATH = join(HERE, "online.json");

const DEFAULTS = {
	enabled: false,
	name: "联网模型",
	baseUrl: "https://api.deepseek.com",
	apiKey: "",
	model: "deepseek-chat",
	visionModel: "",
	visionBaseUrl: "",
	visionApiKey: "",
};

export function readOnlineConfig() {
	try {
		const raw = JSON.parse(readFileSync(ONLINE_CONFIG_PATH, "utf8"));
		return { ...DEFAULTS, ...raw };
	} catch {
		return { ...DEFAULTS };
	}
}

export function saveOnlineConfig(patch) {
	const next = { ...readOnlineConfig(), ...(patch ?? {}) };
	writeFileSync(ONLINE_CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
	return next;
}

/** 这条请求里有没有图（有图 = 看屏幕那条路） */
function wantsImage(options = {}) {
	const messages = Array.isArray(options?.messages) ? options.messages : [];
	return messages.some((m) => (Array.isArray(m?.content) ? m.content : []).some((p) => p?.type === "image"));
}

/** 配齐了才叫「能用」：开关 + 地址 + 密钥 + 模型名 */
export function onlineReady(cfg = readOnlineConfig()) {
	return !!(cfg.enabled && String(cfg.baseUrl).trim() && String(cfg.apiKey).trim() && String(cfg.model).trim());
}

/**
 * 看屏幕要用的那套（地址 / 密钥 / 模型名）。
 * 视觉那三项留空就沿用聊天那套 —— 这样只想聊天的人不用填两遍。
 */
export function visionTarget(cfg = readOnlineConfig()) {
	const base = String(cfg.visionBaseUrl || "").trim() || String(cfg.baseUrl || "").trim();
	const key = String(cfg.visionApiKey || "").trim() || String(cfg.apiKey || "").trim();
	const model = String(cfg.visionModel || "").trim();
	return { base, key, model };
}

/** 视觉这条路真的能用吗：联网开着 + 上面三样齐（视觉模型名必填，否则不知道该发给谁） */
export function onlineVisionReady(cfg = readOnlineConfig()) {
	if (!cfg.enabled) return false;
	const v = visionTarget(cfg);
	return !!(v.base && v.key && v.model);
}

/** 把模型名翻译成在线侧要用的名字（视觉请求优先用 visionModel） */
export function onlineModel(options = {}) {
	const cfg = readOnlineConfig();
	const pick = wantsImage(options) ? cfg.visionModel || cfg.model : cfg.model;
	return String(pick || "").trim();
}

export function endpoint(baseUrl = readOnlineConfig().baseUrl) {
	const base = String(baseUrl || "").trim().replace(/\/+$/, "");
	if (!base) return "";
	return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
}

/* ── 消息翻译：插件形状 → OpenAI 形状（图片走 data: URL） ───────────────── */
function toOpenAIMessages(options) {
	const messages = Array.isArray(options?.messages) ? options.messages : [];
	const out = [];
	const system = String(options?.system ?? "").trim();
	if (system) out.push({ role: "system", content: system });
	for (const message of messages) {
		const role = message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user";
		const parts = Array.isArray(message?.content) ? message.content : [];
		const chunks = [];
		for (const part of parts) {
			if (!part || typeof part !== "object") continue;
			if (part.type === "text" && typeof part.text === "string") chunks.push({ type: "text", text: part.text });
			else if (part.type === "image") {
				const blob = attachments.refOf(part.attachment);
				if (blob) chunks.push({ type: "image_url", image_url: { url: `data:${blob.mediaType};base64,${Buffer.from(blob.bytes).toString("base64")}` } });
			}
		}
		/* 没有图片就用纯字符串，兼容那些不认数组的老端点 */
		out.push({ role, content: chunks.some((c) => c.type === "image_url") ? chunks : chunks.map((c) => c.text).join("\n") });
	}
	return out;
}

function stripThink(text) {
	return String(text ?? "").replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, "").replace(/<think\b[\s\S]*$/i, "").trim();
}

const CN_ERROR = {
	401: "密钥不对或过期（HTTP 401）",
	402: "余额不足（HTTP 402）",
	403: "没有权限访问这个模型（HTTP 403）",
	404: "地址或模型名不对（HTTP 404）",
	429: "请求太频繁 / 配额用完了（HTTP 429）",
};

export async function onlineChat(options = {}) {
	const cfg = readOnlineConfig();
	if (!onlineReady(cfg)) return { ok: false, reason: "provider-missing", message: "独立模式：还没配联网模型（在控制台的「联网模型」里填地址、密钥、模型名）" };

	/* 带图 = 看屏幕：走视觉那套；没配齐就当场说清楚，绝不把图发给纯文本模型 */
	const withImage = wantsImage(options);
	const v = visionTarget(cfg);
	if (withImage && !(v.base && v.key && v.model)) {
		return {
			ok: false,
			reason: "vision-missing",
			message: "还没配「看屏幕」的视觉模型：去控制台「联网模型」里填视觉模型名（接口地址 / Key 留空就跟聊天共用那套）",
		};
	}
	const url = endpoint(withImage ? v.base : cfg.baseUrl);
	const model = withImage ? v.model : String(cfg.model).trim();
	const key = withImage ? v.key : String(cfg.apiKey).trim();

	const body = {
		model,
		messages: toOpenAIMessages(options),
		stream: false,
		temperature: Number.isFinite(options.temperature) ? options.temperature : 1,
		max_tokens: Math.max(16, Number(options.numPredict) || 512),
	};

	const signals = [];
	if (options.signal) signals.push(options.signal);
	signals.push(AbortSignal.timeout(Number(options.timeoutMs) || 180000));

	let res;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: "Bearer " + key },
			body: JSON.stringify(body),
			signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
		});
	} catch (error) {
		return { ok: false, reason: "generate-error", message: "联网模型没连上（" + url + "）：" + (error instanceof Error ? error.message : String(error)) };
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		const known = CN_ERROR[res.status] ?? `HTTP ${res.status}`;
		return { ok: false, reason: "generate-error", message: `联网模型返回 ${known}${detail ? "：" + detail.slice(0, 200) : ""}` };
	}

	let json;
	try {
		json = await res.json();
	} catch (error) {
		return { ok: false, reason: "generate-error", message: "联网模型返回的不是 JSON：" + (error instanceof Error ? error.message : String(error)) };
	}

	const message = json?.choices?.[0]?.message ?? {};
	const text = stripThink(message.content ?? "");
	if (text) return { ok: true, text, model, provider: ONLINE_PROVIDER };
	if (message.reasoning_content) {
		const only = stripThink(message.reasoning_content);
		if (only) return { ok: true, text: only, model, provider: ONLINE_PROVIDER };
	}
	return { ok: false, reason: "generate-error", message: "联网模型没返回文本" + (json?.error?.message ? "：" + String(json.error.message).slice(0, 200) : "") };
}

/** 契约是 AsyncIterable（见 context.mjs 文件头教训 ①），必须手写迭代器 */
export function onlineStream(options = {}) {
	return {
		async *[Symbol.asyncIterator]() {
			const result = await onlineChat(options);
			if (!result.ok) throw new Error(result.message);
			yield { type: "text", text: result.text };
		},
	};
}

/** GET /models：控制台「拉取模型列表」用（不是所有端点都支持，失败不算错） */
export async function listOnlineModels(timeoutMs = 8000) {
	const cfg = readOnlineConfig();
	if (!String(cfg.apiKey).trim()) return { ok: false, reason: "没填密钥", models: [] };
	const base = String(cfg.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
	try {
		const res = await fetch(base + "/models", { headers: { authorization: "Bearer " + String(cfg.apiKey).trim() }, signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, models: [] };
		const json = await res.json();
		const models = (Array.isArray(json?.data) ? json.data : []).map((m) => String(m?.id ?? "")).filter(Boolean);
		return { ok: true, models };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error), models: [] };
	}
}

/**
 * 控制台「测试」按钮：直接发一句话过去，看能不能回来。
 * which = "vision" 时改用「看屏幕」那套地址 / Key / 模型（只发纯文本探测，
 * 足以验证三样都通，不用真拍一张屏幕）。
 */
export async function onlinePing(timeoutMs = 20000, which = "chat") {
	const started = Date.now();
	const cfg = readOnlineConfig();
	const useVision = String(which) === "vision";
	if (useVision) {
		const v = visionTarget(cfg);
		if (!v.base || !v.key || !v.model) {
			return { ok: false, reason: "vision-missing", message: "视觉模型还没配齐：模型名必填（接口地址 / Key 留空会用聊天那套）", ms: 0 };
		}
		const startedV = Date.now();
		const result = await onlineChatTo({ base: v.base, key: v.key, model: v.model }, timeoutMs);
		return { ...result, ms: Date.now() - startedV };
	}
	const result = await onlineChat({ messages: [{ role: "user", content: [{ type: "text", text: "只回两个字：在的" }] }], system: "只回两个字：在的", numPredict: 16, timeoutMs });
	return { ...result, ms: Date.now() - started };
}

/** 用指定的 地址 / 密钥 / 模型名 打一次纯文本探测（测试按钮专用，不读配置文件） */
async function onlineChatTo(target, timeoutMs = 20000) {
	const url = endpoint(target.base);
	const body = {
		model: target.model,
		messages: [{ role: "system", content: "只回两个字：在的" }, { role: "user", content: "只回两个字：在的" }],
		stream: false,
		temperature: 1,
		max_tokens: 16,
	};
	let res;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: "Bearer " + target.key },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(Number(timeoutMs) || 20000),
		});
	} catch (error) {
		return { ok: false, reason: "generate-error", message: "联网模型没连上（" + url + "）：" + (error instanceof Error ? error.message : String(error)) };
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		const known = CN_ERROR[res.status] ?? `HTTP ${res.status}`;
		return { ok: false, reason: "generate-error", message: `联网模型返回 ${known}${detail ? "：" + detail.slice(0, 200) : ""}` };
	}
	try {
		const json = await res.json();
		const text = stripThink(json?.choices?.[0]?.message?.content ?? "");
		if (text) return { ok: true, text, model: target.model, provider: ONLINE_PROVIDER };
		return { ok: false, reason: "generate-error", message: "模型没返回文本" };
	} catch (error) {
		return { ok: false, reason: "generate-error", message: "返回的不是 JSON：" + (error instanceof Error ? error.message : String(error)) };
	}
}
