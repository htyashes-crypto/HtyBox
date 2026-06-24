import { useEffect, useState } from "react";
import { Allotment } from "allotment";
import Sidebar from "./components/Sidebar";
import TerminalDock, { markWorkspaceClosing } from "./components/TerminalDock";
import Welcome, { type RecentFolder } from "./components/Welcome";
import SettingsModal from "./components/SettingsModal";
import { disposeByPrefix } from "./components/terminalEngine";
import { launchAgents } from "./mcp";

function GearIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface Workspace {
  id: string; // = slug(path)，同时作为 memory 作用域 slug
  name: string; // 文件夹名
  path: string; // 文件夹绝对路径
}

const RECENTS_KEY = "htybox.recents.v1";

// 与后端 memory slug 算法一致：把 : \ / _ 全替换成 -
const slugify = (p: string) => p.replace(/[:\\/_]/g, "-");
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

function loadRecents(): RecentFolder[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    if (Array.isArray(r)) return r;
  } catch {
    /* ignore */
  }
  return [];
}

export default function App() {
  const [recents, setRecents] = useState<RecentFolder[]>(loadRecents);
  const [openWs, setOpenWs] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // 已挂载过的 workspace（懒挂载 + 挂载后常驻 → 切走/回欢迎页时 PTY 后台存活）
  const [opened, setOpened] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
    } catch {
      /* ignore */
    }
  }, [recents]);

  const openFolder = (path: string) => {
    const id = slugify(path);
    const name = basename(path);
    setOpenWs((ws) => (ws.some((w) => w.id === id) ? ws : [...ws, { id, name, path }]));
    setOpened((s) => new Set(s).add(id));
    setActiveId(id);
    setRecents((rs) => [{ name, path }, ...rs.filter((r) => r.path !== path)].slice(0, 12));
  };

  const closeWs = (id: string) => {
    // 标记关闭中：卸载期间别把残缺布局写回；但【保留】布局键 → 重新打开可复原终端
    markWorkspaceClosing(id);
    disposeByPrefix(id + "::"); // 结束该工作区全部终端（PTY）
    const rest = openWs.filter((w) => w.id !== id);
    setOpenWs(rest);
    setOpened((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (id === activeId) setActiveId(rest.length ? rest[rest.length - 1].id : null);
  };

  const active = openWs.find((w) => w.id === activeId) ?? null;

  return (
    <div className="relative flex h-screen w-screen flex-col bg-[#faf9f5] text-[#191919]">
      {/* 顶部：品牌(回欢迎页) + 工作区标签 + 多 Agent（无活动工作区时隐藏） */}
      {active && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#e5e2d9] bg-[#f4f3ee] px-3">
          <button
            onClick={() => setActiveId(null)}
            title="返回欢迎页"
            className="flex items-center gap-2"
          >
            <div className="h-4 w-4 rounded bg-[#d97757]" />
            <span className="text-sm font-bold">HtyBox</span>
          </button>
          <div className="ml-3 flex items-center gap-1.5">
            {openWs.map((w) => {
              const isActive = w.id === activeId;
              return (
                <div
                  key={w.id}
                  onClick={() => setActiveId(w.id)}
                  title={w.path}
                  className={
                    "group flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors " +
                    (isActive
                      ? "border border-[#e5e2d9] border-t-2 border-t-[#d97757] bg-white text-[#191919]"
                      : "border border-[#e5e2d9] text-[#73726c] hover:bg-white hover:text-[#191919]")
                  }
                >
                  <span className="max-w-[140px] truncate">{w.name}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWs(w.id);
                    }}
                    className="ml-0.5 rounded text-[#a8a29a] opacity-0 transition-opacity hover:text-[#191919] group-hover:opacity-100"
                  >
                    ✕
                  </span>
                </div>
              );
            })}
            <span
              onClick={() => setActiveId(null)}
              title="打开/新建工作区"
              className="cursor-pointer rounded px-1.5 text-base text-[#73726c] hover:text-[#191919]"
            >
              +
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              title="设置"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#73726c] transition-colors hover:bg-white hover:text-[#191919]"
            >
              <GearIcon />
            </button>
            <button
              onClick={() => {
                if (!active) return;
                launchAgents(active.id, [
                  { agentId: "负责人", roleName: "负责人", role: "lead", agentKind: "claude" },
                  { agentId: "维护员", roleName: "维护员", role: "worker", agentKind: "codex" },
                ]);
              }}
              title="M7-A 测试：在本工作区起 负责人+维护员 两个 claude agent（接入 MCP broker）"
              className="cursor-pointer rounded-md border border-[#e8c8bb] bg-[#d97757]/12 px-3 py-1 text-xs font-semibold text-[#c15f3c] transition-colors hover:bg-[#d97757]/20"
            >
              多 Agent 协作
            </button>
          </div>
        </div>
      )}

      {/* 两栏：侧栏(Skill/Memory) | 终端区。终端区"始终挂载"——回欢迎页只是被覆盖层盖住，
          终端 PTY 后台存活、不卸载、不被误杀。 */}
      <div className="min-h-0 flex-1">
        <Allotment proportionalLayout={false}>
          <Allotment.Pane minSize={220} preferredSize={300} snap>
            {active ? (
              <Sidebar workspacePath={active.path} workspaceSlug={active.id} />
            ) : (
              <div className="h-full bg-[#f4f3ee]" />
            )}
          </Allotment.Pane>
          <Allotment.Pane minSize={400}>
            <div className="relative h-full w-full">
              {openWs
                .filter((w) => opened.has(w.id))
                .map((w) => (
                  <div
                    key={w.id}
                    className={
                      // 不用 display:none(会让 xterm/WebGL 停渲染→恢复显示时空白)；
                      // 非活动用 opacity-0+低层级保持渲染，活动的盖在最上层
                      "absolute inset-0 " +
                      (w.id === activeId
                        ? "z-10"
                        : "z-0 opacity-0 pointer-events-none")
                    }
                  >
                    <TerminalDock
                      workspaceId={w.id}
                      cwd={w.path}
                      active={w.id === activeId}
                    />
                  </div>
                ))}
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* 底部状态栏 */}
      {active && (
        <div className="flex h-6 shrink-0 items-center gap-2 border-t border-[#e5e2d9] bg-[#f4f3ee] px-3 text-[10px] text-[#8c8a82]">
          <span className="truncate font-mono">{active.path}</span>
          <span className="ml-auto shrink-0">
            {openWs.length} 个工作区 · HtyBox v0.1
          </span>
        </div>
      )}

      {/* 欢迎页：覆盖层（Cursor 式初始界面）。盖在终端区之上，终端在底下保活。 */}
      {!active && (
        <div className="absolute inset-0 z-50">
          <Welcome
            recents={recents}
            onOpen={openFolder}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>
      )}

      {/* 全局设置弹窗（盖在最上层） */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
