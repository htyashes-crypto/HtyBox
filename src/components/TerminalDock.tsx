import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  ensureEngine,
  attachEngine,
  detachEngine,
  disposeEngine,
  focusEngine,
} from "./terminalEngine";
import {
  PROFILES,
  DEFAULT_PROFILE,
  injectText,
  type AgentKind,
  type DragItem,
  type Profile,
} from "../profiles";

type TermParams = {
  termId: string;
  shell?: string;
  launchCmd?: string;
  agentKind?: AgentKind;
};

const DRAG_MIME = "application/x-htybox-item";

/** dockview 面板：挂终端引擎 + 作为 skill/memory 拖拽落点（按本终端 agent 类型注入）。 */
function DockTerminal(props: IDockviewPanelProps<TermParams>) {
  const { termId, shell, launchCmd, agentKind = "shell" } = props.params;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    ensureEngine(termId, shell, launchCmd);
    attachEngine(termId, c);

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
      detachEngine(termId);
    };
  }, [termId, shell, launchCmd, agentKind]);
  // 内边距 + 终端底色：避免 xterm 内容贴边被面板边缘裁切
  return <div ref={ref} className="h-full w-full bg-[#1f1e1d] p-2" />;
}

/** 工具栏图标：按 profile 给对应小图标（颜色由按钮 currentColor 决定）。 */
function ProfileIcon({ id }: { id: string }) {
  const common = {
    className: "h-4 w-4",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (id === "claude")
    return (
      <svg {...common}>
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
      </svg>
    );
  if (id === "codex")
    return (
      <svg {...common}>
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" />
      </svg>
    );
  return (
    <svg {...common}>
      <polyline points="4 7 9 12 4 17" />
      <line x1="11" y1="17" x2="19" y2="17" />
    </svg>
  );
}

const components = { terminal: DockTerminal };

let seq = 0;
const newId = () => `t-${Date.now().toString(36)}-${(seq++).toString(36)}`;
let termNo = 0;
const nextTitle = () => `终端${++termNo}`;
const LAYOUT_KEY = "htybox.dock.layout.v1";

const titleFor = (p: Profile) =>
  p.agentKind === "shell" ? nextTitle() : `${nextTitle()} · ${p.label}`;
const paramsFor = (p: Profile, id: string): TermParams => ({
  termId: id,
  shell: p.shell,
  launchCmd: p.launchCmd,
  agentKind: p.agentKind,
});

export default function TerminalDock() {
  const apiRef = useRef<DockviewApi | null>(null);

  const addTerminal = useCallback((profile: Profile) => {
    const api = apiRef.current;
    if (!api) return;
    const id = newId();
    api.addPanel({
      id,
      component: "terminal",
      title: titleFor(profile),
      params: paramsFor(profile, id),
    });
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    api.onDidRemovePanel((panel) => {
      const termId = (panel.params as TermParams | undefined)?.termId;
      if (termId) disposeEngine(termId);
    });

    api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
      } catch {
        /* ignore */
      }
    });

    let restored = false;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
      try {
        api.fromJSON(JSON.parse(saved));
        restored = api.panels.length > 0;
      } catch {
        restored = false;
      }
    }
    if (restored) {
      termNo = api.panels.length;
    } else {
      const id1 = newId();
      api.addPanel({
        id: id1,
        component: "terminal",
        title: titleFor(DEFAULT_PROFILE),
        params: paramsFor(DEFAULT_PROFILE, id1),
      });
      const id2 = newId();
      api.addPanel({
        id: id2,
        component: "terminal",
        title: titleFor(DEFAULT_PROFILE),
        params: paramsFor(DEFAULT_PROFILE, id2),
        position: { referencePanel: id1, direction: "right" },
      });
    }
  }, []);

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
        <span className="ml-2 text-[10px] text-[#8c8a82]">
          点图标新建对应终端 · 拖标签分屏/重排 · 拖 skill/memory 注入(Shift 直接发送)
        </span>
      </div>
      <div className="dockview-theme-light min-h-0 flex-1">
        <DockviewReact components={components} onReady={onReady} />
      </div>
    </div>
  );
}
