// 运行状态总线：聚合 per-terminal "agent 是否在跑" → per-workspace 三态，驱动顶栏标签状态图标。
// 实时、不持久化（重启后进程都没了）。
//
// 判定 = OSC 标题"活动检测"（决策 5 增强）：agent 思考时其 TUI 的 spinner 会持续刷新终端标题
// → 标题在跳动=运行中；标题静默超过 IDLE_MS=完成/空闲。比死记 spinner 字符更鲁棒、对
// claude/codex 通用、不依赖 CLI 版本。
//
// 三态（优先级 running > doneUnseen > idle）：
//   running     —— 该工作区有 agent 终端正在跑
//   done-unseen —— 工作区从运行转完成、且当时不是当前激活工作区（后台跑完，待查看）
//   idle        —— 默认（已查看 / 从未运行）

export type WsStatus = "running" | "done-unseen" | "idle";

type Listener = () => void;
const listeners = new Set<Listener>();
function emit(): void {
  listeners.forEach((f) => f());
}
/** 订阅状态变化（顶栏标签用于实时刷新）。返回取消函数。 */
export function onAgentStatusChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const IDLE_MS = 1500; // 标题静默超过此时长 → 判定完成/空闲

const running = new Map<string, boolean>(); // termId → 是否运行中
const idleTimers = new Map<string, number>(); // termId → idle 定时器句柄
const doneUnseen = new Set<string>(); // 工作区 → 完成待查看
let activeWs: string | null = null; // 当前激活工作区

// 终端 id 形如 "<wsId>::<...>"，反推工作区 id
const wsOf = (termId: string): string => {
  const i = termId.indexOf("::");
  return i >= 0 ? termId.slice(0, i) : termId;
};
const wsRunning = (ws: string): boolean => {
  for (const [tid, run] of running) if (run && wsOf(tid) === ws) return true;
  return false;
};

/** agent 终端标题"跳动"一次（onTitle 内容真变时调）→ 标记运行 + 重置 idle 定时器。 */
export function pingAgentActivity(termId: string): void {
  const ws = wsOf(termId);
  const wasRunning = wsRunning(ws);
  running.set(termId, true);
  const t = idleTimers.get(termId);
  if (t) window.clearTimeout(t);
  idleTimers.set(
    termId,
    window.setTimeout(() => markIdle(termId), IDLE_MS),
  );
  if (!wasRunning) emit(); // 该工作区由非运行 → 运行
}

function markIdle(termId: string): void {
  if (!running.get(termId)) return;
  const ws = wsOf(termId);
  running.set(termId, false);
  idleTimers.delete(termId);
  // 该工作区聚合 running 由 true→false 跳变：若此刻非当前激活工作区 → 标记"完成待查看"
  if (!wsRunning(ws) && ws !== activeWs) doneUnseen.add(ws);
  emit();
}

/** 终端关闭/进程退出 → 清其运行态（用户主动关，不算"完成待查看"）。 */
export function clearTerm(termId: string): void {
  const ws = wsOf(termId);
  const wasRunning = running.get(termId) === true;
  running.delete(termId);
  const t = idleTimers.get(termId);
  if (t) {
    window.clearTimeout(t);
    idleTimers.delete(termId);
  }
  if (wasRunning && !wsRunning(ws)) emit();
}

/** 关闭整个工作区时清理其全部终端状态（避免 map 残留）。 */
export function clearWorkspace(ws: string): void {
  for (const tid of [...running.keys()]) {
    if (wsOf(tid) === ws) {
      running.delete(tid);
      const t = idleTimers.get(tid);
      if (t) window.clearTimeout(t);
      idleTimers.delete(tid);
    }
  }
  doneUnseen.delete(ws);
  emit();
}

/** 设置当前激活工作区；切到某工作区即视为"已查看"，清其完成待查看标记。 */
export function setActiveWorkspace(ws: string | null): void {
  activeWs = ws;
  if (ws && doneUnseen.delete(ws)) emit();
}

/** 取某工作区的三态状态（顶栏标签图标据此渲染）。 */
export function workspaceStatus(ws: string): WsStatus {
  if (wsRunning(ws)) return "running";
  if (doneUnseen.has(ws)) return "done-unseen";
  return "idle";
}
