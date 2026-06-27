import { useEffect, useMemo, useState } from "react";
import { listAllFiles, type FileRef } from "../catalog";
import { openEditor } from "../dockBus";
import { loadIgnore } from "../fileIgnore";
import { searchScore } from "../search";
import { useSettings } from "../settings";

/** M9：双击 Shift 唤出的全局文件搜索（统一搜索规则，排除忽略名单，点击/回车打开）。 */
export default function QuickOpen({
  root,
  workspaceId,
  onClose,
}: {
  root: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const [all, setAll] = useState<FileRef[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const s = useSettings();

  useEffect(() => {
    const ig = loadIgnore(root); // 排除被忽略的文件夹/扩展名
    listAllFiles(root, ig.folders, ig.exts, s.maxFiles)
      .then((r) => {
        setAll(r.files);
        setTotal(r.total);
      })
      .catch(() => {
        setAll([]);
        setTotal(0);
      });
  }, [root, s.maxFiles]);

  const results = useMemo(() => {
    return all
      .map((f) => ({ f, sc: searchScore(q, f.name, f.rel) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 50)
      .map((x) => x.f);
  }, [all, q]);

  useEffect(() => setSel(0), [q]);

  const open = (f: FileRef) => {
    openEditor(workspaceId, f.path);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center bg-black/20 pt-[12vh]" onClick={onClose}>
      <div
        className="w-[600px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (results[sel]) open(results[sel]);
            }
          }}
          placeholder="搜索文件（按文件名）…"
          className="w-full border-b border-[var(--border)] px-4 py-2.5 text-[14px] outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-[var(--text-3)]">
              {all.length === 0 ? "正在索引…" : "无匹配文件"}
            </div>
          )}
          {results.map((f, i) => (
            <button
              key={f.path}
              onMouseEnter={() => setSel(i)}
              onClick={() => { if (s.fileClickMode === "open") open(f); else setSel(i); }}
              onDoubleClick={() => open(f)}
              className={
                "flex w-full items-baseline gap-2 px-4 py-1.5 text-left " +
                (i === sel ? "bg-[var(--accent)]/12" : "hover:bg-[var(--surface)]")
              }
            >
              <span className="shrink-0 text-[13px] text-[var(--text)]">{f.name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-3)]">{f.rel}</span>
            </button>
          ))}
        </div>
        {all.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--text-3)]">
            <span>
              {all.length < total
                ? `已索引 ${all.length.toLocaleString()} / 共 ${total.toLocaleString()} 个文件`
                : `共 ${total.toLocaleString()} 个文件`}
            </span>
            {all.length < total && (
              <span className="shrink-0 text-[var(--accent)]">超出上限，部分未索引</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
