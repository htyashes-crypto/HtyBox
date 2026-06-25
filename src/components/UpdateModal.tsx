import { useState } from "react";
import { marked } from "marked";
import { relaunch, type Update } from "../updater";

/** 自定义「发现新版本」弹窗：显示版本号 + 更新日志(md)，可「跳过此版本」或「立刻更新」。
 *  立刻更新 = 下载(带进度) → 安装 → 自动重启。遵守奶油主题、禁用原生弹窗。 */
export default function UpdateModal({
  update,
  onDismiss,
}: {
  update: Update;
  onDismiss: () => void; // 跳过/关闭：记住此版本、关弹窗（左上角标保留、可再次触发）
}) {
  const [phase, setPhase] = useState<"idle" | "downloading" | "installing" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [hasTotal, setHasTotal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = phase === "downloading" || phase === "installing";

  const doUpdate = async () => {
    setErr(null);
    setPhase("downloading");
    setPct(0);
    try {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
          setHasTotal(total > 0);
        } else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) setPct(Math.min(100, Math.round((got / total) * 100)));
        } else if (e.event === "Finished") {
          setPct(100);
          setPhase("installing");
        }
      });
      await relaunch(); // 安装完成 → 重启进入新版本
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  };

  const html = update.body ? (marked.parse(update.body, { async: false }) as string) : "";
  const date = update.date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-[460px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#d97757]/12 text-[#d97757]">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-[#191919]">发现新版本</div>
            <div className="mt-0.5 text-[12px] text-[#73726c]">
              v{update.currentVersion} → <span className="font-semibold text-[#c15f3c]">v{update.version}</span>
              {date && <span className="ml-1.5 text-[#a8a29a]">· {date}</span>}
            </div>
          </div>
          {!busy && (
            <button onClick={onDismiss} title="跳过" className="-mr-1 shrink-0 rounded-md px-1.5 text-[#a8a29a] hover:text-[#191919]">
              ✕
            </button>
          )}
        </div>

        {/* 更新日志 */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#eeece4] px-5 py-3">
          <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-[#a8a29a] uppercase">更新日志</div>
          {html ? (
            <div className="md-preview text-[12.5px] text-[#3a3a37]" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="text-[12px] text-[#a8a29a]">（本次更新未提供更新日志）</div>
          )}
        </div>

        {/* 进度 / 错误 */}
        {busy && (
          <div className="px-5 pt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ecebe2]">
              <div
                className={"h-full rounded-full bg-[#d97757] transition-all duration-200 " + (phase === "installing" || !hasTotal ? "animate-pulse" : "")}
                style={{ width: phase === "downloading" && hasTotal ? `${pct}%` : "100%" }}
              />
            </div>
            <div className="mt-1 text-[10.5px] text-[#73726c]">
              {phase === "installing" ? "正在安装，即将自动重启…" : hasTotal ? `下载中… ${pct}%` : "下载中…"}
            </div>
          </div>
        )}
        {err && <div className="px-5 pt-2 text-[11px] leading-relaxed text-[#d6453e]">更新失败：{err}</div>}

        {/* 按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-[#eeece4] px-5 py-3">
          {busy ? (
            <span className="mr-auto text-[11px] text-[#a8a29a]">更新过程中请勿关闭窗口…</span>
          ) : (
            <>
              <button
                onClick={onDismiss}
                className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium text-[#73726c] hover:bg-[#f4f3ee] hover:text-[#191919]"
              >
                跳过此版本
              </button>
              <button
                onClick={doUpdate}
                className="rounded-lg bg-[#d97757] px-4 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#c15f3c]"
              >
                {phase === "error" ? "重试更新" : "立刻更新"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
