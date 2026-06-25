import { useEffect, useState } from "react";
import {
  listClaudeSessions,
  listCodexSessions,
  deleteClaudeSession,
  deleteCodexSession,
  type SessionRef,
} from "../catalog";
import { openTerminalCmd } from "../dockBus";
import { searchMatch } from "../search";
import SearchBox from "./ui/SearchBox";
import claudeIcon from "../assets/claude.svg";
import codexIcon from "../assets/codex.svg";

const AGENTS = [
  { k: "claude" as const, label: "Claude Code", icon: claudeIcon },
  { k: "codex" as const, label: "Codex", icon: codexIcon },
];

/** 「Session」页签：claude/codex 会话列表，点击复原到终端、✕ 删除（移入回收站）。 */
export default function SessionPanel({ root, workspaceId }: { root: string; workspaceId: string }) {
  const [agentKind, setAgentKind] = useState<"claude" | "codex">("claude");
  const [list, setList] = useState<SessionRef[] | null>(null);
  const [q, setQ] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const cur = AGENTS.find((a) => a.k === agentKind) ?? AGENTS[0];

  const load = (kind: "claude" | "codex") => {
    setList(null);
    if (!root) {
      setList([]);
      return;
    }
    (kind === "claude" ? listClaudeSessions(root) : listCodexSessions(root))
      .then(setList)
      .catch(() => setList([]));
  };
  useEffect(() => {
    load(agentKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, agentKind]);

  const resume = (s: SessionRef) => {
    const command = agentKind === "claude" ? `claude --resume ${s.id}` : `codex resume ${s.id}`;
    openTerminalCmd(workspaceId, { command, agentKind, title: `↺ ${s.label.slice(0, 18)}` });
  };
  const del = async (s: SessionRef, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (agentKind === "claude") await deleteClaudeSession(s.id);
      else await deleteCodexSession(s.path);
      // 乐观移除：直接从列表剔除该项，避免整列重载导致滚动条跳回顶部
      setList((prev) => (prev ? prev.filter((x) => x.id !== s.id) : prev));
    } catch {
      /* ignore */
    }
  };
  const filtered = (list ?? []).filter((s) => searchMatch(q, s.label, s.id));

  return (
    <div className="flex h-full flex-col bg-[#f4f3ee]">
      <div className="flex items-center gap-1 px-2.5 pt-2">
        <div className="relative min-w-0 flex-1">
          <button
            onClick={() => setAgentOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg bg-[#ecebe2] px-3 py-1.5 text-xs font-semibold text-[#191919] hover:bg-[#e3e1d6]"
          >
            <img src={cur.icon} alt="" className="h-4 w-4" draggable={false} />
            <span className="min-w-0 flex-1 truncate text-left">{cur.label}</span>
            <svg className="h-3 w-3 shrink-0 text-[#a8a29a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {agentOpen && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setAgentOpen(false)} />
              <div className="absolute left-0 top-full z-[61] mt-1 w-full overflow-hidden rounded-lg border border-[#e5e2d9] bg-white py-1 shadow-xl">
                {AGENTS.map((a) => (
                  <button
                    key={a.k}
                    onClick={() => {
                      setAgentKind(a.k);
                      setAgentOpen(false);
                    }}
                    className={
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] " +
                      (a.k === agentKind ? "bg-[#d97757]/10 text-[#191919]" : "text-[#3a3a37] hover:bg-[#f4f3ee]")
                    }
                  >
                    <img src={a.icon} alt="" className="h-4 w-4" draggable={false} />
                    <span className="flex-1">{a.label}</span>
                    {a.k === agentKind && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-[#d97757]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => load(agentKind)}
          title="刷新"
          className="shrink-0 rounded-md px-2 py-1.5 text-[12px] text-[#73726c] hover:bg-white hover:text-[#191919]"
        >
          ⟳
        </button>
      </div>
      <div className="px-2.5 pt-2 pb-1.5">
        <SearchBox value={q} onChange={setQ} placeholder={`搜索 ${agentKind} 会话…`} />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 pb-3">
        {list === null && <div className="pt-6 text-center text-[11px] text-[#a8a29a]">加载中…</div>}
        {list !== null && filtered.length === 0 && (
          <div className="pt-6 text-center text-[11px] text-[#a8a29a]">无 {agentKind} 会话</div>
        )}
        {filtered.map((s) => (
          <div
            key={s.id}
            className="group flex items-start gap-1.5 rounded-lg border border-[#e5e2d9] bg-white px-2.5 py-1.5 transition-colors hover:border-[#d4a27f] hover:bg-[#fbfaf7]"
          >
            <button onClick={() => resume(s)} title="复原此会话到终端" className="min-w-0 flex-1 cursor-pointer text-left">
              <div className="truncate text-[12px] text-[#191919]">{s.label}</div>
              <div className="mt-0.5 text-[10px] text-[#a8a29a]">{new Date(s.ts).toLocaleString()}</div>
            </button>
            <button
              onClick={(e) => del(s, e)}
              title="删除会话（移入回收站）"
              className="shrink-0 px-0.5 text-[#cfcbc2] opacity-0 transition-opacity hover:text-[#d6453e] group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
