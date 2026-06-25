import { open } from "@tauri-apps/plugin-dialog";
import WindowControls from "./WindowControls";
import HtyBoxLogo from "./ui/HtyBoxLogo";

export interface RecentFolder {
  name: string;
  path: string;
}

export default function Welcome({
  recents,
  onOpen,
  onOpenSettings,
}: {
  recents: RecentFolder[];
  onOpen: (path: string) => void;
  onOpenSettings: () => void;
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
    <div className="relative flex h-screen w-screen items-center justify-center bg-[#faf9f5] text-[#191919]">
      {/* 无边框窗口：顶部拖拽条 + 窗口控制（贴右上角） */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-9 select-none" />
      <div className="absolute top-0 right-0 z-10 h-9">
        <WindowControls />
      </div>
      <button
        onClick={onOpenSettings}
        title="设置"
        className="absolute top-2.5 left-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-[#73726c] transition-colors hover:bg-[#ecebe2] hover:text-[#191919]"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div className="flex w-[520px] flex-col">
        {/* 品牌 */}
        <div className="mb-10 flex items-center justify-center gap-5">
          <HtyBoxLogo size={144} initial="closed" introOnMount openOnHover />
          <span className="text-7xl font-bold tracking-tight">HtyBox</span>
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
