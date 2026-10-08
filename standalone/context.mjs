/* 独立模式伪 Cordis ctx
 *
 * 架构照抄上游 dsh-pet 0.3.6 的 src/standalone/context.ts：给插件的宿主半边
 * （app/lib/index.js 的 apply(ctx)）喂一个「刚刚够用」的 ctx，让它在没有 DSH 的
 * 机器上也能跑起来，而 app/ 里一个字都不用改。
 *
 * 我们对齐的是自己这份打满补丁的 0.3.0，它用到的 ctx 面一共就这些
 * （app/lib/index.js 里 grep ctx\.[A-Za-z_$]+ 的全部结果）：
 *   ctx.llm.{resolveModelInfo, stream}      ctx.agentDefaultModel.currentSelection()
 *   ctx.logger.{debug,info,warn,error}      ctx.webServer.{port, register}
 *   ctx.get("attachments")                  ctx.credentials.resolve()
 *   ctx.effect(fn)                          ctx.on("session/event", fn)
 *   ctx.commands.register(...)
 *
 * 上游用注释记下的两条硬教训（0.3.4 的崩溃根因），这里原样遵守：
 *   ① ctx.llm.stream 必须返回 AsyncIterable，不能写成 async 函数 —— 否则
 *      for await 拿到的是 Promise，立刻 TypeError，而且那个 rejected promise
 *      无人接管，会以 unhandled rejection 直接终止整个进程。
 *   ② ctx.llm.resolveModelInfo 的契约是异步，必须返回 Promise；同步返回
 *      undefined 时调用方的 .then() 会炸。
 *
 * 模型从哪来（比上游更进一步）：上游的独立模式把 llm 服务留成「明确不可用」，
 * 于是碎碎念 / 对话 / 屏幕监测点评在独立模式下全废。但插件本来就有第二条通路
 * —— 本机 Ollama（app/lib/index.js:370 petOllamaGenerate）。所以这里把
 * ctx.llm.stream / attachments / agentDefaultModel 三个缺口补齐，而且补成**两条**：
 *   1. 本机 Ollama（ollama.mjs）—— 免费、离线；
 *   2. 联网模型（online.mjs，OpenAI 兼容接口）—— 本机没模型时也能说话。
 * 走哪条由 screen-watch/state.json 的 brain 决定，语义与插件自己的三档完全对齐：
 *   local 只走本机 / auto 本机优先失败了才联网 / dsh 在独立版里 = 联网。
 * 仍然保不住的只有余额查询（要 DSH 的凭证库）。
 */

import { attachments, ollamaStream, currentModel, currentProvider, LOCAL_PROVIDER, readBrainConfig } from "./ollama.mjs";
import { onlineStream, onlineReady, onlineVisionReady, readOnlineConfig, ONLINE_PROVIDER } from "./online.mjs";

/** 大脑三档（与插件 app/lib/index.js:1700 附近同义）：本地 / 自动择优 / 联网 */
function brainMode() {
	return String(readBrainConfig().brain || "dsh").trim() || "dsh";
}

/**
 * 两条通路（本机 Ollama / 联网）之间做一次「先 A 后 B」的降级。
 * 只有调用方允许降级时才给 makeSecondary，否则原样抛出 A 的错（brain=local 的语义
 * 就是「连不上就如实报错，绝不偷偷联网」）。
 */
function withFallback(makePrimary, makeSecondary) {
	return {
		async *[Symbol.asyncIterator]() {
			try {
				for await (const chunk of makePrimary()) yield chunk;
			} catch (error) {
				const secondary = typeof makeSecondary === "function" ? makeSecondary() : null;
				if (!secondary) throw error;
				for await (const chunk of secondary) yield chunk;
			}
		},
	};
}

/** 按插件传来的 provider + 当前大脑档位挑一条路 */
function pickStream(options) {
	const opt = options ?? {};
	const provider = String(opt.provider || "").trim();
	const brain = brainMode();
	/* [发布版补丁 V2] 看屏幕（带图）时：在线视觉没配齐就别抢这条路，让下面的
	 *  withFallback 落到本机视觉模型（brain=local 仍然靠 null 短路，绝不联网）。 */
	const wantsImage = (Array.isArray(opt.messages) ? opt.messages : []).some((m) =>
		(Array.isArray(m?.content) ? m.content : []).some((p) => p?.type === "image"),
	);
	const onlineFirst = provider === ONLINE_PROVIDER || (brain === "dsh" && (wantsImage ? onlineVisionReady() : onlineReady()));
	if (onlineFirst) {
		return withFallback(
			() => onlineStream(opt),
			brain === "local" ? null : () => (currentModel() ? ollamaStream(opt) : null),
		);
	}
	return withFallback(
		() => ollamaStream(opt),
		brain === "local" ? null : () => (onlineReady() ? onlineStream(opt) : null),
	);
}

export const STANDALONE_PROVIDER = "standalone";

function stamp() {
	return new Date().toISOString();
}

/** 前缀式 logger；debug 需要 DSH_PET_STANDALONE_DEBUG=1 才出声 */
export function createStandaloneLogger(prefix = "dsh-pet-standalone") {
	const emit = (level, sink) => (...args) => {
		if (level === "debug" && process.env.DSH_PET_STANDALONE_DEBUG !== "1") return;
		sink(`[${prefix} ${stamp()}]`, ...args);
	};
	return {
		debug: emit("debug", console.error),
		info: emit("info", console.log),
		log: emit("info", console.log),
		warn: emit("warn", console.error),
		error: emit("error", console.error),
	};
}

/**
 * @param {{ port?: number | (() => number), logger?: object, routes?: any[] }} options
 *   port 传函数时「读取时才取值」—— 这样调用方可以先把 http 服务监听好，
 *   再把真实端口写进去，插件在 apply() 里就能读到正确端口（上游同款做法）。
 */
export function createStandaloneContext(options = {}) {
	const logger = options.logger ?? createStandaloneLogger();
	const routes = options.routes ?? [];
	const portOf = typeof options.port === "function" ? options.port : () => (typeof options.port === "number" ? options.port : 0);

	const disposers = [];
	const failures = [];

	const fail = (what, error) => {
		const message = error instanceof Error ? error.message : String(error);
		failures.push(`${what}: ${message}`);
		logger.error(`初始化某项失败（已跳过）：${what}: ${message}`);
	};

	const noopDisposer = () => {};

	const ctx = {
		/* ── 生命周期：单项失败不许拖垮整个插件（上游原文语义） ── */
		effect(fn) {
			try {
				const result = fn();
				if (typeof result === "function") {
					disposers.push(result);
					return result;
				}
				return result;
			} catch (error) {
				fail("effect", error);
				return undefined;
			}
		},

		/* ── 事件总线：独立模式没有 DSH 会话 ⇒ 工作状态永远保持空闲 ── */
		on() {
			return noopDisposer;
		},
		once() {
			return noopDisposer;
		},
		off() {},
		emit() {
			return false;
		},
		parallel() {},
		waterfall() {},
		bail() {},

		/* ── 服务查询：attachments 是我们唯一能提供的（屏幕监测塞截图用） ── */
		get(name) {
			if (name === "attachments") return attachments;
			// [发布版补丁 V3] 宿主（app/lib/index.js 的看屏幕那条路）靠它判断「在线视觉配好了没」
			if (name === "onlineVisionReady") return onlineVisionReady;
			return undefined;
		},
		has(name) {
			return name === "attachments" || name === "onlineVisionReady";
		},
		set() {
			return noopDisposer;
		},

		/* ── 宿主会话的替身 ── */
		logger,

		webServer: {
			get port() {
				return portOf();
			},
			register(spec) {
				const route = {
					kind: spec?.kind ?? "prefix",
					path: spec?.path ?? "/",
					handler: spec?.handler,
				};
				routes.push(route);
				return () => {
					const i = routes.indexOf(route);
					if (i >= 0) routes.splice(i, 1);
				};
			},
		},

		commands: {
			register() {
				return noopDisposer;
			},
		},

		agentDefaultModel: {
			/* 同步契约：插件是 `sel = ctx.agentDefaultModel.currentSelection()` 直接调。
			 * 「当前模型」的定义（独立版）：
			 *   brain=dsh  + 配了联网模型 → 联网（这样在线大脑才真的是在线）
			 *   其它情况                  → screen-watch/state.json 的本机模型
			 *                               （quipModel → localModel） */
			currentSelection() {
				const brain = brainMode();
				if (brain === "dsh" && onlineReady()) {
					const model = String(readOnlineConfig().model || "").trim();
					if (model) return { provider: ONLINE_PROVIDER, model };
				}
				const model = currentModel();
				if (!model) return { provider: STANDALONE_PROVIDER, model: "" };
				return { provider: currentProvider() || LOCAL_PROVIDER, model };
			},
		},

		credentials: {
			async resolve() {
				return undefined;
			},
		},

		/* [发布版补丁 B1] 余额查询的独立实现：DSH 的凭证库在独立模式里不存在，
		 *  但主人手里有联网 Key —— 直接问 DeepSeek 的 /user/balance，把结果映射成
		 *  渲染端要的形状（kind:"deepseek"，四个字段全是字符串）。
		 *  没 Key 时返回 credential-missing 并给出**可行动**的话（不能用 unsupported：
		 *  渲染端在那个分支会把 message 丢掉，主人只看到一句「暂不支持」）。 */
		async petBalanceOverride(override) {
			const cfg = { ...readOnlineConfig(), ...(override ?? {}) };
			const key = String(cfg.apiKey || "").trim();
			const base = String(cfg.baseUrl || "").trim().replace(/\/+$/, "");
			const provider = currentProvider() || LOCAL_PROVIDER;
			if (!cfg.enabled || !key) {
				return {
					ok: false,
					provider,
					reason: "credential-missing",
					message: "查余额要联网 Key：控制台「模型 · AI 大脑 → 联网模型」里填接口地址（https://api.deepseek.com）和 API Key，再点保存。",
				};
			}
			if (!/deepseek/i.test(base)) return { ok: false, provider, reason: "unsupported", message: "" };
			try {
				const res = await fetch(base + "/user/balance", {
					headers: { authorization: "Bearer " + key },
					signal: AbortSignal.timeout(20000),
				});
				const body = await res.json().catch(() => null);
				const infos = body && Array.isArray(body.balance_infos) ? body.balance_infos : null;
				if (!res.ok || !infos || infos.length === 0) {
					return { ok: false, provider, reason: "fetch-error", message: "余额接口没给出 balance_infos（HTTP " + res.status + "）" };
				}
				const first = infos[0] || {};
				const str = (v, d) => (typeof v === "string" && v ? v : d);
				return {
					ok: true,
					provider: "deepseek-official",
					kind: "deepseek",
					data: {
						currency: str(first.currency, "CNY"),
						total: str(first.total_balance, "-"),
						granted: str(first.granted_balance, "-"),
						toppedUp: str(first.topped_up_balance, "-"),
					},
				};
			} catch (error) {
				return { ok: false, provider, reason: "fetch-error", message: error instanceof Error ? error.message : String(error) };
			}
		},

		llm: {
			listProviders() {
				const list = [{ id: LOCAL_PROVIDER, name: "本机 Ollama（独立模式）" }];
				if (onlineReady()) list.push({ id: ONLINE_PROVIDER, name: readOnlineConfig().name || "联网模型（独立模式）" });
				return list;
			},
			async listModels() {
				const out = [];
				const { listOllamaModels } = await import("./ollama.mjs");
				const probe = await listOllamaModels();
				for (const id of probe.models) out.push({ id, provider: LOCAL_PROVIDER });
				if (onlineReady()) {
					const { listOnlineModels } = await import("./online.mjs");
					const online = await listOnlineModels();
					for (const id of online.models) out.push({ id, provider: ONLINE_PROVIDER });
				}
				return out;
			},
			/* 契约是异步：必须 Promise（见文件头教训 ②）。
			 * 恒返回 undefined ⇒ 插件的 supportsReasoningOff() 为 false ⇒ 不会往
			 * options 里加 reasoningEffort（两条通路都用不上这个字段，正合） */
			async resolveModelInfo() {
				return undefined;
			},
			/* 契约是 AsyncIterable（见文件头教训 ①）。按 provider + 大脑档位在
			 * 「本机 Ollama」和「联网模型」之间选一条，必要时降级（见 pickStream）。 */
			stream(options) {
				return pickStream(options);
			},
		},
	};

	return {
		ctx,
		routes,
		failures,
		get effectCount() {
			return disposers.length;
		},
		dispose() {
			while (disposers.length > 0) {
				const dispose = disposers.pop();
				try {
					dispose();
				} catch (error) {
					fail("dispose", error);
				}
			}
		},
	};
}
