import { open } from "@tauri-apps/plugin-dialog";

export interface RecentFolder {
  name: string;
  path: string;
}

export default function Welcome({
  recents,
  onOpen,
}: {
  recents: RecentFolder[];
  onOpen: (path: string) => void;
}) {
  const pickFolder = async () => {
    const sel = await open({
      directory: true,
      multiple: false,
      title: "选择文件夹作为工作区",
    });
    if (typeof sel === "string") onOpen(sel);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#faf9f5] text-[#191919]">
      <div className="flex w-[520px] flex-col">
        {/* 品牌 */}
        <div className="mb-1 flex items-center justify-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-[#d97757]" />
          <span className="text-2xl font-bold tracking-tight">HtyBox</span>
        </div>
        <div className="mb-8 text-center text-xs text-[#8c8a82]">
          多终端 · Skill / Memory · 多 Agent 协作
        </div>

        {/* 打开文件夹 */}
        <button
          onClick={pickFolder}
          className="mb-7 flex w-full items-center justify-center gap-2 rounded-xl border border-[#e5e2d9] bg-white px-4 py-3 text-sm font-semibold text-[#191919] shadow-sm transition-colors hover:border-[#d4a27f] hover:bg-[#fbfaf7]"
        >
          <svg
            className="h-4 w-4 text-[#d97757]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          打开文件夹作为工作区
        </button>

        {/* 最近 */}
        <div className="mb-2 px-1 text-[11px] font-semibold tracking-wider text-[#8c8a82] uppercase">
          最近打开
        </div>
        {recents.length === 0 ? (
          <div className="px-1 text-xs text-[#a8a29a]">还没有最近的工作区</div>
        ) : (
          <div className="space-y-0.5">
            {recents.map((r) => (
              <button
                key={r.path}
                onClick={() => onOpen(r.path)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#f0eee6]"
              >
                <span className="shrink-0 truncate text-sm font-medium text-[#191919]">
                  {r.name}
                </span>
                <span
                  className="truncate font-mono text-[11px] text-[#a8a29a]"
                  title={r.path}
                >
                  {r.path}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
