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
 * 计算终端启动后自动发送的命令。复原(resume)=【按"记住的会话名称"精确复原】，多终端各回各的：
 * 实测 claude 交互模式忽略 --session-id（自生成 id），故不能靠预设 id；改为捕获每个终端的会话名
 * （=claude 通过 OSC 设的标题，见 TerminalDock 的 SESSION_NAMES），复原时按名恢复。
 * - claude：新建 `claude`；复原 `claude --resume "<名>"`（官方 -r 支持 by name）；无名退回 `claude --resume`(选择器)
 * - codex：新建 `codex`；复原 `codex resume`（codex 只能按 UUID 复原、无法按名 → 选择器让用户选）
 * - shell：无启动命令。
 */
export function launchCmdFor(
  agent: AgentKind,
  resume: boolean,
  sessionName?: string,
  model?: string,
): string | undefined {
  // 新建时按团队配置传 --model（claude/codex 均支持，已核实）；复原不带(会话自带模型)。
  // 清洗成安全 token(词字符+ . - :)，防破坏命令。
  const mm = (model ?? "").trim().replace(/[^\w.:-]/g, "");
  const m = mm ? ` --model ${mm}` : "";
  if (agent === "claude") {
    if (resume && sessionName) {
      const safe = sessionName.replace(/["\r\n]/g, ""); // 防止破坏命令引号
      return `claude --resume "${safe}"\r`; // 按会话名精确复原（官方 -r 支持 by name）
    }
    return resume ? "claude --resume\r" : `claude${m}\r`; // 没记到名字 → 退回选择器
  }
  // codex 仅能按 UUID 复原、无法按名 → 复原弹选择器让用户选
  if (agent === "codex") return resume ? "codex resume\r" : `codex${m}\r`;
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
