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
 * 计算终端启动后自动发送的命令。
 * - claude：每终端固定一个 UUID——新建 `--session-id <uuid>`、复原 `--resume "<uuid>"`，
 *   多个 claude 终端互不串（官方 CLI reference 确认 --session-id / --resume）。
 * - codex：上游暂无"启动时指定 session id"，复原用 `resume --last`（当前目录最近一次）；
 *   同一工作区多个 codex 无法各自精确复原（codex 限制）。
 * - shell：无启动命令。
 */
export function launchCmdFor(
  agent: AgentKind,
  resume: boolean,
  sessionId?: string,
): string | undefined {
  if (agent === "claude") {
    if (sessionId)
      return resume
        ? `claude --resume "${sessionId}"\r`
        : `claude --session-id "${sessionId}"\r`;
    return resume ? "claude -c\r" : "claude\r";
  }
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
