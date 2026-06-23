import { Allotment } from "allotment";

/** 占位面板：M0 阶段仅有结构与配色，内容在后续里程碑填充 */
function Panel({
  title,
  hint,
  bg = "#161a21",
}: {
  title: string;
  hint: string;
  bg?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col" style={{ background: bg }}>
      <div className="border-b border-[#2a2f3a] px-3 py-2 text-[11px] font-bold tracking-wider text-[#8a92a3]">
        {title}
      </div>
      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[#5c6478]">
        {hint}
      </div>
    </div>
  );
}

function WorkspaceTab({ name, active }: { name: string; active?: boolean }) {
  return (
    <div
      className={
        "rounded-md px-3 py-1 text-xs " +
        (active
          ? "border border-[#3a4150] border-t-2 border-t-[#8b7cff] bg-[#20242c] text-[#e6e8ee]"
          : "border border-[#2a2f3a] text-[#8a92a3]")
      }
    >
      {name}
    </div>
  );
}

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[#0f1115] text-[#e6e8ee]">
      {/* 顶部 workspace 标签栏（占位，M2.5 实装） */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#2a2f3a] bg-[#161a21] px-3">
        <div className="h-4 w-4 rounded bg-[#8b7cff]" />
        <span className="text-sm font-bold">HtyBox</span>
        <div className="ml-3 flex items-center gap-2">
          <WorkspaceTab name="workspace1" active />
          <WorkspaceTab name="workspace2" />
          <span className="px-1 text-base text-[#8a92a3]">+</span>
        </div>
        <div className="ml-auto rounded-md border border-[#3a3050] bg-[#8b7cff]/15 px-3 py-1 text-xs font-semibold text-[#8b7cff]">
          多 Agent 协作
        </div>
      </div>

      {/* 三栏：Skill | 终端 | Memory（可拖拽调宽） */}
      <div className="min-h-0 flex-1">
        <Allotment proportionalLayout={false}>
          <Allotment.Pane minSize={180} preferredSize={260} snap>
            <Panel title="SKILL" hint="技能列表 + 搜索（占位 · M3）" />
          </Allotment.Pane>
          <Allotment.Pane minSize={360}>
            <Panel
              title="终端区"
              hint="多终端 · 标签页 + 分屏（占位 · M1 / M2）"
              bg="#0b0d11"
            />
          </Allotment.Pane>
          <Allotment.Pane minSize={180} preferredSize={260} snap>
            <Panel title="MEMORY" hint="记忆列表（占位 · M3）" />
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* 底部状态栏（占位） */}
      <div className="flex h-6 shrink-0 items-center border-t border-[#2a2f3a] bg-[#161a21] px-3 text-[10px] text-[#5c6478]">
        M0 脚手架 · 三栏可拖拽调宽 · HtyBox v0.1
      </div>
    </div>
  );
}
