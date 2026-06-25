import { useEffect, useMemo, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { marked } from "marked";
import { readTextFile, writeTextFile } from "../catalog";
import { emitActiveFile } from "../dockBus";

// 跨分屏/重排保活：dockview 会卸载重挂面板，用模块级 store 按 panelId 留住未保存缓冲。
interface Buf {
  content: string;
  dirty: boolean;
  loaded: boolean;
  editable: boolean;
  reason?: string;
}
const editorStore = new Map<string, Buf>();
export function disposeEditorBuf(panelId: string): void {
  editorStore.delete(panelId);
}
/** 该编辑器面板是否有未保存改动（供"关闭已保存的编辑器"判断）。 */
export function isEditorDirty(panelId: string): boolean {
  return editorStore.get(panelId)?.dirty ?? false;
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

/** M9：简易文本编辑器面板（textarea，无语法高亮）。Ctrl+S 保存；脏标在面板内。 */
export default function DockEditor(
  props: IDockviewPanelProps<{ editorPath: string; workspaceId?: string }>,
) {
  const panelId = props.api.id;
  const path = props.params.editorPath;
  const [buf, setBuf] = useState<Buf>(
    () => editorStore.get(panelId) ?? { content: "", dirty: false, loaded: false, editable: true },
  );
  const [err, setErr] = useState<string | null>(null);
  const isMd = /\.(md|markdown)$/i.test(path);
  const isSvg = /\.svg$/i.test(path);
  const previewable = isMd || isSvg;
  const [view, setView] = useState<"edit" | "preview">(isSvg ? "preview" : "edit");
  const html = useMemo(
    () => (isMd ? (marked.parse(buf.content, { async: false }) as string) : ""),
    [isMd, buf.content],
  );
  const svgUrl = useMemo(
    () => (isSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buf.content)}` : ""),
    [isSvg, buf.content],
  );

  useEffect(() => {
    const cached = editorStore.get(panelId);
    if (cached?.loaded) {
      setBuf(cached);
      return;
    }
    let alive = true;
    readTextFile(path)
      .then((r) => {
        const b: Buf = { content: r.content, dirty: false, loaded: true, editable: r.editable, reason: r.reason };
        editorStore.set(panelId, b);
        if (alive) setBuf(b);
      })
      .catch((e) => {
        const b: Buf = { content: "", dirty: false, loaded: true, editable: false, reason: String(e) };
        editorStore.set(panelId, b);
        if (alive) setBuf(b);
      });
    return () => {
      alive = false;
    };
  }, [panelId, path]);

  // M9-N7：本面板激活时（打开文件 / 点击 Tab）通知 FilePanel 揭示并定位该文件
  useEffect(() => {
    const wsId = props.params.workspaceId;
    if (!wsId) return;
    if (props.api.isActive) emitActiveFile(wsId, path);
    const d = props.api.onDidActiveChange((e) => {
      if (e.isActive) emitActiveFile(wsId, path);
    });
    return () => d.dispose();
  }, [props.api, path, props.params.workspaceId]);

  const update = (content: string) => {
    const b: Buf = { ...buf, content, dirty: true, loaded: true };
    editorStore.set(panelId, b);
    setBuf(b);
  };
  const save = () => {
    if (!buf.editable || !buf.dirty) return;
    writeTextFile(path, buf.content)
      .then(() => {
        const b = { ...(editorStore.get(panelId) ?? buf), dirty: false };
        editorStore.set(panelId, b);
        setBuf(b);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      update(buf.content.slice(0, s) + "\t" + buf.content.slice(en));
      requestAnimationFrame(() => {
        try {
          ta.selectionStart = ta.selectionEnd = s + 1;
        } catch {
          /* ignore */
        }
      });
    }
  };

  if (buf.loaded && !buf.editable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#faf9f5] p-6 text-center">
        <div className="text-[13px] font-semibold text-[#73726c]">{basename(path)}</div>
        <div className="text-[12px] text-[#a8a29a]">{buf.reason ?? "不支持编辑此文件"}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#faf9f5]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#e5e2d9] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-[#3a3a37]">
          {buf.dirty && <span className="mr-1 text-[#d97757]">●</span>}
          {basename(path)}
        </span>
        {previewable && (
          <div className="flex shrink-0 overflow-hidden rounded-md border border-[#e5e2d9] text-[10.5px]">
            <button
              onClick={() => setView("edit")}
              className={"px-2 py-0.5 " + (view === "edit" ? "bg-[#d97757] text-white" : "text-[#73726c] hover:bg-[#f4f3ee]")}
            >
              编辑
            </button>
            <button
              onClick={() => setView("preview")}
              className={"px-2 py-0.5 " + (view === "preview" ? "bg-[#d97757] text-white" : "text-[#73726c] hover:bg-[#f4f3ee]")}
            >
              预览
            </button>
          </div>
        )}
        {err && <span className="shrink-0 truncate text-[10.5px] text-[#d6453e]">{err}</span>}
        <button
          onClick={save}
          disabled={!buf.dirty}
          title="保存（Ctrl+S）"
          className={
            "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold " +
            (buf.dirty
              ? "bg-[#d97757] text-white hover:bg-[#c15f3c]"
              : "bg-[#ecebe2] text-[#a8a29a]")
          }
        >
          保存
        </button>
      </div>
      {previewable && view === "preview" ? (
        isSvg ? (
          <div
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
            style={{
              backgroundImage:
                "linear-gradient(45deg,#eceae3 25%,transparent 25%),linear-gradient(-45deg,#eceae3 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eceae3 75%),linear-gradient(-45deg,transparent 75%,#eceae3 75%)",
              backgroundSize: "18px 18px",
              backgroundPosition: "0 0,0 9px,9px -9px,-9px 0",
            }}
          >
            <img src={svgUrl} alt={basename(path)} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <div
            className="md-preview min-h-0 flex-1 overflow-y-auto p-4 text-[13px] text-[#191919]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      ) : (
        <textarea
          value={buf.content}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none border-0 bg-[#faf9f5] p-3 font-mono text-[12.5px] leading-relaxed text-[#191919] outline-none"
        />
      )}
    </div>
  );
}
