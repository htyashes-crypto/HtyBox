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
import ContextMenu, { MENU_SEP } from "./ui/ContextMenu";
import { getSessionTitle, setSessionTitle, onSessionTitlesChange } from "../sessionTitles";
import claudeIcon from "../assets/claude.svg";
import codexIcon from "../assets/codex.svg";

const AGENTS = [
  { k: "claude" as const, label: "Claude Code", icon: claudeIcon },
  { k: "codex" as const, label: "Codex", icon: codexIcon },
];

// 会话收藏：按工作区 root 分组，存 "agentKind:id"（持久化，跨重启），收藏的置顶成区显示。
const SESS_FAV_KEY = "htybox.favSessions.v1";
function loadSessFavs(root: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(SESS_FAV_KEY) || "{}");
    return Array.isArray(all[root]) ? all[root] : [];
  } catch {
    return [];
  }
}
function saveSessFavs(root: string, keys: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(SESS_FAV_KEY) || "{}");
    all[root] = keys;
    localStorage.setItem(SESS_FAV_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// 会话自定义名（用户手动重命名覆盖显示）统一收口到 ../sessionTitles，与终端 Tab【共享同一份】：
// 在 Session 列表重命名 ↔ 在终端 Tab 重命名 改的是同一会话名，两处显示一致（见 sessionTitles.ts）。

/** 「Session」页签：claude/codex 会话列表，点击复原到终端、✕ 删除（移入回收站）。 */
export default function SessionPanel({ root, workspaceId }: { root: string; workspaceId: string }) {
  const [agentKind, setAgentKind] = useState<"claude" | "codex">("claude");
  const [list, setList] = useState<SessionRef[] | null>(null);
  const [q, setQ] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>(() => loadSessFavs(root));
  useEffect(() => setFavs(loadSessFavs(root)), [root]); // 切工作区重载收藏
  const [menu, setMenu] = useState<{ x: number; y: number; s: SessionRef } | null>(null);
  const [, setTitleVer] = useState(0); // 会话自定义名变化(本面板或终端 Tab 改同一会话)→ 自增触发重渲染
  useEffect(() => onSessionTitlesChange(() => setTitleVer((v) => v + 1)), []);
  const [editing, setEditing] = useState<string | null>(null); // 正在重命名的会话键 "agentKind:id"
  const [draft, setDraft] = useState("");
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
    const name = getSessionTitle(agentKind, s.id) || s.label;
    openTerminalCmd(workspaceId, { command, agentKind, title: `↺ ${name.slice(0, 18)}`, sessionId: s.id });
  };
  const del = async (s: SessionRef) => {
    try {
      if (agentKind === "claude") await deleteClaudeSession(s.id);
      else await deleteCodexSession(s.path);
      // 乐观移除：直接从列表剔除该项，避免整列重载导致滚动条跳回顶部
      setList((prev) => (prev ? prev.filter((x) => x.id !== s.id) : prev));
    } catch {
      /* ignore */
    }
  };
  const favKey = (s: SessionRef) => `${agentKind}:${s.id}`;
  const displayLabel = (s: SessionRef) => getSessionTitle(agentKind, s.id) || s.label;
  const filtered = (list ?? []).filter((s) => searchMatch(q, displayLabel(s), s.id));
  const isFav = (s: SessionRef) => favs.includes(favKey(s));
  const toggleFav = (s: SessionRef) => {
    const k = favKey(s);
    const next = favs.includes(k) ? favs.filter((x) => x !== k) : [...favs, k];
    setFavs(next);
    saveSessFavs(root, next);
  };
  const startRename = (s: SessionRef) => {
    setEditing(favKey(s));
    setDraft(displayLabel(s));
  };
  const commitRename = (s: SessionRef) => {
    const t = draft.trim();
    // 空或与原标题相同 → 传空串清除自定义、恢复原名；否则写入（与终端 Tab 共享、并实时刷新两处）
    setSessionTitle(agentKind, s.id, t && t !== s.label ? t : "");
    setEditing(null);
  };
  const favList = filtered.filter(isFav);
  const restList = filtered.filter((s) => !isFav(s));
  const card = (s: SessionRef) => {
    const editingThis = editing === favKey(s);
    return (
      <div
        key={s.id}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, s });
        }}
        title="右键更多操作（复原 / 重命名 / 收藏 / 删除）"
        className="group flex items-start gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-2.5 py-1.5 transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--surface-soft)]"
      >
        {editingThis ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename(s);
              else if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => commitRename(s)}
            className="my-0.5 min-w-0 flex-1 rounded border border-[var(--accent-border)] bg-[var(--surface)] px-1.5 py-0.5 text-[12px] text-[var(--text)] outline-none"
          />
        ) : (
          <button onClick={() => resume(s)} title="复原此会话到终端" className="min-w-0 flex-1 cursor-pointer text-left">
            <div className="truncate text-[12px] text-[var(--text)]">{displayLabel(s)}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{new Date(s.ts).toLocaleString()}</div>
          </button>
        )}
        {!editingThis && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFav(s);
            }}
            title={isFav(s) ? "取消收藏" : "收藏"}
            className={
              "shrink-0 px-0.5 text-[13px] leading-none transition-opacity " +
              (isFav(s)
                ? "text-[var(--accent)]"
                : "text-[var(--text-faint)] opacity-0 hover:text-[var(--accent)] group-hover:opacity-100")
            }
          >
            {isFav(s) ? "♥" : "♡"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="flex items-center gap-1 px-2.5 pt-2">
        <div className="relative min-w-0 flex-1">
          <button
            onClick={() => setAgentOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border-soft)]"
          >
            <img src={cur.icon} alt="" className={(cur.k === "codex" ? "codex-glyph " : "") + "h-4 w-4"} draggable={false} />
            <span className="min-w-0 flex-1 truncate text-left">{cur.label}</span>
            <svg className="h-3 w-3 shrink-0 text-[var(--text-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {agentOpen && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setAgentOpen(false)} />
              <div className="absolute left-0 top-full z-[61] mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-xl">
                {AGENTS.map((a) => (
                  <button
                    key={a.k}
                    onClick={() => {
                      setAgentKind(a.k);
                      setAgentOpen(false);
                    }}
                    className={
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] " +
                      (a.k === agentKind ? "bg-[var(--accent)]/10 text-[var(--text)]" : "text-[var(--text-deep)] hover:bg-[var(--surface)]")
                    }
                  >
                    <img src={a.icon} alt="" className={(a.k === "codex" ? "codex-glyph " : "") + "h-4 w-4"} draggable={false} />
                    <span className="flex-1">{a.label}</span>
                    {a.k === agentKind && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
          className="shrink-0 rounded-md px-2 py-1.5 text-[12px] text-[var(--text-2)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
        >
          ⟳
        </button>
      </div>
      <div className="px-2.5 pt-2 pb-1.5">
        <SearchBox value={q} onChange={setQ} placeholder={`搜索 ${agentKind} 会话…`} />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 pb-3">
        {list === null && <div className="pt-6 text-center text-[11px] text-[var(--text-3)]">加载中…</div>}
        {list !== null && filtered.length === 0 && (
          <div className="pt-6 text-center text-[11px] text-[var(--text-3)]">无 {agentKind} 会话</div>
        )}
        {favList.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-[var(--text-3)] uppercase">
              <svg className="h-3 w-3 text-[var(--accent)]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              收藏 · {favList.length}
            </div>
            <div className="space-y-1">{favList.map(card)}</div>
            <div className="my-2.5 border-t border-[var(--border)]" />
          </div>
        )}
        <div className="space-y-1">{restList.map(card)}</div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { id: "resume", label: "复原到终端" },
            { id: "rename", label: "重命名" },
            { id: "fav", label: isFav(menu.s) ? "取消收藏" : "收藏" },
            MENU_SEP,
            { id: "delete", label: "删除会话（移入回收站）", danger: true },
          ]}
          onAction={(id) => {
            if (id === "resume") resume(menu.s);
            else if (id === "rename") startRename(menu.s);
            else if (id === "fav") toggleFav(menu.s);
            else if (id === "delete") void del(menu.s);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
