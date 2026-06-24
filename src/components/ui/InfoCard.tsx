import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 列表卡片：只显示名称（单行）。开启「悬浮提示」时，鼠标停留 ~0.5s 弹出详情浮层
 * （portal 到 body，fixed 定位在卡片右侧、避免被滚动容器裁切；右侧放不下则翻到左侧）。
 * 卡片本身可拖拽（skill/memory 注入），拖起/按下时收起浮层。
 */
export default function InfoCard({
  name,
  preview,
  hoverEnabled,
  onDragStart,
}: {
  name: string;
  preview: ReactNode;
  hoverEnabled: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    if (!hoverEnabled) return;
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const W = 340;
      const left = r.right + 8 + W > window.innerWidth ? Math.max(8, r.left - W - 8) : r.right + 8;
      const top = Math.max(8, Math.min(r.top, window.innerHeight - 200));
      setBox({ top, left });
    }, 500);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
    setBox(null);
  };

  return (
    <>
      <div
        ref={ref}
        draggable
        onDragStart={(e) => {
          hide();
          onDragStart(e);
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onMouseDown={hide}
        className="cursor-grab truncate rounded-lg border border-[#e5e2d9] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#191919] transition-colors hover:border-[#d4a27f] hover:bg-[#fbfaf7] active:cursor-grabbing"
      >
        {name}
      </div>
      {box &&
        createPortal(
          <div
            style={{ position: "fixed", top: box.top, left: box.left, width: 340, zIndex: 60 }}
            className="pointer-events-none rounded-xl border border-[#e5e2d9] bg-white px-3.5 py-3 shadow-lg"
          >
            {preview}
          </div>,
          document.body,
        )}
    </>
  );
}
