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
  fn(specs);
  return true;
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
