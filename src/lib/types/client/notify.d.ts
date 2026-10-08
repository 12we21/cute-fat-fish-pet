/** 图标 URL 表（设置页「获取权限」成功确认的测试通知也用）——文件名单一来源在 shared */
export declare const NOTIFY_ICONS: {
    readonly done: string;
    readonly error: string;
    readonly truncated: string;
    readonly approval: string;
    readonly question: string;
    readonly test: string;
};
/** 申请浏览器通知权限的结果：ok=true 已授予；ok=false 带失败原因（供设置页红字展示） */
export type PermissionResult = {
    ok: true;
} | {
    ok: false;
    reason: 'unsupported' | 'denied' | 'rejected' | 'error';
    message?: string;
};
/** 申请浏览器通知权限。务必在用户手势（点击）下调用——无手势的自动申请可能被浏览器静默压制；
 * 失败时区分原因：unsupported=环境无 Notification、denied=浏览器已标记阻止、
 * rejected=用户在询问弹窗里选了阻止、error=申请过程异常/弹窗被跳过。 */
export declare function requestNotificationPermission(): Promise<PermissionResult>;
/** 重读总开关（设置页保存开关后调用）；之后新触发的通知按新值执行，无需刷新页面 */
export declare function reloadNotifications(): Promise<void>;
/**
 * 启动系统通知引擎。常驻（开关在触发时按实时值判断，不用重启）；
 * 总开关开启且权限未决定时兜底申请一次权限。
 * 1s 轮询 /dsh-pet-7340/notify 拉增量帧：首拉只记基线 seq 不弹历史（页面加载不重放旧通知），
 * 之后每次递增拉新帧并逐条 toast；轮询失败静默，下轮重试；信号中止即退出。
 */
export declare function startNotify(signal: AbortSignal): Promise<void>;
