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
  onTitle?: (title: string) => void; // 程序设置终端标题时回调（Tab 自动命名）
  pendingLaunch?: string; // 待发的启动命令（如 "claude\r"），等"shell就绪+尺寸已fit"才发
  launchArmed: boolean; // shell 提示符已就绪（create 后 ~600ms）
  launched: boolean; // 启动命令已发出
  lastCols?: number; // 上次发给 PTY 的尺寸；去重避免多余 SIGWINCH 把运行中的 TUI 画花
  lastRows?: number;
}

const engines = new Map<string, Engine>();

/** 确保某 termId 的引擎存在（含后端 PTY）；已存在则忽略。 */
export function ensureEngine(
  termId: string,
  shell?: string,
  launchCmd?: string,
  cwd?: string,
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

  // 程序通过 OSC 设置终端标题时回调（用于 Tab 自动命名）
  term.onTitleChange((title) => {
    engines.get(termId)?.onTitle?.(title);
  });

  // 后端 → 前端：PTY 输出（先 write 进缓冲，open 后渲染）
  const onOutput = new Channel<number[]>();
  onOutput.onmessage = (bytes) => term.write(new Uint8Array(bytes));

  invoke("create_terminal", {
    id: termId,
    opts: { shell, cwd, cols: 80, rows: 24 },
    onOutput,
  })
    .then(() => {
      // shell 起到提示符（~600ms）后"武装"启动命令；真正发送要等尺寸已 fit（见 maybeLaunch），
      // 避免 claude/codex 在默认 80 列下先画、再被 resize 重排成花屏。
      setTimeout(() => {
        const e = engines.get(termId);
        if (e) {
          e.launchArmed = true;
          maybeLaunch(termId);
        }
      }, 600);
    })
    .catch((err) =>
      term.write(`\r\n\x1b[31m[create_terminal 失败] ${err}\x1b[0m\r\n`),
    );

  // 前端 → 后端：用户输入
  term.onData((data) =>
    invoke("write_terminal", { id: termId, data }).catch(() => {}),
  );

  engines.set(termId, {
    term,
    fit,
    el,
    opened: false,
    pendingLaunch: launchCmd,
    launchArmed: false,
    launched: false,
  });
}

/**
 * 在"shell 就绪 + 容器已 fit 到真实尺寸"后才发启动命令——保证 claude/codex 的 TUI
 * 在正确列宽下首次绘制（lastCols 已被一次成功 fit 写入即代表尺寸就绪）。
 */
function maybeLaunch(termId: string): void {
  const e = engines.get(termId);
  if (!e || e.launched || !e.launchArmed || !e.pendingLaunch) return;
  if (!e.opened || e.lastCols === undefined) return; // 等第一次成功 fit 拿到真实列宽
  e.launched = true;
  invoke("write_terminal", { id: termId, data: e.pendingLaunch }).catch(
    () => {},
  );
}

function fitAndResize(termId: string): void {
  const e = engines.get(termId);
  if (!e || !e.opened) return;
  // 容器隐藏(display:none，如非活动 workspace)时尺寸为 0，跳过避免 fit 到 0
  if (e.el.clientWidth === 0 || e.el.clientHeight === 0) return;
  try {
    e.fit.fit();
    const { cols, rows } = e.term;
    // 去重：尺寸没变就不再 resize PTY，避免多余 SIGWINCH 把运行中的 TUI 画花
    if (cols !== e.lastCols || rows !== e.lastRows) {
      e.lastCols = cols;
      e.lastRows = rows;
      invoke("resize_terminal", { id: termId, cols, rows }).catch(() => {});
    }
  } catch {
    /* 容器尺寸暂不可用，忽略 */
  }
  maybeLaunch(termId); // 尺寸已就绪时若 shell 也 ready，则发启动命令
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

/** 注册/清除"终端标题变化"回调（Tab 自动命名用）。 */
export function setEngineTitleHandler(
  termId: string,
  fn: ((title: string) => void) | undefined,
): void {
  const e = engines.get(termId);
  if (e) e.onTitle = fn;
}

/** 结束某前缀（= 某 workspace）的所有终端，关闭工作区时用。 */
export function disposeByPrefix(prefix: string): void {
  for (const id of [...engines.keys()]) {
    if (id.startsWith(prefix)) disposeEngine(id);
  }
}
