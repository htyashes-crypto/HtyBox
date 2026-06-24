import { useEffect, useMemo, useState } from "react";
import { listMemories, type MemoryItem } from "../catalog";
import SearchBox from "./ui/SearchBox";
import InfoCard from "./ui/InfoCard";
import { useSettings } from "../settings";
import { listen } from "@tauri-apps/api/event";

const typeColor: Record<string, string> = {
  user: "#2fa35e",
  feedback: "#d6453e",
  project: "#c15f3c",
  reference: "#4f7cc4",
};

/** 只显示当前工作区绑定的 memory（~/.claude/projects/<slug>/memory）。卡片只显名，详情走悬浮浮层。 */
export default function MemoryPanel({ slug }: { slug: string }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [q, setQ] = useState("");
  const { hoverPreview } = useSettings();

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
            <InfoCard
              key={m.path}
              name={m.name}
              hoverEnabled={hoverPreview}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-htybox-item",
                  JSON.stringify({ kind: "memory", path: m.path }),
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              preview={
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[#191919]">
                      {m.name}
                    </span>
                    {m.memType && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase"
                        style={{ color: c, background: c + "22" }}
                      >
                        {m.memType}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[10px] break-all text-[#a8a29a]">
                    {m.path}
                  </div>
                  <div className="mt-1.5 text-[11px] leading-relaxed text-[#73726c]">
                    {m.description || "（无描述）"}
                  </div>
                </>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
