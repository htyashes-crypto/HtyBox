import { useSettings, setSetting } from "../settings";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={
        "relative h-5 w-9 shrink-0 rounded-full transition-colors " +
        (on ? "bg-[#d97757]" : "bg-[#d6d3ca]")
      }
    >
      <span
        className={
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all " +
          (on ? "left-[18px]" : "left-0.5")
        }
      />
    </button>
  );
}

/** 全局设置弹窗（Cursor 式）。未来各类全局开关都加到这里。 */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  return (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] rounded-2xl border border-[#e5e2d9] bg-[#faf9f5] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#191919]">设置</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[#73726c] transition-colors hover:bg-[#ecebe2] hover:text-[#191919]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-[#f0eee6]">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#191919]">悬浮提示</div>
              <div className="text-[11px] text-[#8c8a82]">
                鼠标停留时弹出 Skill / Memory 详情浮层
              </div>
            </div>
            <Toggle
              on={s.hoverPreview}
              onChange={(v) => setSetting("hoverPreview", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-[#f0eee6]">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#191919]">多 Agent 全自动接力</div>
              <div className="text-[11px] text-[#8c8a82]">
                开：唤醒自动注入（终端静默后），团队无人工接力跑；关：半自动（弹提示，点击才唤醒）
              </div>
            </div>
            <Toggle
              on={s.autoRelay}
              onChange={(v) => setSetting("autoRelay", v)}
            />
          </div>
        </div>

        <div className="mt-4 border-t border-[#e5e2d9] pt-3 text-[10px] text-[#a8a29a]">
          更多全局设置将陆续加入此处。
        </div>
      </div>
    </div>
  );
}
