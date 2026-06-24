export type AgentKind = "claude" | "codex" | "shell";

export interface Profile {
  id: string;
  label: string;
  agentKind: AgentKind;
  /** 实际启动的 shell；claude/codex 走"先起 shell 再自动发命令" */
  shell: string;
  /** 启动后自动发送的命令（含回车），如 "claude\r"；实际命令由 launchCmdFor 计算 */
  launchCmd?: string;
  /** 标签/指示点颜色 */
  dotColor: string;
}

export const PROFILES: Profile[] = [
  {
    id: "powershell",
    label: "PowerShell",
    agentKind: "shell",
    shell: "powershell.exe",
    dotColor: "#8c8a82",
  },
  {
    id: "claude",
    label: "Claude Code",
    agentKind: "claude",
    shell: "powershell.exe",
    launchCmd: "claude\r",
    dotColor: "#d97757",
  },
  {
    id: "codex",
    label: "Codex",
    agentKind: "codex",
    shell: "powershell.exe",
    launchCmd: "codex\r",
    dotColor: "#10a37f",
  },
];

export const DEFAULT_PROFILE = PROFILES[0];

/**
 * 计算终端启动后自动发送的命令。复原(resume)=【自动续上当前目录最近一次会话】(零点击)：
 * 实测 claude 交互模式【忽略】--session-id（自生成 id，--resume <我们的 uuid> 必 "No conversation
 * found"，已用会话文件证实），故不能靠预设 id。改用 cwd 维度的"最近一次"：
 * - claude：新建 `claude`，复原 `claude -c`（continue 当前目录最近一次会话，无需选择器）
 * - codex：新建 `codex`，复原 `codex resume --last`（当前目录最近一次）
 * - shell：无启动命令。
 * 注：终端 cwd=工作区文件夹，故"最近一次"通常就是上次那个会话。若同一工作区开了多个
 * 同类 agent，它们会都续到"最近那一个"（无法各自精确区分）——需精确则要后端抓真实 session id。
 */
export function launchCmdFor(
  agent: AgentKind,
  resume: boolean,
): string | undefined {
  if (agent === "claude") return resume ? "claude -c\r" : "claude\r";
  if (agent === "codex") return resume ? "codex resume --last\r" : "codex\r";
  return undefined;
}

export interface DragItem {
  kind: "skill" | "memory";
  invoke?: string; // skill 的 /调用串
  path: string; // 文件绝对路径
}

/** 按目标终端的 agent 类型决定注入文本（落点时计算，而非拖起时）。 */
export function injectText(item: DragItem, agent: AgentKind): string {
  if (item.kind === "skill") {
    if (agent === "claude") return item.invoke ?? item.path; // /skill-name
    if (agent === "codex") return "@" + item.path; // codex 用文件路径
    return item.path; // 裸 shell：纯路径
  }
  // memory
  return agent === "shell" ? item.path : "@" + item.path;
}
