/* 独立模式替身：@deepseek-ai/dsh-credentials
 *
 * 上游 0.3.6 src/standalone/shims/dsh-credentials.ts 原文：
 *   export function credentialRef(ref) { return ref; }   // 恒等
 *
 * 插件里唯一的用法是 lib/index.js:2387
 *   const rc = await ctx.credentials.resolve(credentialRef(ref));
 * 而伪 ctx 的 credentials.resolve() 恒返回 undefined ⇒ 余额类功能在独立模式下
 * 走「结构化不可用」分支，不假装成功。
 */
export function credentialRef(ref) {
	return ref;
}

export default { credentialRef };
