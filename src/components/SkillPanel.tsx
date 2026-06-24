import { useEffect, useMemo, useState } from "react";
import { listProjectSkills, type Skill } from "../catalog";
import SearchBox from "./ui/SearchBox";
import InfoCard from "./ui/InfoCard";
import { useSettings } from "../settings";
import { listen } from "@tauri-apps/api/event";

/** 只显示当前工作区文件夹自己的 skill（<dir>/.claude/skills）。卡片只显名，详情走悬浮浮层。 */
export default function SkillPanel({ projectDir }: { projectDir: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { hoverPreview } = useSettings();

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
          <InfoCard
            key={s.path}
            name={s.name}
            hoverEnabled={hoverPreview}
            onDragStart={(e) => {
              e.dataTransfer.setData(
                "application/x-htybox-item",
                JSON.stringify({ kind: "skill", invoke: s.invoke, path: s.path }),
              );
              e.dataTransfer.effectAllowed = "copy";
            }}
            preview={
              <>
                <div className="text-[13px] font-semibold text-[#191919]">
                  {s.name}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-[#c15f3c]">
                  {s.invoke}
                </div>
                <div className="mt-1.5 text-[11px] leading-relaxed text-[#73726c]">
                  {s.description || "（无描述）"}
                </div>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
