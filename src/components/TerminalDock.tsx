import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  ensureEngine,
  attachEngine,
  detachEngine,
  disposeEngine,
  focusEngine,
  setEngineTitleHandler,
} from "./terminalEngine";
import {
  PROFILES,
  DEFAULT_PROFILE,
  injectText,
  launchCmdFor,
  type AgentKind,
  type DragItem,
  type Profile,
} from "../profiles";
import claudeIcon from "../assets/claude.svg";
import codexIcon from "../assets/codex.svg";

type TermParams = {
  termId: string;
  shell?: string;
  agentKind?: AgentKind;
  cwd?: string;
};

const DRAG_MIME = "application/x-htybox-item";

// 用户手动重命名过的 Tab（termId→名字），持久化；自动命名遇到它会跳过、不覆盖。
const CT_KEY = "htybox.customTitles.v1";
const CUSTOM_TITLES: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CT_KEY) || "{}");
  } catch {
    return {};
  }
})();
const saveCT = () => {
  try {
    localStorage.setItem(CT_KEY, JSON.stringify(CUSTOM_TITLES));
  } catch {
    /* ignore */
  }
};

// 本次运行中由布局复原出来的终端 id → 启动时发"复原命令"（claude --resume / codex resume）。
const RESTORED_IDS = new Set<string>();

// 正在关闭的 workspace：其 dock 卸载期间 dockview 仍会逐个移除面板并触发 layout 变更，
// 此时绝不能把"拆到一半的残缺布局"写回 localStorage（否则复原会拿到坏掉的单面板布局）。
const CLOSING = new Set<string>();
export function markWorkspaceClosing(workspaceId: string): void {
  CLOSING.add(workspaceId);
}

/** 自定义 Tab：自动命名标题 + 双击内联重命名（重命名后不被自动命名覆盖）+ 关闭。 */
function DockTab(props: IDockviewPanelHeaderProps<TermParams>) {
  const [title, setTitle] = useState(props.api.title ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const d = props.api.onDidTitleChange((e) => setTitle(e.title));
    return () => d.dispose();
  }, [props.api]);

  const startRename = () => {
    setDraft(title);
    setEditing(true);
  };
  const commit = () => {
    const t = draft.trim();
    if (t) {
      CUSTOM_TITLES[props.params.termId] = t;
      saveCT();
      props.api.setTitle(t);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setEditing(false);
        }}
        className="my-1 w-[150px] rounded border border-[#d4a27f] bg-white px-1.5 py-0.5 text-xs text-[#191919] outline-none"
      />
    );
  }

  return (
    <div
      onDoubleClick={startRename}
      title="双击重命名"
      className="flex h-full items-center gap-2 px-2 text-xs"
    >
      <span className="max-w-[180px] truncate">{title}</span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          props.api.close();
        }}
        className="flex h-4 w-4 items-center justify-center rounded text-[13px] leading-none text-[#a8a29a] hover:bg-[#e5e2d9] hover:text-[#191919]"
      >
        ✕
      </span>
    </div>
  );
}

/** dockview 面板：挂终端引擎 + 自动命名 + 作为 skill/memory 拖拽落点。 */
function DockTerminal(props: IDockviewPanelProps<TermParams>) {
  const { termId, shell, agentKind = "shell", cwd } = props.params;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // 复原出来的终端发"回到上次会话"的命令，否则发新建命令
    const launch = launchCmdFor(agentKind, RESTORED_IDS.has(termId));
    ensureEngine(termId, shell, launch, cwd);
    attachEngine(termId, c);

    // 自动命名：程序设置终端标题(OSC)时同步到 Tab；已被用户重命名的跳过
    setEngineTitleHandler(termId, (t) => {
      const title = t.trim();
      if (title && !CUSTOM_TITLES[termId]) props.api.setTitle(title);
    });
    // 复原时若该终端有自定义名，立即恢复（之后程序标题也不会覆盖它）
    if (CUSTOM_TITLES[termId]) props.api.setTitle(CUSTOM_TITLES[termId]);

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(DRAG_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        c.classList.add("htybox-drop");
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!c.contains(e.relatedTarget as Node | null))
        c.classList.remove("htybox-drop");
    };
    const onDrop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData(DRAG_MIME);
      c.classList.remove("htybox-drop");
      if (!raw) return;
      e.preventDefault();
      try {
        const item = JSON.parse(raw) as DragItem;
        const text = injectText(item, agentKind) + (e.shiftKey ? "\r" : "");
        invoke("write_terminal", { id: termId, data: text }).catch(() => {});
        focusEngine(termId);
      } catch {
        /* ignore */
      }
    };

    c.addEventListener("dragover", onDragOver);
    c.addEventListener("dragleave", onDragLeave);
    c.addEventListener("drop", onDrop);

    return () => {
      c.removeEventListener("dragover", onDragOver);
      c.removeEventListener("dragleave", onDragLeave);
      c.removeEventListener("drop", onDrop);
      setEngineTitleHandler(termId, undefined);
      detachEngine(termId);
    };
  }, [termId, shell, agentKind, cwd, props.api]);
  // 内边距 + 终端底色：避免 xterm 内容贴边被面板边缘裁切
  return <div ref={ref} className="h-full w-full bg-[#1f1e1d] p-2" />;
}

/** 工具栏图标：Claude / Codex 用 FanBox 仓库的官方 SVG 素材；PowerShell 用终端 >_。 */
function ProfileIcon({ id }: { id: string }) {
  if (id === "claude")
    return (
      <img src={claudeIcon} alt="Claude" className="h-4 w-4" draggable={false} />
    );
  if (id === "codex")
    return (
      <img src={codexIcon} alt="Codex" className="h-4 w-4" draggable={false} />
    );
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
      <polyline points="4 7 9 12 4 17" />
      <line x1="11" y1="17" x2="19" y2="17" />
    </svg>
  );
}

const components = { terminal: DockTerminal };

let seq = 0;
let termNo = 0;
const nextTitle = () => `终端${++termNo}`;
const titleFor = (p: Profile) =>
  p.agentKind === "shell" ? nextTitle() : `${nextTitle()} · ${p.label}`;
const paramsFor = (p: Profile, id: string, cwd: string): TermParams => ({
  termId: id,
  shell: p.shell,
  agentKind: p.agentKind,
  cwd,
});

/** 终端区：一个 workspace 一个实例；终端 id/布局键按 workspace 隔离，cwd=工作区文件夹。 */
export default function TerminalDock({
  workspaceId,
  cwd,
}: {
  workspaceId: string;
  cwd: string;
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const layoutKey = `htybox.dock.layout.${workspaceId}`;
  const mkId = () =>
    `${workspaceId}::t-${Date.now().toString(36)}-${(seq++).toString(36)}`;

  const addTerminal = useCallback(
    (profile: Profile) => {
      const api = apiRef.current;
      if (!api) return;
      const id = mkId();
      api.addPanel({
        id,
        component: "terminal",
        title: titleFor(profile),
        params: paramsFor(profile, id, cwd),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      CLOSING.delete(workspaceId); // 重新打开 → 不再处于关闭态

      api.onDidRemovePanel((panel) => {
        const termId = (panel.params as TermParams | undefined)?.termId;
        if (!termId) return;
        // 工作区关闭中：引擎已由 disposeByPrefix 统一结束，且要保留布局/自定义名供复原 → 跳过
        if (CLOSING.has(workspaceId)) return;
        disposeEngine(termId);
        if (CUSTOM_TITLES[termId]) {
          delete CUSTOM_TITLES[termId];
          saveCT();
        }
      });

      api.onDidLayoutChange(() => {
        if (CLOSING.has(workspaceId)) return; // 关闭中：别把残缺布局写回
        try {
          localStorage.setItem(layoutKey, JSON.stringify(api.toJSON()));
        } catch {
          /* ignore */
        }
      });

      let restored = false;
      const saved = localStorage.getItem(layoutKey);
      if (saved) {
        try {
          api.fromJSON(JSON.parse(saved));
          restored = api.panels.length > 0;
          // 标记为"复原"，DockTerminal 启动时改发 resume 命令
          if (restored)
            api.panels.forEach((p) => {
              const tid = (p.params as TermParams | undefined)?.termId;
              if (tid) RESTORED_IDS.add(tid);
            });
        } catch {
          restored = false;
        }
      }
      if (restored) {
        termNo = Math.max(termNo, api.panels.length);
      } else {
        const id1 = mkId();
        api.addPanel({
          id: id1,
          component: "terminal",
          title: titleFor(DEFAULT_PROFILE),
          params: paramsFor(DEFAULT_PROFILE, id1, cwd),
        });
        const id2 = mkId();
        api.addPanel({
          id: id2,
          component: "terminal",
          title: titleFor(DEFAULT_PROFILE),
          params: paramsFor(DEFAULT_PROFILE, id2, cwd),
          position: { referencePanel: id1, direction: "right" },
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#1f1e1d]">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-[#e5e2d9] bg-[#f4f3ee] px-2 py-1.5">
        {PROFILES.map((p) => (
          <button
            key={p.id}
            onClick={() => addTerminal(p)}
            title={`新建 ${p.label} 终端`}
            style={{ color: p.dotColor }}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white"
          >
            <ProfileIcon id={p.id} />
          </button>
        ))}
      </div>
      <div className="dockview-theme-light min-h-0 flex-1">
        <DockviewReact
          components={components}
          defaultTabComponent={DockTab}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
