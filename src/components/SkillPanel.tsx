import { useEffect, useMemo, useState } from "react";
import { listSkills, type Skill } from "../catalog";
import SearchBox from "./ui/SearchBox";

const sourceLabel = (s: string) => (s.startsWith("plugin:") ? "plugin" : s);
const sourceColor = (s: string) =>
  s.startsWith("plugin:") ? "#4f7cc4" : s === "user" ? "#2fa35e" : "#c15f3c";

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
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#73726c]">
          Skill
        </span>
        <span className="rounded-full bg-[#ecebe2] px-1.5 py-0.5 text-[10px] font-semibold text-[#73726c]">
          {skills.length}
        </span>
      </div>
      <div className="px-2.5 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="搜索 skill…" />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-3">
        {err && (
          <div className="px-1 text-[11px] text-[#d6453e]">加载失败：{err}</div>
        )}
        {!err && list.length === 0 && (
          <div className="px-1 pt-6 text-center text-[11px] text-[#a8a29a]">
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
                JSON.stringify({ kind: "skill", invoke: s.invoke, path: s.path }),
              );
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${s.invoke}\n${s.description}`}
            className="cursor-grab rounded-lg border border-[#e5e2d9] bg-white px-3 py-2 transition-colors hover:border-[#d4a27f] hover:bg-[#fbfaf7] active:cursor-grabbing"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-[#191919]">
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
            <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-[#73726c]">
              {s.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
