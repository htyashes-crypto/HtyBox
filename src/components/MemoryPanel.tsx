import { useEffect, useMemo, useState } from "react";
import { listMemoryTree, type MemoryNode } from "../catalog";
import SearchBox from "./ui/SearchBox";
import InfoCard from "./ui/InfoCard";
import { useSettings } from "../settings";
import { searchMatch } from "../search";
import { listen } from "@tauri-apps/api/event";

const typeColor: Record<string, string> = {
  user: "#2fa35e",
  feedback: "#d6453e",
  project: "#c15f3c",
  reference: "#4f7cc4",
};

// 分组文件夹名美化：index_0_set_core → core；index_5_mod → mod
const prettyGroup = (n: string) => n.replace(/^index_\d+_(set_)?/, "") || n;
const countTopics = (node: MemoryNode): number =>
  node.isDir ? node.children.reduce((s, c) => s + countTopics(c), 0) : 1;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={"h-3 w-3 shrink-0 text-[#9a978f] transition-transform " + (open ? "rotate-90" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
  );
}
function FolderGlyph() {
  return <svg className="h-3.5 w-3.5 shrink-0 text-[#c79a6a]" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" /></svg>;
}

/** 只显示当前工作区记忆（~/.claude/projects/<slug>/memory）。分级文件夹树；旧平铺结构亦兼容。 */
export default function MemoryPanel({ slug }: { slug: string }) {
  const [tree, setTree] = useState<MemoryNode[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { hoverPreview } = useSettings();

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    const reload = () => {
      if (slug) listMemoryTree(slug).then(setTree).catch(() => setTree([]));
      else setTree([]);
    };
    reload();
    listen("memory-changed", reload).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, [slug]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  // 搜索过滤：文件按名/描述匹配；文件夹有命中后代才保留
  const keep = (node: MemoryNode): boolean => {
    if (!q.trim()) return true;
    if (node.isDir) return node.children.some(keep);
    return searchMatch(q, node.name, node.description);
  };
  const searching = q.trim().length > 0;
  const filtered = useMemo(() => tree.filter(keep), [tree, q]);

  const renderCard = (m: MemoryNode, pad: number) => {
    const c = typeColor[m.memType] ?? "#8c8a82";
    return (
      <div key={m.path} style={{ paddingLeft: pad }}>
        <InfoCard
          name={m.name}
          hoverEnabled={hoverPreview}
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-htybox-item", JSON.stringify({ kind: "memory", path: m.path }));
            e.dataTransfer.effectAllowed = "copy";
          }}
          preview={
            <>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[#191919]">{m.name}</span>
                {m.memType && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase" style={{ color: c, background: c + "22" }}>
                    {m.memType}
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-[10px] break-all text-[#a8a29a]">{m.path}</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-[#73726c]">{m.description || "（无描述）"}</div>
            </>
          }
        />
      </div>
    );
  };

  const renderNode = (node: MemoryNode, depth: number) => {
    if (!node.isDir) return renderCard(node, 8 + depth * 12);
    const open = searching || expanded.has(node.path);
    const kids = node.children.filter(keep);
    return (
      <div key={node.path}>
        <div
          onClick={() => toggle(node.path)}
          style={{ paddingLeft: 8 + depth * 12 }}
          className="flex cursor-pointer items-center gap-1.5 rounded py-1 pr-2 text-[12px] font-semibold text-[#3a3a37] hover:bg-[#ecebe2]"
        >
          <Chevron open={open} />
          <FolderGlyph />
          <span className="min-w-0 flex-1 truncate">{prettyGroup(node.name)}</span>
          <span className="shrink-0 text-[10px] font-normal text-[#a8a29a]">{countTopics(node)}</span>
        </div>
        {open && <div className="mt-1 space-y-1.5">{kids.map((k) => renderNode(k, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      <div className="px-2.5 pt-1 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="搜索本工作区 memory…" />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 pb-3">
        {filtered.length === 0 && (
          <div className="px-1 pt-6 text-center text-[11px] text-[#a8a29a]">
            {searching ? "无匹配 memory" : "本工作区暂无 memory"}
          </div>
        )}
        {filtered.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}
