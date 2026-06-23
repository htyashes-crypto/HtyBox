import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

let seq = 0;

/** 单个 xterm 终端，绑定一个后端 PTY（M1）。 */
export default function TerminalView({ shell }: { shell?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const termId = `term-${++seq}`;

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#0b0d11",
        foreground: "#e6e8ee",
        cursor: "#8b7cff",
        selectionBackground: "#2a2f3a",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      /* WebGL 不可用则回退到默认渲染器 */
    }
    fit.fit();

    // 后端 → 前端：PTY 输出（字节块；xterm 自行处理半截 UTF-8）
    const onOutput = new Channel<number[]>();
    onOutput.onmessage = (bytes) => term.write(new Uint8Array(bytes));

    let disposed = false;
    invoke("create_terminal", {
      id: termId,
      opts: { shell, cols: term.cols, rows: term.rows },
      onOutput,
    })
      .then(() => {
        // 若组件在 create 完成前已卸载，立即收尾，避免遗留进程
        if (disposed) invoke("close_terminal", { id: termId }).catch(() => {});
      })
      .catch((e) =>
        term.write(`\r\n\x1b[31m[create_terminal 失败] ${e}\x1b[0m\r\n`),
      );

    // 前端 → 后端：用户输入
    const dataSub = term.onData((data) =>
      invoke("write_terminal", { id: termId, data }).catch(() => {}),
    );

    // 尺寸同步：容器尺寸变化 → fit → 通知后端 resize
    const ro = new ResizeObserver(() => {
      fit.fit();
      invoke("resize_terminal", {
        id: termId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => {});
    });
    ro.observe(el);

    return () => {
      disposed = true;
      dataSub.dispose();
      ro.disconnect();
      invoke("close_terminal", { id: termId }).catch(() => {});
      term.dispose();
    };
  }, [shell]);

  return <div ref={ref} className="h-full w-full" />;
}
