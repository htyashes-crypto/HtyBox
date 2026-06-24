import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

/**
 * 终端引擎注册表 —— xterm.js 官方最小集成模式（一次性清掉历史补丁，全部交给成熟机制）。
 *
 * 1. DOM 渲染器（xterm 默认）：无 WebGL → 无纹理图集损坏、无浏览器 WebGL context 上限。
 * 2. 零 term.refresh() 强制重绘：重绘交给 xterm 自身渲染循环 + 内置 IntersectionObserver
 *    （容器不可见时自动暂停、恢复显示自动全量重绘 —— VS Code 同款，杜绝自写"切屏空白/残留"）。
 * 3. 尺寸：单一 ResizeObserver + 防抖 fit；尺寸稳定后才按真实列宽建 PTY，之后仅在尺寸真的变了
 *    才 resize；绝不在切区/激活时乱 resize（claude 整屏重绘错位叠影的根因就是启动期被乱 resize）。
 * 4. 粘贴：只走标准 paste 事件一条路径（capture 阶段拦截，避免 xterm 再粘一遍 → 双重粘贴）。
 * 5. 引擎与 React/dockview 挂载解耦：dockview 重排会卸载重挂面板，xterm 挂在游离 host 元素上，
 *    attach=塞进容器、detach=移出保留、dispose=面板真正关闭时才结束 PTY。
 */
interface Engine {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement; // 游离 host 元素，承载 xterm
  opened: boolean;
  ro?: ResizeObserver;
  onTitle?: (title: string) => void; // 程序设置终端标题(OSC)时回调（Tab 自动命名）
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  pendingLaunch?: string; // 待发的启动命令（如 "claude\r"），等 created+提示符就绪才发
  created: boolean; // 后端 PTY 是否已创建
  launchArmed: boolean; // shell 提示符已就绪（createPty 后 ~600ms）
  launched: boolean; // 启动命令已发出
  lastCols?: number; // 上次发给 PTY 的尺寸；去重避免多余 SIGWINCH 把运行中的 TUI 画花
  lastRows?: number;
  fitTimer?: number; // 防抖句柄：合并连续尺寸变化（挂载布局抖动 / 拖动分屏），稳定后只 fit 一次
}

const engines = new Map<string, Engine>();

/**
 * 把粘贴文本规范化换行 + 成对 bracketed-paste 包裹，让 claude/codex 折叠成 [Pasted text +N lines]。
 * 两家计行用的换行符不同(实测)：claude 按 \r、codex 按 \n；发错就数不出行数 → 不折叠。
 */
function pasteData(agentKind: string | undefined, raw: string): string {
  if (agentKind === "claude") {
    const t = raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
    return `\x1b[200~${t}\x1b[201~`;
  }
  if (agentKind === "codex") {
    const t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return `\x1b[200~${t}\x1b[201~`;
  }
  // 普通 shell：换行规范成 \r 当作逐行回车输入（不包裹 bracketed）
  return raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

/** 确保某 termId 的引擎存在；已存在则忽略。此时只建 xterm，PTY 延迟到尺寸稳定后才建。 */
export function ensureEngine(
  termId: string,
  shell?: string,
  launchCmd?: string,
  cwd?: string,
  env?: Record<string, string>,
  agentKind?: string, // "claude"|"codex"|"shell"：决定粘贴的换行/包裹方式
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

  // 程序通过 OSC 设标题时回调（Tab 自动命名）
  term.onTitleChange((title) => engines.get(termId)?.onTitle?.(title));
  // 前端 → 后端：用户输入（PTY 未建时后端忽略）
  term.onData((data) =>
    invoke("write_terminal", { id: termId, data }).catch(() => {}),
  );

  // 复制：Ctrl+C 有选区则复制并清选区，无选区放行(=SIGINT)。粘贴不在 keydown 处理（见下方 paste 事件）。
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
    if ((e.key === "c" || e.key === "C") && !e.shiftKey) {
      const sel = term.getSelection();
      if (sel) {
        navigator.clipboard?.writeText(sel).catch(() => {});
        term.clearSelection();
        return false;
      }
    }
    return true;
  });

  // 粘贴：只走标准 paste 事件。capture 阶段在 host 上拦截 → preventDefault+stopPropagation，
  // 让 xterm 自带的 paste 监听器(在内部 textarea 上)收不到 → 杜绝"Ctrl+V 粘两遍"。
  // clipboardData 同步可读，无需 navigator.clipboard 权限。
  el.addEventListener(
    "paste",
    (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const raw = ev.clipboardData?.getData("text") ?? "";
      if (!raw) return;
      invoke("write_terminal", {
        id: termId,
        data: pasteData(agentKind, raw),
      }).catch(() => {});
    },
    true,
  );

  engines.set(termId, {
    term,
    fit,
    el,
    opened: false,
    shell,
    cwd,
    env,
    pendingLaunch: launchCmd,
    created: false,
    launchArmed: false,
    launched: false,
  });
}

/** 按"当前已 fit 的真实列宽"创建后端 PTY（每个引擎只建一次）。 */
function createPty(termId: string): void {
  const e = engines.get(termId);
  if (!e || e.created) return;
  e.created = true;
  const cols = e.term.cols || 80;
  const rows = e.term.rows || 24;
  e.lastCols = cols;
  e.lastRows = rows;

  const onOutput = new Channel<number[]>();
  onOutput.onmessage = (bytes) => e.term.write(new Uint8Array(bytes));

  invoke("create_terminal", {
    id: termId,
    opts: { shell: e.shell, cwd: e.cwd, cols, rows, env: e.env },
    onOutput,
  })
    .then(() => {
      // shell 起到提示符（~600ms）后武装启动命令；尺寸已就绪 → maybeLaunch 即发
      setTimeout(() => {
        const e2 = engines.get(termId);
        if (e2) {
          e2.launchArmed = true;
          maybeLaunch(termId);
        }
      }, 600);
    })
    .catch((err) =>
      e.term.write(`\r\n\x1b[31m[create_terminal 失败] ${err}\x1b[0m\r\n`),
    );
}

/** shell 就绪 + PTY 已按真实列宽建好后，发启动命令（claude/codex 在正确尺寸下首次绘制）。 */
function maybeLaunch(termId: string): void {
  const e = engines.get(termId);
  if (!e || e.launched || !e.launchArmed || !e.pendingLaunch || !e.created)
    return;
  e.launched = true;
  invoke("write_terminal", { id: termId, data: e.pendingLaunch }).catch(
    () => {},
  );
}

/** 防抖：合并连续尺寸变化（挂载布局抖动 / 拖动分屏），稳定 100ms 后只 fit 一次。 */
function scheduleFit(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  if (e.fitTimer) clearTimeout(e.fitTimer);
  e.fitTimer = window.setTimeout(() => doFit(termId), 100);
}

/**
 * 尺寸稳定后：首次 open + fit + 按真实列宽建 PTY；之后仅在列宽/行高真的变了才 resize。
 * 不做任何强制重绘 —— 重绘交给 xterm 渲染循环与内置 IntersectionObserver（恢复显示自会全量重画）。
 */
function doFit(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  e.fitTimer = undefined;
  // 容器隐藏(display:none / 未布局)尺寸为 0：跳过；恢复显示时 xterm 内置 IntersectionObserver 自会重绘
  if (e.el.clientWidth === 0 || e.el.clientHeight === 0) return;
  if (!e.opened) {
    e.term.open(e.el);
    e.opened = true;
    e.term.focus();
  }
  try {
    e.fit.fit();
  } catch {
    return; // 容器尺寸暂不可用
  }
  if (!e.created) {
    createPty(termId); // 尺寸已稳 → 按真实列宽建 PTY（claude 一出生即最终尺寸，启动期零 resize）
    return;
  }
  const { cols, rows } = e.term;
  if (cols !== e.lastCols || rows !== e.lastRows) {
    e.lastCols = cols;
    e.lastRows = rows;
    invoke("resize_terminal", { id: termId, cols, rows }).catch(() => {});
  }
  maybeLaunch(termId);
}

/** 外部（dockview 尺寸/可见性事件）触发重排：仅防抖 fit，重绘交给 xterm 自身。 */
export function refitEngine(termId: string): void {
  scheduleFit(termId);
}

/** 把引擎挂进容器（open 推迟到 doFit 容器就绪时），并监听尺寸。 */
export function attachEngine(termId: string, container: HTMLElement): void {
  const e = engines.get(termId);
  if (!e) return;
  container.appendChild(e.el);
  requestAnimationFrame(() => scheduleFit(termId));
  const ro = new ResizeObserver(() => scheduleFit(termId));
  ro.observe(container);
  e.ro = ro;
  if (e.opened) e.term.focus();
}

/** 从容器移出（保留 xterm + PTY，供重新挂载）。 */
export function detachEngine(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  e.ro?.disconnect();
  e.ro = undefined;
  if (e.fitTimer) clearTimeout(e.fitTimer);
  e.el.parentElement?.removeChild(e.el);
}

/** 彻底销毁：结束 PTY、释放 xterm。仅在面板真正关闭时调用。 */
export function disposeEngine(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  e.ro?.disconnect();
  if (e.fitTimer) clearTimeout(e.fitTimer);
  if (e.created) invoke("close_terminal", { id: termId }).catch(() => {});
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
