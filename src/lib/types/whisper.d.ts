/**
 * 碎碎念生成（host 半侧）：用 DSH 的 LLM 统一抽象层（ctx.llm）按当前对话用的
 * provider/model 生成一句话。与余额不同：不自己拼各服务商端点、不碰凭证——
 * ctx.llm 已接管适配器路由/模型解析/凭据，天然与对话页完全一致。
 *
 * 设计：
 * - provider/model 直接取 agentDefaultModel.currentSelection()（与余额同源）；
 * - system = 用户配置的 whisperPrompt（人设），user = 一个极简的"说句话"请求；
 * - 配图（可选）：开启 whisperImageEnabled 时，由调用方从表情包池随机抽一张传入，
 *   把该图描述注入 user 指令，让这句话配合画面说——随机而非让模型选：
 *   碎碎念本身没有上下文可选（人设固定、无用户输入），交模型"选"只能盲选且多了幻觉风险；
 * - reasoningEffort: 'off' —— 仅当模型声明支持 reasoning effort（含 "off"）时传，
 *   关闭深度思考：碎碎念只求随口一句，不开推理（省时省 token）。无 reasoning 元数据的
 *   模型（如 reasoningEfforts: false）显式传 off 会被 dsh-llm 判为 UNSUPPORTED_REASONING_EFFORT
 *   并折叠成空流（表现为"模型未返回文本"），因此这类模型省略该字段（语义等价于不传）；
 * - 流式收集 + BlockAssembler 拼装文本；生成失败显式返回结构化原因，不伪造文案；
 * - 短超时（LLM 冷启动/慢响应时快速放弃，不留挂起请求）。
 */
/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构） */
export type WhisperGenerateResult = {
    ok: true;
    text: string;
    image?: string;
} | {
    ok: false;
    reason: 'provider-missing' | 'generate-error';
    message?: string;
};
/**
 * 用当前对话的 provider/model 生成一句碎碎念。
 * @param ctx 宿主上下文（注入 agentDefaultModel / llm）
 * @param system 人设提示词（whisperPrompt）
 * @param meme 配图（开启配图时传入；缺省 = 纯文本碎碎念）。生成成功时原样带回，
 *             客户端据此展示图片（host 不判断模型是否真的贴合）
 * @returns 生成的文本（+ 配图），或结构化失败（provider 缺失 / 生成错误）
 */
export declare function generateWhisper(ctx: {
    agentDefaultModel: {
        currentSelection(): {
            provider: string;
            model: string;
        };
    };
    llm?: unknown;
}, system: string, meme?: {
    name: string;
    desc: string;
}): Promise<WhisperGenerateResult>;
