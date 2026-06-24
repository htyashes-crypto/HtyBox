import { useEffect, useMemo, useState } from "react";
import { listProjectSkills, type Skill } from "../catalog";
import SearchBox from "./ui/SearchBox";
import { listen } from "@tauri-apps/api/event";

/** 只显示当前工作区文件夹自己的 skill（<dir>/.claude/skills）。 */
export default function SkillPanel({ projectDir }: { projectDir: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    const reload = () =>
      listProjectSkills(projectDir)
        .then(setSkills)
        .catch((e) => setErr(String(e)));
    reload();
    listen("skills-changed", reload).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, [projectDir]);

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
      <div className="px-2.5 pt-1 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="搜索本工作区 skill…" />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-3">
        {err && (
          <div className="px-1 text-[11px] text-[#d6453e]">加载失败：{err}</div>
        )}
        {!err && list.length === 0 && (
          <div className="px-1 pt-6 text-center text-[11px] leading-relaxed text-[#a8a29a]">
            本工作区没有 skill
            <br />
            <span className="text-[10px]">
              （放到 <code className="text-[#73726c]">.claude/skills/</code> 下）
            </span>
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
            <div className="truncate text-[12.5px] font-semibold text-[#191919]">
              {s.name}
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
