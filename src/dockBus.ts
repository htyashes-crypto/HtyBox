// M9：把"打开编辑器 / 在此开终端"从 Sidebar(FilePanel) 路由到对应 workspace 的
// TerminalDock(dockview 宿主)。仿 mcp.ts 的 registerAgentLauncher，按 workspaceId 注册。

interface DockHost {
  openEditor: (path: string) => void;
  openTerminalAt: (cwd: string) => void;
  openTerminalCmd: (opts: { command: string; agentKind: string; title: string; cwd?: string; sessionId?: string }) => void;
}

const hosts = new Map<string, DockHost>();

export function registerDockHost(workspaceId: string, host: DockHost): () => void {
  hosts.set(workspaceId, host);
  return () => {
    if (hosts.get(workspaceId) === host) hosts.delete(workspaceId);
  };
}

/** 在某工作区的 dockview 里打开文件编辑器 Tab。 */
export function openEditor(workspaceId: string, path: string): void {
  hosts.get(workspaceId)?.openEditor(path);
}

/** 在某工作区的 dockview 里新开一个 cwd=指定目录的终端。 */
export function openTerminalAt(workspaceId: string, cwd: string): void {
  hosts.get(workspaceId)?.openTerminalAt(cwd);
}

/** 在某工作区新开终端并自动执行命令（运行配置 / 复原会话用）。 */
export function openTerminalCmd(
  workspaceId: string,
  opts: { command: string; agentKind: string; title: string; cwd?: string; sessionId?: string },
): void {
  hosts.get(workspaceId)?.openTerminalCmd(opts);
}

// M9-N7：编辑器面板被激活时通知 FilePanel"揭示并定位"该文件。FilePanel 注册，TerminalDock 触发。
const revealers = new Map<string, (path: string) => void>();
export function registerActiveFileReveal(workspaceId: string, fn: (path: string) => void): () => void {
  revealers.set(workspaceId, fn);
  return () => {
    if (revealers.get(workspaceId) === fn) revealers.delete(workspaceId);
  };
}
export function emitActiveFile(workspaceId: string, path: string): void {
  revealers.get(workspaceId)?.(path);
}
