/** /dsh-pet-7340/whisper 响应（与 host/whisper.ts 同构；两端按此结构校验） */
export interface RawWhisperResult {
    ok: boolean;
    text?: string;
    /** 配图名称（= 配置 memes 的键，即 assets/memes/<名称>.png）；未开配图或该次未配图时缺省 */
    image?: string;
    ts?: number;
    reason?: string;
    message?: string;
}
/** 已解析的碎碎念结果：成功（一句话 + 可选配图 + 生成时间戳）/ 失败（显式原因，不伪造文本） */
export type WhisperState = {
    ok: true;
    text: string;
    image?: string;
    ts: number;
} | {
    ok: false;
    reason: 'provider-missing' | 'generate-error';
    message?: string;
};
/** 拉取当前碎碎念文本；解析/网络失败显式抛错（上层决定报错方式，绝不静默伪造文案） */
export declare function fetchWhisperState(baseUrl?: string): Promise<WhisperState>;
/**
 * 表情包图片 URL —— 与视频（/thumb）、字体（/font）、光标（/pic）**完全同一套拼法**：
 * `<base>/pic/memes/<名称>.png`，名称含中文需编码。
 *
 * base 语义 = 各端的「已含 /dsh-pet-7340 前缀的宿主基址」（**与视频的 assetBase 一致**）：
 *   - 浏览器：缺省 `/dsh-pet-7340`（页面就在宿主 origin 上，相对路径即可）；
 *   - 桌面：传 `BASE`（`http://127.0.0.1:<port>/dsh-pet-7340` 或 bridge 的
 *     `dsh-pet-bridge://dsh-pet/dsh-pet-7340`）——桌面页面是 file:// 加载的，
 *     相对路径会被解析成 file:///… 而必然失败；且 bridge 模式必须走自定义 scheme。
 *
 * 注意：base 已含 `/dsh-pet-7340`，函数内**不得**再拼一次（否则出现
 * `…/dsh-pet-7340/dsh-pet-7340/…` 而 404——桌面端图裂的成因）。
 */
export declare function memeImageUrl(name: string, base?: string): string;
/** 气泡配图 class（两端共用，样式见 MEME_BUBBLE_CSS） */
export declare const MEME_IMG_CLASS = "pet-bub-img";
/** 带图气泡 class：取消 min-width，让气泡贴合图片宽度（否则图旁留大片空白） */
export declare const MEME_BUBBLE_CLASS = "has-img";
/** 气泡配图样式 —— 两端注入同一份（与 SCORE_POPUP_CSS / MENU_CSS 同理，避免两处各写一遍）。
 * 尺寸取宠物宽度变量：浏览器用 --dsh-pet-size、桌面用 --pet-size（既有差异），
 * 这里用 CSS 变量回退同时兼容两者，调用方无需传尺寸。 */
export declare const MEME_BUBBLE_CSS: string;
export declare function injectMemeBubbleCss(): void;
/**
 * 生成气泡配图节点（两端共用同一份渲染：浏览器 React 壳与桌面 DOM 壳都调它）。
 * 返回 null 表示「本次不配图」——调用方据此走纯文本路径（老行为不变）。
 * @param name 配图名称（配置 memes 的键）；缺省/空白 → null
 * @param base 已含 /dsh-pet-7340 的宿主基址（与视频同规则）：浏览器缺省，桌面传 BASE
 */
export declare function createMemeImage(name?: string, base?: string): HTMLImageElement | null;
/** 手动触发一次碎碎念（右键菜单「碎碎念」项用）：host 强制立即新生成一句并更新缓存
 *  （绕过节流——周期内的轮询端下次拉取看到新 ts 也会跟着展示，与 /balance/trigger 同语义）。 */
export declare function fetchWhisperTrigger(baseUrl?: string): Promise<WhisperState>;
/** 碎碎念气泡行数据：一句话（role:'label' 单行，复用余额气泡的通用行渲染） */
export type WhisperBubbleRow = {
    role: 'label';
    text: string;
};
/** 碎碎念文本 → 气泡行（两端共用同一份行数据；纯函数，不碰 DOM/React） */
export declare function whisperBubbleView(state: WhisperState): WhisperBubbleRow[];
