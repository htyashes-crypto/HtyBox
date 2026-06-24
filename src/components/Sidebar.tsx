import { useState, type ReactElement } from "react";
import SkillPanel from "./SkillPanel";
import MemoryPanel from "./MemoryPanel";

type Tab = "skill" | "memory";

function SkillIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m13 2-9 12h7l-1 8 9-12h-7z" />
    </svg>
  );
}
function MemoryIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const TABS: { id: Tab; label: string; icon: () => ReactElement }[] = [
  { id: "skill", label: "Skill", icon: SkillIcon },
  { id: "memory", label: "Memory", icon: MemoryIcon },
];

export default function Sidebar() {
  const [tab, setTab] = useState<Tab>("skill");
  return (
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      {/* 分段切换条（FanBox 风格） */}
      <div className="p-2">
        <div className="flex gap-1 rounded-xl bg-[#ecebe2] p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all " +
                  (active
                    ? "bg-white text-[#191919] shadow-sm"
                    : "text-[#73726c] hover:text-[#191919]")
                }
              >
                <Icon />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* 活动面板 */}
      <div className="min-h-0 flex-1">
        {tab === "skill" ? <SkillPanel /> : <MemoryPanel />}
      </div>
    </div>
  );
}
