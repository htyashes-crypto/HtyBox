// 通用：按 scope（工作区路径 / slug）分桶持久化 UI 选择状态。
// 结构 { [scope]: value }，镜像 favSkills / runConfigs / skillTemplates 等既有模式，统一收口，
// 落实"所有有状态的选择都按工作区独立持久化"。tab 选择 / Session agentKind / 树展开等共用。

/** 读某 scope 下 key 的持久化值；无则返回 fallback。 */
export function getWsState<T>(key: string, scope: string, fallback: T): T {
  try {
    const all = JSON.parse(localStorage.getItem(key) || "{}");
    if (all && typeof all === "object" && scope in all) return all[scope] as T;
  } catch {
    /* localStorage 不可用 / 损坏 → 降级到 fallback */
  }
  return fallback;
}

/** 写某 scope 下 key 的持久化值（合并进同 key 的其它 scope，不覆盖）。 */
export function setWsState<T>(key: string, scope: string, value: T): void {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    const all = raw && typeof raw === "object" ? raw : {};
    all[scope] = value;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* localStorage 不可用 → 静默放弃（与既有 load/save 一致） */
  }
}
