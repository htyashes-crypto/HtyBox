import { useEffect, useMemo, useState } from "react";
import { listSkills, type Skill } from "../catalog";

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
      <div className="border-b border-[#2a2f3a] px-3 py-2 text-[11px] font-bold tracking-wider text-[#8a92a3]">
        SKILL · {skills.length}
      </div>
      <div className="p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 skill…"
          className="w-full rounded-md border border-[#2a2f3a] bg-[#0f1115] px-2 py-1.5 text-xs text-[#e6e8ee] outline-none placeholder:text-[#5c6478] focus:border-[#8b7cff]"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {err && (
          <div className="px-1 text-[11px] text-[#f43f5e]">加载失败：{err}</div>
        )}
        {!err && list.length === 0 && (
          <div className="px-1 text-[11px] text-[#5c6478]">无匹配 skill</div>
        )}
        {list.map((s) => (
          <div
            key={s.path}
            draggable
            title={`${s.invoke}\n${s.description}`}
            className="cursor-grab rounded-lg border border-[#2a2f3a] bg-[#20242c] px-3 py-2 hover:border-[#3a4150]"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-[12px] font-bold text-[#e6e8ee]">
                {s.name}
              </span>
              <span
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                style={{
                  color: sourceColor(s.source),
                  background: sourceColor(s.source) + "28",
                }}
              >
                {sourceLabel(s.source)}
              </span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[10.5px] text-[#8a92a3]">
              {s.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
