import { useEffect, useMemo, useState } from "react";
import {
  listMemories,
  listProjects,
  type MemoryItem,
  type ProjectRef,
} from "../catalog";

const typeColor: Record<string, string> = {
  user: "#22c55e",
  feedback: "#f43f5e",
  project: "#f59e0b",
  reference: "#60a5fa",
};

export default function MemoryPanel() {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [slug, setSlug] = useState("");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length) setSlug(ps[0].slug);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (slug) listMemories(slug).then(setItems).catch(() => setItems([]));
    else setItems([]);
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
    <div className="flex h-full flex-col bg-[#161a21]">
      <div className="border-b border-[#2a2f3a] px-3 py-2">
        <span className="text-[11px] font-bold tracking-wider text-[#8a92a3]">
          MEMORY · {items.length}
        </span>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-[#2a2f3a] bg-[#0f1115] px-1.5 py-1 text-[11px] text-[#b8bdc8] outline-none"
        >
          {projects.length === 0 && <option value="">（无 memory 项目）</option>}
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.slug} ({p.memoryCount})
            </option>
          ))}
        </select>
      </div>
      <div className="p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 memory…"
          className="w-full rounded-md border border-[#2a2f3a] bg-[#0f1115] px-2 py-1.5 text-xs text-[#e6e8ee] outline-none placeholder:text-[#5c6478] focus:border-[#8b7cff]"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {list.length === 0 && (
          <div className="px-1 text-[11px] text-[#5c6478]">无 memory</div>
        )}
        {list.map((m) => {
          const c = typeColor[m.memType] ?? "#8a92a3";
          return (
            <div
              key={m.path}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-htybox-item",
                  JSON.stringify({ kind: "memory", text: "@" + m.path }),
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={m.description}
              className="cursor-grab rounded-lg border border-[#2a2f3a] bg-[#20242c] px-3 py-2 hover:border-[#3a4150]"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-bold text-[#e6e8ee]">
                  {m.name}
                </span>
                {m.memType && (
                  <span
                    className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                    style={{ color: c, background: c + "28" }}
                  >
                    {m.memType}
                  </span>
                )}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[10.5px] text-[#8a92a3]">
                {m.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
