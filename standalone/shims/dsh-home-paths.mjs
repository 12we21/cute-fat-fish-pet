/* 独立模式替身：@deepseek-ai/dsh-home-paths
 *
 * 上游 dsh-pet 0.3.6 的 src/standalone/shims/dsh-home-paths.ts 是这么写的：
 *   export { dshHomeDir as resolveDshHome } from '../../host/helper-process';
 * 也就是「不写第二套实现，直接复用插件自己的口径」。
 *
 * 我们这版是打满补丁的 0.3.0，lib/index.js 只导出 { apply, inject, name }，
 * 拿不到它内部的 dshHomeDir()，所以照抄同一口径重写一遍。
 * 口径必须与 app/lib/index.js:1194-1197 逐字一致，否则数据根会指到别处。
 */
import { join } from "node:path";

export function resolveDshHome() {
	const userProfile = process.env.USERPROFILE || process.env.HOME || "";
	return process.env.DSH_HOME || join(userProfile, ".dsh");
}

/** 老代码里偶尔按这个名字引用，一并给出 */
export const dshHomeDir = resolveDshHome;

export default { resolveDshHome, dshHomeDir };
