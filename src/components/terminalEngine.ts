import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

/**
 * 终端引擎注册表（M2）。
 *
 * 把 xterm 实例 + 后端 PTY 的生命周期与 React/dockview 的挂载解耦：
 * dockview 在分屏/拖动重排时会卸载并重新挂载面板的 React 组件，若终端随之
 * dispose 就会误杀 PTY。因此这里把 xterm 挂在一个游离的 host 元素上，
 * attach=把 host 塞进容器、detach=移出容器但保留实例，只有面板真正关闭时
 * 才 dispose（结束 PTY）。
 */
interface Engine {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement; // 游离 host 元素，承载 xterm
  opened: boolean;
  ro?: ResizeObserver;
}

const engines = new Map<string, Engine>();

/** 确保某 termId 的引擎存在（含后端 PTY）；已存在则忽略。 */
export function ensureEngine(
  termId: string,
  shell?: string,
  launchCmd?: string,
): void {
  if (engines.has(termId)) return;

  const el = document.createElement("div");
  el.style.width = "100%";
  el.style.height = "100%";

  const term = new Terminal({
    fontFamily: '"Cascadia Code", "Consolas", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: {
      background: "#1f1e1d",
      foreground: "#e5e2dc",
      cursor: "#d97757",
      selectionBackground: "#3a3631",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  // 后端 → 前端：PTY 输出（先 write 进缓冲，open 后渲染）
  const onOutput = new Channel<number[]>();
  onOutput.onmessage = (bytes) => term.write(new Uint8Array(bytes));

  invoke("create_terminal", {
    id: termId,
    opts: { shell, cols: 80, rows: 24 },
    onOutput,
  })
    .then(() => {
      // 等 shell 起到提示符，再自动发送启动命令（如 "claude\r"）
      if (launchCmd) {
        setTimeout(() => {
          invoke("write_terminal", { id: termId, data: launchCmd }).catch(
            () => {},
          );
        }, 600);
      }
    })
    .catch((err) =>
      term.write(`\r\n\x1b[31m[create_terminal 失败] ${err}\x1b[0m\r\n`),
    );

  // 前端 → 后端：用户输入
  term.onData((data) =>
    invoke("write_terminal", { id: termId, data }).catch(() => {}),
  );

  engines.set(termId, { term, fit, el, opened: false });
}

function fitAndResize(termId: string): void {
  const e = engines.get(termId);
  if (!e || !e.opened) return;
  try {
    e.fit.fit();
    invoke("resize_terminal", {
      id: termId,
      cols: e.term.cols,
      rows: e.term.rows,
    }).catch(() => {});
  } catch {
    /* 容器尺寸暂不可用，忽略 */
  }
}

/** 把引擎挂进容器（首次挂载时才 open），并监听尺寸。 */
export function attachEngine(termId: string, container: HTMLElement): void {
  const e = engines.get(termId);
  if (!e) return;
  container.appendChild(e.el);
  if (!e.opened) {
    e.term.open(e.el);
    e.opened = true;
  }
  requestAnimationFrame(() => fitAndResize(termId));
  const ro = new ResizeObserver(() => fitAndResize(termId));
  ro.observe(container);
  e.ro = ro;
  e.term.focus();
}

/** 从容器移出（保留 xterm + PTY，供重新挂载）。 */
export function detachEngine(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  e.ro?.disconnect();
  e.ro = undefined;
  e.el.parentElement?.removeChild(e.el);
}

/** 彻底销毁：结束 PTY、释放 xterm。仅在面板真正关闭时调用。 */
export function disposeEngine(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  e.ro?.disconnect();
  invoke("close_terminal", { id: termId }).catch(() => {});
  e.term.dispose();
  e.el.parentElement?.removeChild(e.el);
  engines.delete(termId);
}

/** 让某终端获得键盘焦点（拖拽注入后调用）。 */
export function focusEngine(termId: string): void {
  engines.get(termId)?.term.focus();
}
