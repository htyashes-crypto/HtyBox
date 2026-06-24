import { useEffect, useMemo, useState } from "react";
import { listMemories, type MemoryItem } from "../catalog";
import SearchBox from "./ui/SearchBox";
import { listen } from "@tauri-apps/api/event";

const typeColor: Record<string, string> = {
  user: "#2fa35e",
  feedback: "#d6453e",
  project: "#c15f3c",
  reference: "#4f7cc4",
};

/** 只显示当前工作区绑定的 memory（~/.claude/projects/<slug>/memory）。 */
export default function MemoryPanel({ slug }: { slug: string }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    const reload = () => {
      if (slug) listMemories(slug).then(setItems).catch(() => setItems([]));
      else setItems([]);
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

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return items;
    return items.filter(
      (m) =>
        m.name.toLowerCase().includes(k) ||
        m.description.toLowerCase().includes(k),
    );
  }, [items, q]);

  return (
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      <div className="px-2.5 pt-1 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="搜索本工作区 memory…" />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-3">
        {list.length === 0 && (
          <div className="px-1 pt-6 text-center text-[11px] text-[#a8a29a]">
            本工作区暂无 memory
          </div>
        )}
        {list.map((m) => {
          const c = typeColor[m.memType] ?? "#8c8a82";
          return (
            <div
              key={m.path}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-htybox-item",
                  JSON.stringify({ kind: "memory", path: m.path }),
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={m.description}
              className="cursor-grab rounded-lg border border-[#e5e2d9] bg-white px-3 py-2 transition-colors hover:border-[#d4a27f] hover:bg-[#fbfaf7] active:cursor-grabbing"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-semibold text-[#191919]">
                  {m.name}
                </span>
                {m.memType && (
                  <span
                    className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    style={{ color: c, background: c + "22" }}
                  >
                    {m.memType}
                  </span>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-[#73726c]">
                {m.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
