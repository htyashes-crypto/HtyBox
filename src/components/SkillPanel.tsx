import { useEffect, useMemo, useState } from "react";
import { listSkills, type Skill } from "../catalog";
import SearchBox from "./ui/SearchBox";

const sourceLabel = (s: string) => (s.startsWith("plugin:") ? "plugin" : s);
const sourceColor = (s: string) =>
  s.startsWith("plugin:") ? "#60a5fa" : s === "user" ? "#22c55e" : "#f59e0b";

export default function SkillPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listSkills()
      .then(setSkills)
      .catch((e) => setErr(String(e)));
  }, []);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(k) ||
        s.description.toLowerCase().includes(k),
    );
  }, [skills, q]);

  return (
    <div className="flex h-full flex-col bg-[#161a21]">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8a92a3]">
          Skill
        </span>
        <span className="rounded-full bg-[#20242c] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a92a3]">
          {skills.length}
        </span>
      </div>
      <div className="px-2.5 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="搜索 skill…" />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-3">
        {err && (
          <div className="px-1 text-[11px] text-[#f43f5e]">加载失败：{err}</div>
        )}
        {!err && list.length === 0 && (
          <div className="px-1 pt-6 text-center text-[11px] text-[#5c6478]">
            无匹配 skill
          </div>
        )}
        {list.map((s) => (
          <div
            key={s.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                "application/x-htybox-item",
                JSON.stringify({ kind: "skill", text: s.invoke }),
              );
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${s.invoke}\n${s.description}`}
            className="cursor-grab rounded-lg border border-[#262b35] bg-[#1b1f27] px-3 py-2 transition-colors hover:border-[#3a4150] hover:bg-[#20242c] active:cursor-grabbing"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-[#e6e8ee]">
                {s.name}
              </span>
              <span
                className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{
                  color: sourceColor(s.source),
                  background: sourceColor(s.source) + "22",
                }}
              >
                {sourceLabel(s.source)}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-[#8a92a3]">
              {s.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
