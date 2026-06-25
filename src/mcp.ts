import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AgentRole = "lead" | "worker";

export interface AgentSpec {
  agentId: string;
  roleName: string;
  role: AgentRole;
  agentKind: "claude" | "codex";
  model?: string; // 模型(--model)，空/缺省用 CLI 默认
  responsibility?: string; // 职责(自由文本)，注入 env(HTYBOX_RESPONSIBILITY) 供 M7-C 协议注入
}

/** broker 端点 URL（agent 的 .mcp.json 指向它）。 */
export const mcpBrokerUrl = () => invoke<string>("mcp_broker_url");

/** 注册一个 agent（token→身份）并把 htybox 合并进该 cwd 的 .mcp.json。 */
export const setupMcpAgent = (args: {
  cwd: string;
  token: string;
  agentId: string;
  role: AgentRole;
  roleName: string;
  workspace: string;
}) => invoke<void>("setup_mcp_agent", args);

/** M7-C：写某 agent 的协作简报到 <cwd>/.htybox/brief-<agentId>.md（启动时 agent 先读它）。 */
export const writeAgentBrief = (args: {
  cwd: string;
  agentId: string;
  content: string;
}) => invoke<void>("write_agent_brief", args);

// ---- agent 启动总线 ----
// App(顶栏「多 Agent 协作」) 请求"在某 workspace 的终端区起若干 agent 终端"，
// 由该 workspace 的 TerminalDock 订阅并执行（它持有 dockview api）。
type Launcher = (specs: AgentSpec[]) => void;
const launchers = new Map<string, Launcher>();

export function registerAgentLauncher(workspaceId: string, fn: Launcher): () => void {
  launchers.set(workspaceId, fn);
  return () => {
    if (launchers.get(workspaceId) === fn) launchers.delete(workspaceId);
  };
}

export function launchAgents(workspaceId: string, specs: AgentSpec[]): boolean {
  const fn = launchers.get(workspaceId);
  if (!fn) return false;
  resetRelay(); // M7-D：新一轮团队运行 → 重置全自动接力预算/急停
  fn(specs);
  return true;
}

// ---- M7-D：全自动接力预算 + 急停（防失控的最低护栏）----
let relayCount = 0;
let relayStopped = false;
let relayStartAt = 0;
const RELAY_CAP = 60; // 一轮运行内自动唤醒次数硬上限，触顶停自动(回退手动点击)
const RELAY_MAX_MS = 30 * 60 * 1000; // 一轮运行时长上限(30min)，超时停自动
export function resetRelay(): void {
  relayCount = 0;
  relayStopped = false;
  relayStartAt = Date.now();
}
export function relayStop(): void {
  relayStopped = true;
}
export function relayResume(): void {
  relayStopped = false;
}
export function relayIsStopped(): boolean {
  return relayStopped;
}
/** 申请一次自动唤醒额度；false = 已急停 / 触顶次数 / 超时(应回退手动)。 */
export function relayAllow(): boolean {
  if (
    relayStopped ||
    relayCount >= RELAY_CAP ||
    Date.now() - relayStartAt > RELAY_MAX_MS
  )
    return false;
  relayCount += 1;
  return true;
}

/** M7-D 急停：向所有 agent 终端发 Ctrl+C(\x03) 真中断（停注入之外的硬停）。 */
export function interruptAllAgents(): void {
  for (const termId of agentTerminals.values()) {
    invoke("write_terminal", { id: termId, data: "\x03" }).catch(() => {});
  }
}
export function relayUsage(): { count: number; cap: number; stopped: boolean } {
  return { count: relayCount, cap: RELAY_CAP, stopped: relayStopped };
}

// ---- M7-B：agentId → termId 映射（半自动唤醒时定位要注入的终端）----
const agentTerminals = new Map<string, string>();
export function setAgentTerminal(agentId: string, termId: string): void {
  agentTerminals.set(agentId, termId);
}
export function getAgentTerminal(agentId: string): string | undefined {
  return agentTerminals.get(agentId);
}

// ---- M7-B：唤醒事件（broker 在某挂起 agent 收到新消息时 emit "agent-wake"）----
export interface AgentWake {
  agentId: string;
  roleName: string;
  workspace: string;
  from: string;
  preview: string;
}
export function onAgentWake(fn: (w: AgentWake) => void): Promise<UnlistenFn> {
  return listen<AgentWake>("agent-wake", (e) => fn(e.payload));
}

// ---- M7-D：死循环事件（broker 检测到同内容连发≥3 次的 A↔B 空转）----
export interface AgentLoop {
  from: string;
  to: string;
  preview: string;
}
export function onAgentLoop(fn: (l: AgentLoop) => void): Promise<UnlistenFn> {
  return listen<AgentLoop>("agent-loop", (e) => fn(e.payload));
}
