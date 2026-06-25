import type { SkillTemplate } from "../skillTemplates";

/** M8-C：切换当前 Skill 模板的下拉框（锚定在模板栏按钮下方，非弹窗）。点某模板即应用并关闭。 */
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
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className="absolute left-0 top-full z-[61] mt-1 max-h-[60vh] w-full min-w-[220px] overflow-y-auto rounded-lg border border-[#e5e2d9] bg-white py-1 shadow-xl">
        {templates.length === 0 && (
          <div className="px-3 py-3 text-center text-[11px] text-[#a8a29a]">还没有模板，点 ⚙ 新建</div>
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
                "flex w-full items-center gap-2 px-3 py-1.5 text-left " +
                (active ? "bg-[#d97757]/10" : "hover:bg-[#f4f3ee]")
              }
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-[#191919]">{t.name || "（未命名）"}</span>
              <span className="shrink-0 text-[10px] text-[#a8a29a]">{t.skillDirs.length}</span>
              {active && (
                <svg className="h-3.5 w-3.5 shrink-0 text-[#d97757]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
        <div className="my-1 border-t border-[#eceae3]" />
        <button
          onClick={() => {
            onClose();
            onManage();
          }}
          className="block w-full px-3 py-1.5 text-left text-[12px] text-[#73726c] hover:bg-[#f4f3ee]"
        >
          ⚙ 管理模板…
        </button>
      </div>
    </>
  );
}
