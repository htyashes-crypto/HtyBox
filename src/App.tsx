import { Allotment } from "allotment";
import Sidebar from "./components/Sidebar";
import TerminalDock from "./components/TerminalDock";

function WorkspaceTab({ name, active }: { name: string; active?: boolean }) {
  return (
    <div
      className={
        "cursor-pointer rounded-md px-3 py-1 text-xs transition-colors " +
        (active
          ? "border border-[#e5e2d9] border-t-2 border-t-[#d97757] bg-white text-[#191919]"
          : "border border-[#e5e2d9] text-[#73726c] hover:bg-white hover:text-[#191919]")
      }
    >
      {name}
    </div>
  );
}

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[#faf9f5] text-[#191919]">
      {/* 顶部 workspace 标签栏（占位，M2.5 实装） */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#e5e2d9] bg-[#f4f3ee] px-3">
        <div className="h-4 w-4 rounded bg-[#d97757]" />
        <span className="text-sm font-bold">HtyBox</span>
        <div className="ml-3 flex items-center gap-2">
          <WorkspaceTab name="workspace1" active />
          <WorkspaceTab name="workspace2" />
          <span className="cursor-pointer rounded px-1.5 text-base text-[#73726c] hover:text-[#191919]">
            +
          </span>
        </div>
        <div className="ml-auto cursor-pointer rounded-md border border-[#e8c8bb] bg-[#d97757]/12 px-3 py-1 text-xs font-semibold text-[#c15f3c] transition-colors hover:bg-[#d97757]/20">
          多 Agent 协作
        </div>
      </div>

      {/* 两栏：左侧栏(Skill/Memory 切换) | 终端区 */}
      <div className="min-h-0 flex-1">
        <Allotment proportionalLayout={false}>
          <Allotment.Pane minSize={220} preferredSize={300} snap>
            <Sidebar />
          </Allotment.Pane>
          <Allotment.Pane minSize={400}>
            <TerminalDock />
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* 底部状态栏 */}
      <div className="flex h-6 shrink-0 items-center border-t border-[#e5e2d9] bg-[#f4f3ee] px-3 text-[10px] text-[#8c8a82]">
        左侧栏切换 Skill / Memory · 拖到终端注入 · HtyBox v0.1
      </div>
    </div>
  );
}
