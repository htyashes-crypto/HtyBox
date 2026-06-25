import { useCallback, useEffect, useState } from "react";
import { listDir, type DirEntry } from "../catalog";

// 与 TerminalDock 落点一致的拖放 MIME；载荷 {kind:"file", path} 由 injectText 转 @路径。
const DRAG_MIME = "application/x-htybox-item";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={"h-3 w-3 shrink-0 text-[#9a978f] transition-transform " + (open ? "rotate-90" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
function FolderGlyph() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-[#c79a6a]" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}
function FileGlyph() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-[#9a978f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
    </svg>
  );
}

/** 「文件」页签：工作区文件树（懒加载，一层一层展开）；文件可拖进终端注入 @路径。 */
export default function FilePanel({ root }: { root: string }) {
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback((path: string) => {
    setLoading((s) => new Set(s).add(path));
    listDir(path)
      .then((entries) => {
        setChildren((c) => ({ ...c, [path]: entries }));
        setErrors((e) => { const n = { ...e }; delete n[path]; return n; });
      })
      .catch((err) => setErrors((e) => ({ ...e, [path]: String(err) })))
      .finally(() => setLoading((s) => { const n = new Set(s); n.delete(path); return n; }));
  }, []);

  useEffect(() => {
    setChildren({}); setExpanded(new Set()); setErrors({});
    if (root) load(root);
  }, [root, load]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else { next.add(path); if (!children[path]) load(path); }
      return next;
    });

  const refresh = () => { setChildren({}); if (root) load(root); expanded.forEach((p) => p !== root && load(p)); };

  const renderNode = (entry: DirEntry, depth: number) => {
    const isOpen = expanded.has(entry.path);
    const pad = 8 + depth * 12;
    return (
      <div key={entry.path}>
        <div
          draggable={!entry.isDir}
          onDragStart={entry.isDir ? undefined : (e) => {
            e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "file", path: entry.path }));
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => entry.isDir && toggle(entry.path)}
          title={entry.path}
          style={{ paddingLeft: pad }}
          className={"flex items-center gap-1.5 rounded py-1 pr-2 text-[12px] text-[#3a3a37] hover:bg-[#ecebe2] " + (entry.isDir ? "cursor-pointer" : "cursor-grab active:cursor-grabbing")}
        >
          {entry.isDir ? <Chevron open={isOpen} /> : <span className="w-3 shrink-0" />}
          {entry.isDir ? <FolderGlyph /> : <FileGlyph />}
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        </div>
        {entry.isDir && isOpen && (
          <>
            {errors[entry.path] && <div style={{ paddingLeft: pad + 20 }} className="py-0.5 text-[10.5px] text-[#d6453e]">读取失败</div>}
            {loading.has(entry.path) && !children[entry.path] && <div style={{ paddingLeft: pad + 20 }} className="py-0.5 text-[10.5px] text-[#a8a29a]">加载中…</div>}
            {(children[entry.path] ?? []).map((c) => renderNode(c, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const rootEntries = children[root] ?? [];
  return (
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-1.5">
        <span className="min-w-0 truncate text-[10.5px] text-[#a8a29a]" title={root}>{root || "未打开工作区"}</span>
        <button onClick={refresh} title="刷新" className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-[#73726c] hover:bg-[#ecebe2] hover:text-[#191919]">⟳</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {errors[root] && <div className="px-2 pt-4 text-center text-[11px] text-[#d6453e]">读取失败：{errors[root]}</div>}
        {!errors[root] && loading.has(root) && rootEntries.length === 0 && <div className="px-2 pt-6 text-center text-[11px] text-[#a8a29a]">加载中…</div>}
        {!errors[root] && !loading.has(root) && rootEntries.length === 0 && <div className="px-2 pt-6 text-center text-[11px] text-[#a8a29a]">空目录</div>}
        {rootEntries.map((e) => renderNode(e, 0))}
      </div>
    </div>
  );
}
