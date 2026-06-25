import { useState } from "react";

/** M9：终端/编辑器区「⋯ 更多操作」菜单——批量关闭标签等通用功能。 */
export default function DockActionsMenu({
  onCloseAll,
  onCloseOthers,
  onCloseSaved,
}: {
  onCloseAll: () => void;
  onCloseOthers: () => void;
  onCloseSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = (label: string, onClick: () => void, danger?: boolean) => (
    <button
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className={
        "block w-full px-3 py-1.5 text-left text-[12px] hover:bg-[#f4f3ee] " +
        (danger ? "text-[#d6453e]" : "text-[#3a3a37]")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="更多操作"
        className="flex h-7 w-7 items-center justify-center rounded-md text-[#73726c] transition-colors hover:bg-white hover:text-[#191919]"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-[61] mt-1 w-48 rounded-lg border border-[#e5e2d9] bg-white py-1 shadow-xl">
            {item("关闭已保存的编辑器", onCloseSaved)}
            {item("关闭其他标签", onCloseOthers)}
            <div className="my-1 border-t border-[#eceae3]" />
            {item("关闭所有标签", onCloseAll, true)}
          </div>
        </>
      )}
    </div>
  );
}
