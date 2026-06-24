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
 *
 * 关键：后端 PTY 的创建**延迟到容器首次 fit 出真实列宽**（createPty）——这样
 * claude/codex 的 TUI 一出生就是正确尺寸，不会先按默认 80 列画、再被 resize
 * 重排成花屏（尤其 agent 终端要连多个 MCP server、启动期长且忙）。
 */
interface Engine {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement; // 游离 host 元素，承载 xterm
  opened: boolean;
  ro?: ResizeObserver;
  onTitle?: (title: string) => void; // 程序设置终端标题时回调（Tab 自动命名）
  // 建 PTY 用参数（延迟到首次 fit 才用真实列宽创建）
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  pendingLaunch?: string; // 待发的启动命令（如 "claude\r"），等 created+shell就绪 才发
  created: boolean; // 后端 PTY 是否已创建
  launchArmed: boolean; // shell 提示符已就绪（createPty 后 ~600ms）
  launched: boolean; // 启动命令已发出
  lastCols?: number; // 上次发给 PTY 的尺寸；去重避免多余 SIGWINCH 把运行中的 TUI 画花
  lastRows?: number;
  hidden?: boolean; // 容器被 display:none 隐藏过 → 恢复显示时即使尺寸没变也要强制重画
  createTimer?: number; // 防抖句柄：等容器尺寸稳定后才 open+createPty（修启动期 resize 致叠影/卡死）
}

const engines = new Map<string, Engine>();

/** 确保某 termId 的引擎存在；已存在则忽略。此时只建 xterm，PTY 延迟到首次 fit。 */
export function ensureEngine(
  termId: string,
  shell?: string,
  launchCmd?: string,
  cwd?: string,
  env?: Record<string, string>,
  agentKind?: string, // "claude"|"codex"|"shell"：粘贴时据此对 agent 终端强制 bracketed 折叠
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
  // 前端 → 后端：用户输入（PTY 未建时 write 会被后端忽略）
  term.onData((data) =>
    invoke("write_terminal", { id: termId, data }).catch(() => {}),
  );

  // 复制/粘贴（WebView 原生 paste 事件不可靠 → 显式拦截）：
  // Ctrl+V → 读剪贴板 term.paste()（走 bracketed-paste，claude/codex 识别为整段粘贴）；
  // Ctrl+C → 有选区则复制并清选区，无选区放行（= SIGINT 中断）。
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
    if (e.key === "v" || e.key === "V") {
      navigator.clipboard
        ?.readText()
        .then((raw) => {
          if (!raw) return;
          // claude/codex：成对 bracketed-paste 强制注入(不赌可能被 ConPTY 吞掉的 ?2004h 标志)，
          // 让其把多行折叠成 [Pasted text +N lines]。两家计行用的换行符不同(实测)：
          //   · claude 按 \r 计行(与真实终端 bracketed-paste 惯例一致，xterm/Win Terminal 都发 \r)；
          //   · codex 按 \n 计行(发 \r 不折叠)。
          // 发错换行符 → 数不出行数 → 不折叠(Ctrl+V 一直全量显示的真因)。
          if (agentKind === "claude") {
            const text = raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
            invoke("write_terminal", {
              id: termId,
              data: `\x1b[200~${text}\x1b[201~`,
            }).catch(() => {});
          } else if (agentKind === "codex") {
            const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            invoke("write_terminal", {
              id: termId,
              data: `\x1b[200~${text}\x1b[201~`,
            }).catch(() => {});
          } else {
            // 普通 shell：交给 xterm 原生 paste（按 bracketedPasteMode 决定是否包裹），不引入回归。
            term.paste(raw);
          }
        })
        .catch(() => {});
      return false;
    }
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

/** 按"当前已 fit 的真实列宽"创建后端 PTY（每个引擎只创建一次）。 */
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
  if (!e || e.launched || !e.launchArmed || !e.pendingLaunch || !e.created) return;
  e.launched = true;
  invoke("write_terminal", { id: termId, data: e.pendingLaunch }).catch(
    () => {},
  );
}

/**
 * 尺寸稳定后：open(若未) + fit + 按最终列宽建 PTY。只由 fitAndResize 的防抖定时器调用。
 * 等尺寸稳再 open，渲染器按真实尺寸初始化 → 修"打字不刷新/卡死第一个字符"。
 * 用 DOM 渲染器(不挂 WebGL)：opacity 叠放下终端常驻渲染，WebGL 多上下文超浏览器上限 +
 * 纹理图集损坏(彩色噪块)；DOM 无图集、无上限、清屏干净。
 */
function openFitCreate(termId: string): void {
  const e = engines.get(termId);
  if (!e || e.created) return;
  e.createTimer = undefined;
  if (e.el.clientWidth === 0 || e.el.clientHeight === 0) return; // 又被隐藏 → 等下次 fit 重新防抖
  if (!e.opened) {
    e.term.open(e.el);
    e.opened = true;
    e.term.focus();
  }
  try {
    e.fit.fit();
  } catch {
    return;
  }
  createPty(termId);
}

function fitAndResize(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  // 容器隐藏(display:none，如非活动 workspace/tab)或未布局时尺寸为 0：记下隐藏过、跳过
  if (e.el.clientWidth === 0 || e.el.clientHeight === 0) {
    e.hidden = true;
    return;
  }
  // 还没建 PTY：防抖等容器尺寸稳定(连续 140ms 不变)再 open+fit+createPty。
  // 根因修复：分屏/dockview 布局在挂载后头几帧会反复改面板尺寸，若此刻就按瞬时列宽建 PTY，
  // claude 会按错误列宽启动绘制，layout 一稳就被 resize → 整屏光标定位重绘错位 → 与上一屏
  // (启动 splash / resume 选择器)叠在同一行(画面重叠)；也表现为"卡死第一个字符、拖动才恢复"。
  // 等尺寸稳定再建 → claude 一出生即最终列宽、启动期零 resize。
  if (!e.created) {
    if (e.createTimer) clearTimeout(e.createTimer);
    e.createTimer = window.setTimeout(() => openFitCreate(termId), 140);
    return;
  }
  if (!e.opened) return;
  try {
    e.fit.fit();
  } catch {
    return; // 容器尺寸暂不可用
  }
  const { cols, rows } = e.term;
  const wasHidden = e.hidden === true;
  e.hidden = false;
  if (cols !== e.lastCols || rows !== e.lastRows) {
    // 尺寸变了：去重后 resize PTY + 重画
    e.lastCols = cols;
    e.lastRows = rows;
    invoke("resize_terminal", { id: termId, cols, rows }).catch(() => {});
    try {
      e.term.refresh(0, e.term.rows - 1);
    } catch {
      /* ignore */
    }
  } else if (wasHidden) {
    // 尺寸没变但刚从隐藏(display:none)恢复 → WebGL/DOM 都需强制重画一遍，否则空白/残留
    try {
      e.term.refresh(0, e.term.rows - 1);
    } catch {
      /* ignore */
    }
  }
  maybeLaunch(termId);
}

/**
 * 外部（dockview 尺寸/可见性事件）触发 fit + resize + **强制重绘**。
 * 重绘修复：面板从隐藏(回欢迎页/切走 workspace)恢复显示后，xterm 视口不会自动重画
 * （尤其 codex/claude 这类全屏 TUI 没收到 resize 就不重绘）→ 整片空白。refresh 从
 * xterm 自身缓冲重画一遍即可恢复。
 */
export function refitEngine(termId: string): void {
  fitAndResize(termId);
  const e = engines.get(termId);
  if (e && e.opened && e.created) {
    try {
      e.term.refresh(0, e.term.rows - 1);
    } catch {
      /* ignore */
    }
  }
}

/** 把引擎挂进容器（首次挂载时才 open），并监听尺寸。 */
export function attachEngine(termId: string, container: HTMLElement): void {
  const e = engines.get(termId);
  if (!e) return;
  container.appendChild(e.el);
  // open() + 挂 WebGL 推迟到 fitAndResize（容器已就绪、尺寸非 0 时），避免按 0 尺寸初始化渲染器
  requestAnimationFrame(() => fitAndResize(termId));
  const ro = new ResizeObserver(() => fitAndResize(termId));
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
  e.el.parentElement?.removeChild(e.el);
}

/** 彻底销毁：结束 PTY、释放 xterm。仅在面板真正关闭时调用。 */
export function disposeEngine(termId: string): void {
  const e = engines.get(termId);
  if (!e) return;
  e.ro?.disconnect();
  if (e.createTimer) clearTimeout(e.createTimer); // 取消未触发的延迟建 PTY，避免销毁/建立竞态
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

/**
 * 强制重排 + 重画某 workspace 的全部终端。工作区从隐藏(回欢迎页/切走，display:none)恢复显示时调用。
 * 由 React(知道哪个工作区 active)驱动，不依赖 ResizeObserver（祖先 display 切换它不一定触发）。
 */
export function redrawByPrefix(prefix: string): void {
  for (const id of [...engines.keys()]) {
    if (!id.startsWith(prefix)) continue;
    fitAndResize(id); // open-if-needed + fit + 去重 resize
    const e = engines.get(id);
    if (
      e &&
      e.opened &&
      e.created &&
      e.el.clientWidth > 0 &&
      e.el.clientHeight > 0
    ) {
      try {
        e.term.refresh(0, e.term.rows - 1); // 无条件强制重画（修恢复显示后的空白）
      } catch {
        /* ignore */
      }
    }
  }
}
