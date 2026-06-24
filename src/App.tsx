import { useEffect, useState } from "react";
import { Allotment } from "allotment";
import Sidebar from "./components/Sidebar";
import TerminalDock from "./components/TerminalDock";
import { disposeByPrefix } from "./components/terminalEngine";

interface Workspace {
  id: string;
  name: string;
}

const WS_KEY = "htybox.workspaces.v1";

function loadWorkspaces(): { list: Workspace[]; activeId: string } {
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.list) && d.list.length)
        return { list: d.list, activeId: d.activeId ?? d.list[0].id };
    }
  } catch {
    /* ignore */
  }
  return {
    list: [
      { id: "ws-1", name: "workspace1" },
      { id: "ws-2", name: "workspace2" },
    ],
    activeId: "ws-1",
  };
}

let wsSeq = 100;
const newWsId = () => `ws-${Date.now().toString(36)}-${(wsSeq++).toString(36)}`;

export default function App() {
  const [{ list: initList, activeId: initActive }] = useState(loadWorkspaces);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initList);
  const [activeId, setActiveId] = useState(initActive);
  // 已挂载过的 workspace（懒挂载 + 挂载后常驻 → 切走时 PTY 后台存活）
  const [opened, setOpened] = useState<Set<string>>(() => new Set([initActive]));

  useEffect(() => {
    setOpened((s) => (s.has(activeId) ? s : new Set(s).add(activeId)));
  }, [activeId]);

  useEffect(() => {
    try {
      localStorage.setItem(WS_KEY, JSON.stringify({ list: workspaces, activeId }));
    } catch {
      /* ignore */
    }
  }, [workspaces, activeId]);

  const addWorkspace = () => {
    const id = newWsId();
    setWorkspaces((w) => [...w, { id, name: `workspace${w.length + 1}` }]);
    setActiveId(id);
  };

  const closeWorkspace = (id: string) => {
    if (workspaces.length <= 1) return; // 至少留一个
    disposeByPrefix(id + "::"); // 结束该工作区全部终端
    try {
      localStorage.removeItem(`htybox.dock.layout.${id}`);
    } catch {
      /* ignore */
    }
    const rest = workspaces.filter((x) => x.id !== id);
    setWorkspaces(rest);
    setOpened((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (id === activeId) setActiveId(rest[0].id);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#faf9f5] text-[#191919]">
      {/* 顶部 workspace 标签栏 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#e5e2d9] bg-[#f4f3ee] px-3">
        <div className="h-4 w-4 rounded bg-[#d97757]" />
        <span className="text-sm font-bold">HtyBox</span>
        <div className="ml-3 flex items-center gap-1.5">
          {workspaces.map((ws) => {
            const active = ws.id === activeId;
            return (
              <div
                key={ws.id}
                onClick={() => setActiveId(ws.id)}
                className={
                  "group flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors " +
                  (active
                    ? "border border-[#e5e2d9] border-t-2 border-t-[#d97757] bg-white text-[#191919]"
                    : "border border-[#e5e2d9] text-[#73726c] hover:bg-white hover:text-[#191919]")
                }
              >
                <span>{ws.name}</span>
                {workspaces.length > 1 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWorkspace(ws.id);
                    }}
                    className="ml-0.5 rounded text-[#a8a29a] opacity-0 transition-opacity hover:text-[#191919] group-hover:opacity-100"
                  >
                    ✕
                  </span>
                )}
              </div>
            );
          })}
          <span
            onClick={addWorkspace}
            title="新建工作区"
            className="cursor-pointer rounded px-1.5 text-base text-[#73726c] hover:text-[#191919]"
          >
            +
          </span>
        </div>
        <div className="ml-auto cursor-pointer rounded-md border border-[#e8c8bb] bg-[#d97757]/12 px-3 py-1 text-xs font-semibold text-[#c15f3c] transition-colors hover:bg-[#d97757]/20">
          多 Agent 协作
        </div>
      </div>

      {/* 两栏：侧栏(Skill/Memory) | 终端区(按 workspace 隔离，切换保留后台) */}
      <div className="min-h-0 flex-1">
        <Allotment proportionalLayout={false}>
          <Allotment.Pane minSize={220} preferredSize={300} snap>
            <Sidebar />
          </Allotment.Pane>
          <Allotment.Pane minSize={400}>
            <div className="relative h-full w-full">
              {workspaces
                .filter((ws) => opened.has(ws.id))
                .map((ws) => (
                  <div
                    key={ws.id}
                    className={
                      "absolute inset-0 " + (ws.id === activeId ? "" : "hidden")
                    }
                  >
                    <TerminalDock workspaceId={ws.id} />
                  </div>
                ))}
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* 底部状态栏 */}
      <div className="flex h-6 shrink-0 items-center border-t border-[#e5e2d9] bg-[#f4f3ee] px-3 text-[10px] text-[#8c8a82]">
        {workspaces.length} 个工作区 · 切换保留后台终端 · 拖 skill/memory 到终端注入 · HtyBox v0.1
      </div>
    </div>
  );
}
