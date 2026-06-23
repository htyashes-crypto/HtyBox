import { useCallback, useEffect, useRef } from "react";
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
} from "./terminalEngine";

type TermParams = { termId: string; shell?: string };

/** dockview 面板：把对应 termId 的终端引擎挂进来 / 卸载时移出（不销毁）。 */
function DockTerminal(props: IDockviewPanelProps<TermParams>) {
  const { termId, shell } = props.params;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    ensureEngine(termId, shell);
    attachEngine(termId, c);
    return () => detachEngine(termId);
  }, [termId, shell]);
  return <div ref={ref} className="h-full w-full" />;
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

    // 面板关闭 → 结束对应 PTY
    api.onDidRemovePanel((panel) => {
      const termId = (panel.params as { termId?: string } | undefined)?.termId;
      if (termId) disposeEngine(termId);
    });

    // 布局变化 → 持久化（结构层；进程不持久，重启后重开）
    api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
      } catch {
        /* ignore */
      }
    });

    // 恢复上次布局，否则建默认两个并排终端
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
      termNo = api.panels.length; // 新建从已有数量之后继续编号
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
    <div className="flex h-full w-full flex-col bg-[#0b0d11]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2a2f3a] px-3 py-1.5">
        <button
          onClick={addTerminal}
          className="rounded-md border border-[#2a2f3a] px-2 py-1 text-xs text-[#b8bdc8] hover:bg-[#20242c]"
        >
          ＋ 新建终端
        </button>
        <span className="text-[10px] text-[#5c6478]">
          拖标签到边缘可分屏 · 拖动可重排 · 关闭标签结束该终端
        </span>
      </div>
      <div className="dockview-theme-dark min-h-0 flex-1">
        <DockviewReact components={components} onReady={onReady} />
      </div>
    </div>
  );
}
