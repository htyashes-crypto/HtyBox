import type { SkillTemplate } from "../skillTemplates";

/** M8-C：切换当前 Skill 模板的弹窗（风格统一，非默认对话框）。点某模板即应用并关闭。 */
export default function TemplatePicker({
  templates,
  activeId,
  onPick,
  onManage,
  onClose,
}: {
  templates: SkillTemplate[];
  activeId: string | null;
  onPick: (t: SkillTemplate) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[360px] max-w-[90vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e5e2d9] px-4 py-3">
          <span className="text-sm font-semibold text-[#191919]">切换模板</span>
          <button onClick={onClose} className="rounded px-2 text-[#a8a29a] hover:text-[#191919]">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {templates.length === 0 && (
            <div className="px-2 py-8 text-center text-[12px] text-[#a8a29a]">
              还没有模板，点下方「管理模板」新建
            </div>
          )}
          {templates.map((t) => {
            const active = t.id === activeId;
            return (
              <button
                key={t.id}
                onClick={() => {
                  onPick(t);
                  onClose();
                }}
                className={
                  "flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors " +
                  (active
                    ? "border-[#d97757] bg-[#fdf6f2]"
                    : "border-[#e5e2d9] hover:border-[#d4a27f] hover:bg-[#fbfaf7]")
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[#191919]">
                    {t.name || "（未命名）"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#a8a29a]">
                    {t.skillDirs.length} 个 skill 上架 · 其余下架
                  </div>
                </div>
                {active && (
                  <svg
                    className="h-4 w-4 shrink-0 text-[#d97757]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#e5e2d9] p-2">
          <button
            onClick={() => {
              onClose();
              onManage();
            }}
            className="w-full rounded-xl bg-[#ecebe2] px-3 py-2 text-[12px] font-semibold text-[#73726c] hover:bg-[#e3e1d6] hover:text-[#191919]"
          >
            ⚙ 管理模板
          </button>
        </div>
      </div>
    </div>
  );
}
