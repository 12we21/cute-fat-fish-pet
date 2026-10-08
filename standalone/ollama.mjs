/* 独立模式的本机模型通路
 *
 * 独立模式下没有 DSH，也就没有 DSH 的模型服务（在线大脑 / 会话 / 凭证）。
 * 但插件本来就有第二条路：**本机 Ollama**（app/lib/index.js:381 petOllamaGenerate
 * 直接 POST 127.0.0.1:11434/api/generate，与 DSH 无关）。
 *
 * 这个模块把「独立模式下唯一可用的模型服务」补齐成两件事：
 *   1. 附件登记处（ctx.get("attachments")）—— 屏幕监测要把截图塞进消息里；
 *   2. llm.stream 的替身实现 —— 把插件发来的 {provider, model, messages, system}
 *      翻译成 Ollama 的 /api/chat，把结果以 {type:"text", text} 分片吐回去。
 * 这样「碎碎念 / 对话 / AI 导演 / 屏幕监测点评」在独立模式下照样能用，
 * 走的是本机模型（免费、离线），而不是插件的失败分支。
 *
 * 模型从哪来：$DSH_HOME/dsh-pet/screen-watch/state.json
 *   localProvider / localModel / localApi / quipModel
 *   （优先级 quipModel → localModel，与插件 app/lib/index.js:382 一致）
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveDshHome } from "./shims/dsh-home-paths.mjs";

export const DEFAULT_OLLAMA_API = "http://127.0.0.1:11434";
/** 在线大脑在独立模式下的替身 provider id（插件会把它原样回传给 llm.stream） */
export const LOCAL_PROVIDER = "ollama";

/* ── screen-watch/state.json（带 mtime 缓存，随改随生效） ───────────────── */
const STATE_REL = join("dsh-pet", "screen-watch", "state.json");
let cached = { file: null, mtimeMs: 0, config: null };

export function screenWatchStatePath() {
	return join(resolveDshHome(), STATE_REL);
}

export function readBrainConfig() {
	const file = screenWatchStatePath();
	try {
		const info = readFileSync(file, "utf8");
		const mtimeMs = 0;
		void mtimeMs;
		const config = JSON.parse(info);
		cached = { file, mtimeMs: Date.now(), config };
		return config;
	} catch {
		/* 首次读或读失败：退回上次成功读到的，实在没有就给空对象 */
		return cached.config ?? {};
	}
}

/** 独立模式下「当前对话用什么模型」——插件 app/lib/index.js:382 的同款优先级 */
export function currentModel() {
	const cfg = readBrainConfig();
	return String(cfg.quipModel || cfg.localModel || "").trim();
}

export function currentProvider() {
	const cfg = readBrainConfig();
	return String(cfg.localProvider || LOCAL_PROVIDER).trim() || LOCAL_PROVIDER;
}

export function ollamaApi() {
	const cfg = readBrainConfig();
	return String(cfg.localApi || DEFAULT_OLLAMA_API).replace(/\/+$/, "");
}

/** GET /api/tags：独立模式启动横幅用（也是「本机模型在不在」的唯一判据） */
export async function listOllamaModels(timeoutMs = 2500) {
	try {
		const res = await fetch(ollamaApi() + "/api/tags", { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, models: [] };
		const json = await res.json();
		const models = (Array.isArray(json?.models) ? json.models : []).map((m) => String(m?.name ?? "")).filter(Boolean);
		return { ok: true, models };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error), models: [] };
	}
}

/* ── 附件登记处（ctx.get("attachments")） ────────────────────────────────
 * 只有一处消费：app/lib/index.js:2129 的 att.saveImages([{data, mediaType, name}])，
 * 拿回来的 ref 会被塞进消息的 {type:"image", attachment: ref}，再由下面翻译成
 * Ollama 的 images 数组。所以只要能把字节留住、并按 ref 取回即可。 */
const blobs = new Map();

export const attachments = {
	async saveImages(list) {
		const out = [];
		for (const item of Array.isArray(list) ? list : []) {
			const id = randomUUID();
			const bytes = item?.data instanceof Uint8Array ? item.data : new Uint8Array(item?.data ?? []);
			blobs.set(id, { bytes, mediaType: item?.mediaType ?? "application/octet-stream", name: item?.name ?? "image" });
			out.push({ id, mediaType: item?.mediaType ?? "application/octet-stream", name: item?.name ?? "image", size: bytes.byteLength });
		}
		return out;
	},
	async saveFiles(list) {
		return this.saveImages(list);
	},
	refOf(ref) {
		const id = typeof ref === "string" ? ref : ref?.id;
		return id ? blobs.get(id) : undefined;
	},
};

/* ── Ollama /api/chat ──────────────────────────────────────────────────────
 * 插件给的 messages 形状：{role, content: [{type:"text",text} | {type:"image",attachment}]}
 * 拼成 Ollama 的： {role, content: "<文本>", images: ["<base64>"]} */
function toOllamaMessages(options) {
	const messages = Array.isArray(options?.messages) ? options.messages : [];
	const out = [];
	const system = String(options?.system ?? "").trim();
	if (system) out.push({ role: "system", content: system });
	for (const message of messages) {
		const role = message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user";
		const parts = Array.isArray(message?.content) ? message.content : [];
		const texts = [];
		const images = [];
		for (const part of parts) {
			if (!part || typeof part !== "object") continue;
			if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
			else if (part.type === "image") {
				const blob = attachments.refOf(part.attachment);
				if (blob) images.push(Buffer.from(blob.bytes).toString("base64"));
			}
		}
		out.push(images.length > 0 ? { role, content: texts.join("\n"), images } : { role, content: texts.join("\n") });
	}
	return out;
}

/** 推理模型的思考块：成对剥掉，没闭合的从 "<think" 起截断（与插件同策略） */
function stripThink(text) {
	return String(text ?? "").replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, "").replace(/<think\b[\s\S]*$/i, "").trim();
}

/**
 * 一次 chat 生成。返回 { ok, text, model } 或 { ok:false, reason, message }。
 * 刻意用 stream:false —— 插件侧本来就是「攒完再出泡」，而一次性拿到全文才能
 * 安全地剥掉推理模型泄进正文的  thinking 块（分片剥会漏）。
 */
export async function ollamaChat(options = {}) {
	const model = String(options.model || currentModel()).trim();
	if (!model) return { ok: false, reason: "provider-missing", message: "独立模式：没有配置本机模型（screen-watch/state.json 的 quipModel / localModel 是空的）" };

	const body = {
		model,
		messages: toOllamaMessages(options),
		stream: false,
		options: {
			temperature: Number.isFinite(options.temperature) ? options.temperature : 1,
			num_predict: Math.max(16, Number(options.numPredict) || 512),
		},
	};

	const signals = [];
	if (options.signal) signals.push(options.signal);
	signals.push(AbortSignal.timeout(Number(options.timeoutMs) || 120000));

	let res;
	try {
		res = await fetch(ollamaApi() + "/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
		});
	} catch (error) {
		return { ok: false, reason: "generate-error", message: "本机模型没连上（" + ollamaApi() + "）：" + (error instanceof Error ? error.message : String(error)) };
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		return { ok: false, reason: "generate-error", message: `本机模型返回 HTTP ${res.status}${detail ? "：" + detail.slice(0, 200) : ""}` };
	}

	let json;
	try {
		json = await res.json();
	} catch (error) {
		return { ok: false, reason: "generate-error", message: "本机模型返回的不是 JSON：" + (error instanceof Error ? error.message : String(error)) };
	}

	const text = stripThink(json?.message?.content ?? json?.response ?? "");
	if (!text) return { ok: false, reason: "generate-error", message: "本机模型没返回文本" };
	return { ok: true, text, model, provider: LOCAL_PROVIDER };
}

/**
 * 按插件 ctx.llm.stream() 的契约包一层：**必须是 AsyncIterable**（不是 async 函数），
 * 否则 for await 拿到 Promise、立刻 TypeError，而且那个 rejected promise 无人接管
 * 会直接终止进程（上游 0.3.4 的崩溃根因，见 context.mjs 文件头）。
 */
export function ollamaStream(options = {}) {
	return {
		async *[Symbol.asyncIterator]() {
			const result = await ollamaChat(options);
			if (!result.ok) throw new Error(result.message);
			yield { type: "text", text: result.text };
		},
	};
}
