/** 工作状态档位（对应 animations.events.workStatus 数组索引，顺序即档位，勿在中间插入新档） */
export declare const WORK_STATUS_STATES: readonly ["thinking", "working", "result", "waiting", "success", "error"];
export type WorkStatusState = (typeof WORK_STATUS_STATES)[number];
/** 档位 → workStatus 数组索引（与 events.workStatus 数组顺序严格一致） */
export declare const WORK_STATUS_INDEX: Record<WorkStatusState, number>;
/** /dsh-pet-7340/work-status 响应（与 host 的 WorkStatusSnapshot 同构；两端按此结构校验）。
 *  text 不在此：气泡文案由浏览器读配置 events.workStatusTexts，host 不生成。 */
export interface WorkStatusSnapshot {
    state: WorkStatusState | null;
    task: string | null;
    ts: number;
}
/** 拉取当前工作状态快照；解析/网络失败显式抛错（上层决定，绝不静默伪造） */
export declare function fetchWorkStatus(baseUrl?: string): Promise<WorkStatusSnapshot>;
