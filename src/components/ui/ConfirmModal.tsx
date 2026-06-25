/** M9：危险操作确认弹窗（删除用）；自定义风格，不用原生 confirm。 */
export default function ConfirmModal({
  title,
  message,
  confirmText = "删除",
  onConfirm,
  onClose,
}: {
  title: string;
  message?: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[360px] max-w-[90vw] rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold text-[#191919]">{title}</div>
        {message && <div className="mb-3 text-[12px] leading-relaxed text-[#73726c]">{message}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1 text-[12px] text-[#73726c] hover:bg-[#f4f3ee]">
            取消
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="rounded-md bg-[#d6453e] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#c13a34]"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
