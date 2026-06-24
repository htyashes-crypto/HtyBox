import { useEffect, useMemo, useState } from "react";
import { listProjectSkills, type Skill } from "../catalog";
import SearchBox from "./ui/SearchBox";
import InfoCard from "./ui/InfoCard";
import { useSettings } from "../settings";
import { listen } from "@tauri-apps/api/event";

// 收藏的 skill 按工作区(projectDir)持久化：{ [projectDir]: skill 名数组 }
const FAV_KEY = "htybox.favSkills.v1";
function loadFavs(projectDir: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(FAV_KEY) || "{}");
    return Array.isArray(all[projectDir]) ? all[projectDir] : [];
  } catch {
    return [];
  }
}
function saveFavs(projectDir: string, names: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(FAV_KEY) || "{}");
    all[projectDir] = names;
    localStorage.setItem(FAV_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** 只显示当前工作区文件夹自己的 skill（<dir>/.claude/skills）；卡片只显名+爱心，详情走悬浮浮层。 */
export default function SkillPanel({ projectDir }: { projectDir: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>(() => loadFavs(projectDir));
  const { hoverPreview } = useSettings();

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    const reload = () =>
      listProjectSkills(projectDir)
        .then(setSkills)
        .catch((e) => setErr(String(e)));
    reload();
    setFavs(loadFavs(projectDir)); // 切工作区时切换收藏集
    listen("skills-changed", reload).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, [projectDir]);

  const toggleFav = (name: string) =>
    setFavs((prev) => {
      const next = prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name];
      saveFavs(projectDir, next);
      return next;
    });

  const favSet = useMemo(() => new Set(favs), [favs]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(k) ||
        s.description.toLowerCase().includes(k),
    );
  }, [skills, q]);

  const favList = list.filter((s) => favSet.has(s.name));
  const restList = list.filter((s) => !favSet.has(s.name));

  const renderCard = (s: Skill) => (
    <InfoCard
      key={s.path}
      name={s.name}
      hoverEnabled={hoverPreview}
      favorite={{ active: favSet.has(s.name), onToggle: () => toggleFav(s.name) }}
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
  );

  return (
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      <div className="px-2.5 pt-1 pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="搜索本工作区 skill…" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
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

        {/* 收藏区：为空则隐藏 */}
        {favList.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-[#a8a29a] uppercase">
              <svg
                className="h-3 w-3 text-[#d97757]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              收藏
            </div>
            <div className="space-y-1.5">{favList.map(renderCard)}</div>
            <div className="my-2.5 border-t border-[#e5e2d9]" />
          </div>
        )}

        {/* 全部 skill（已收藏的上移到收藏区，不重复显示） */}
        <div className="space-y-1.5">{restList.map(renderCard)}</div>
      </div>
    </div>
  );
}
