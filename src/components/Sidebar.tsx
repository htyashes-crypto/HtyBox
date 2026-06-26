import { useState, type ReactElement } from "react";
import SkillPanel from "./SkillPanel";
import MemoryPanel from "./MemoryPanel";
import FilePanel from "./FilePanel";
import SessionPanel from "./SessionPanel";

type Tab = "skill" | "memory" | "file" | "session";

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

function FileTreeIcon() {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function SessionIcon() {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const TABS: { id: Tab; label: string; icon: () => ReactElement }[] = [
  { id: "file", label: "File", icon: FileTreeIcon },
  { id: "skill", label: "Skill", icon: SkillIcon },
  { id: "memory", label: "Memory", icon: MemoryIcon },
  { id: "session", label: "Session", icon: SessionIcon },
];

export default function Sidebar({
  workspacePath,
  workspaceSlug,
}: {
  workspacePath: string;
  workspaceSlug: string;
}) {
  const [tab, setTab] = useState<Tab>("skill");
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      {/* 分段切换条（FanBox 风格） */}
      <div className="p-2">
        <div className="flex gap-1 rounded-xl bg-[var(--surface-hover)] p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-xs font-semibold transition-all " +
                  (active
                    ? "bg-[var(--elevated)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-2)] hover:text-[var(--text)]")
                }
              >
                <Icon />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 活动面板（作用域 = 当前工作区文件夹） */}
      <div className="min-h-0 flex-1">
        {tab === "file" ? (
          <FilePanel root={workspacePath} workspaceId={workspaceSlug} />
        ) : tab === "skill" ? (
          <SkillPanel projectDir={workspacePath} />
        ) : tab === "memory" ? (
          <MemoryPanel slug={workspaceSlug} />
        ) : (
          <SessionPanel root={workspacePath} workspaceId={workspaceSlug} />
        )}
      </div>
    </div>
  );
}
