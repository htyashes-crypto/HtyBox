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

type TermParams = { termId: string; shell?: string };

const DRAG_MIME = "application/x-htybox-item";

/** dockview 面板：挂终端引擎 + 作为 skill/memory 拖拽落点（M4 注入）。 */
function DockTerminal(props: IDockviewPanelProps<TermParams>) {
  const { termId, shell } = props.params;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    ensureEngine(termId, shell);
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
        const item = JSON.parse(raw) as { text: string };
        // 注入：写入该终端 PTY；按住 Shift 落下则自动回车发送
        const data = item.text + (e.shiftKey ? "\r" : "");
        invoke("write_terminal", { id: termId, data }).catch(() => {});
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
  }, [termId, shell]);
  // 内边距 + 终端底色：避免 xterm 内容贴边导致首列被面板边缘裁切
  return <div ref={ref} className="h-full w-full bg-[#1f1e1d] p-2" />;
}

const components = { terminal: DockTerminal };

let seq = 0;
const newId = () => `t-${Date.now().toString(36)}-${(seq++).toString(36)}`;
let termNo = 0;
const nextTitle = () => `终端${++termNo}`; // 单调递增，避免重名
const LAYOUT_KEY = "htybox.dock.layout.v1";

export default function TerminalDock() {
  const apiRef = useRef<DockviewApi | null>(null);

  const addTerminal = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const id = newId();
    api.addPanel({
      id,
      component: "terminal",
      title: nextTitle(),
      params: { termId: id },
    });
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    api.onDidRemovePanel((panel) => {
      const termId = (panel.params as { termId?: string } | undefined)?.termId;
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
        title: nextTitle(),
        params: { termId: id1 },
      });
      const id2 = newId();
      api.addPanel({
        id: id2,
        component: "terminal",
        title: nextTitle(),
        params: { termId: id2 },
        position: { referencePanel: id1, direction: "right" },
      });
    }
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-[#1f1e1d]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#e5e2d9] bg-[#f4f3ee] px-3 py-1.5">
        <button
          onClick={addTerminal}
          className="rounded-md border border-[#e5e2d9] bg-white px-2 py-1 text-xs text-[#3d3d3a] transition-colors hover:border-[#d4a27f] hover:text-[#191919]"
        >
          ＋ 新建终端
        </button>
        <span className="text-[10px] text-[#8c8a82]">
          拖标签到边缘可分屏 · 拖动可重排 · 拖 skill/memory 到终端注入(Shift=直接发送)
        </span>
      </div>
      <div className="dockview-theme-light min-h-0 flex-1">
        <DockviewReact components={components} onReady={onReady} />
      </div>
    </div>
  );
}
