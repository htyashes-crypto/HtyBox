import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TAG_COLORS, tagDot, type TagColorKey } from "../tagColors";
import {
  useSessionTags,
  useVocab,
  sessionKey,
  createTag,
  addTag,
  removeTag,
  toggleTag,
} from "../sessionTags";

// 标签编辑器 popover：给某会话增删 tag / 新建 tag。SessionPanel 右键 与 终端 Tab 右键【共用】。
// 锚定右键坐标、portal 到 body、边界回弹、外部点击 / Esc 关闭（与 ui/ContextMenu 同款交互）。
// 数据走 sessionTags 全局 store（useSessionTags/useVocab 自动重渲染），故两处入口、两处显示天然联动。
export default function TagEditor({
  x,
  y,
  agentKind,
  sessionId,
  sessionName,
  onClose,
}: {
  x: number;
  y: number;
  agentKind: "claude" | "codex";
  sessionId: string;
  sessionName?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [draft, setDraft] = useState(""); // 新建输入
  const [newColor, setNewColor] = useState<TagColorKey>("blue"); // 新建色（默认蓝，可点改）
  const key = sessionKey(agentKind, sessionId);
  const tags = useSessionTags(agentKind, sessionId); // 该会话已有 tag（join 词表）
  const vocab = useVocab(); // 全部 tag 词表
  const has = (id: string) => tags.some((t) => t.id === id);

  // 定位边界回弹（参考 ContextMenu.tsx:29-36）：弹出后量自身尺寸，超出视口则回拉。
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: x + r.width > window.innerWidth ? Math.max(4, window.innerWidth - r.width - 4) : x,
      top: y + r.height > window.innerHeight ? Math.max(4, window.innerHeight - r.height - 4) : y,
    });
  }, [x, y]);

  // 外部点击 / Esc 关闭（capture 阶段，避免被内部 stopPropagation 漏掉）。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 新建 tag（回车）：去重创建（同名复用）+ 打到当前会话 + 清空输入。
  const submitNew = () => {
    const n = draft.trim();
    if (!n) return;
    const tag = createTag(n, newColor);
    addTag(key, tag.id);
    setDraft("");
  };

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 120 }}
      className="w-[300px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] shadow-xl"
    >
      {/* 头部：标题 + 会话名 + ✕ */}
      <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3.5 py-2.5">
        <span className="text-[14px] font-bold text-[var(--text)]">标签</span>
        {sessionName && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-3)]">· {sessionName}</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto shrink-0 text-[13px] leading-none text-[var(--text-3)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>
      {/* ① 该会话标签（点 × 移除） */}
      {tags.length > 0 && (
        <div className="border-b border-[var(--border-soft)] px-3.5 py-2.5">
          <div className="mb-1.5 text-[10px] font-bold tracking-wide text-[var(--text-2)]">该会话标签</div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-semibold"
                style={{ color: tagDot(t.color), borderColor: tagDot(t.color) + "66", backgroundColor: tagDot(t.color) + "22" }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tagDot(t.color) }} />
                {t.name}
                <button onClick={() => removeTag(key, t.id)} title="移除" className="ml-0.5 leading-none hover:opacity-60">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ② 全部标签（点选增删；已选高亮 + ✓） */}
      <div className="border-b border-[var(--border-soft)] px-3.5 py-2.5">
        <div className="mb-1.5 text-[10px] font-bold tracking-wide text-[var(--text-2)]">全部标签 · 点选增删</div>
        {vocab.length === 0 ? (
          <div className="text-[11px] text-[var(--text-3)]">还没有标签，下面新建一个 ↓</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {vocab.map((t) => {
              const on = has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTag(key, t.id)}
                  className={
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] transition-colors " +
                    (on
                      ? "border-[var(--accent-border)] bg-[var(--accent)]/10 text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--elevated)] text-[var(--text-2)] hover:bg-[var(--surface)]")
                  }
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tagDot(t.color) }} />
                  {t.name}
                  {on && (
                    <svg className="h-3 w-3 text-[var(--accent-text)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ③ 新建标签 + 颜色点 */}
      <div className="px-3.5 py-2.5">
        <div className="mb-1.5 text-[10px] font-bold tracking-wide text-[var(--text-2)]">新建标签</div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submitNew();
            else if (e.key === "Escape") onClose();
          }}
          placeholder="为新标签起名，回车创建…"
          className="w-full rounded-md border border-[var(--accent-border)] bg-[var(--elevated)] px-2.5 py-1.5 text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-wide text-[var(--text-2)]">颜色</span>
          {TAG_COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => setNewColor(c.key)}
              title={c.label}
              className="relative h-4 w-4 rounded-full"
              style={{ backgroundColor: c.dot, boxShadow: newColor === c.key ? "0 0 0 2px var(--elevated), 0 0 0 3.5px var(--accent)" : "none" }}
            >
              {newColor === c.key && (
                <svg className="absolute inset-0 m-auto h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
          <span className="ml-auto text-[9.5px] text-[var(--text-3)]">回车即打到当前会话</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
