/* 独立模式替身：@deepseek-ai/dsh-llm
 *
 * 逐条对齐上游 0.3.6 src/standalone/shims/dsh-llm.ts 的语义。
 * 本插件只用到这四个导出（app/lib/index.js:8 的静态 import）：
 *   createUserMessage / createAssistantMessage / BlockAssembler / ReasoningEffortId
 *
 * 注意：这里只是「消息形状 + 流式聚合器」的替身，不含任何模型调用。
 * 真正的模型走 ctx.llm.stream()，而伪 ctx 那个 stream 一定是抛错的
 * AsyncIterable（见 context.mjs），所以独立模式下碎碎念 / 对话 / AI 导演
 * 会走插件的失败分支，而不是静默产生垃圾内容。
 */

export function createUserMessage(input) {
	const o = input ?? {};
	return { role: "user", content: o.content, source: o.source };
}

export function createAssistantMessage(input) {
	const o = input ?? {};
	return { role: "assistant", content: o.content, source: o.source };
}

/** 上游原文：ReasoningEffortId(id) => id */
export function ReasoningEffortId(id) {
	return id;
}

/** 把 llm.stream() 吐出的 chunk 聚合成 blocks() */
export class BlockAssembler {
	constructor() {
		this.chunks = [];
	}
	push(chunk) {
		if (chunk && chunk.type === "text" && typeof chunk.text === "string") this.chunks.push(chunk.text);
	}
	blocks() {
		const text = this.chunks.join("");
		return text === "" ? [] : [{ type: "text", text }];
	}
}

export default { createUserMessage, createAssistantMessage, ReasoningEffortId, BlockAssembler };
