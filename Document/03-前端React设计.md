# 03 · 前端 React 设计

前端职责：三栏布局、xterm 终端渲染与 IO 桥接、skill/memory 列表与搜索、拖拽发起、状态管理、与 Rust 的 IPC 封装。

---

## 1. 依赖

```jsonc
// package.json (dependencies 关键项)
{
  "@tauri-apps/api": "^2",            // invoke / Channel / event
  "@tauri-apps/plugin-store": "^2",   // 配置持久化
  "react": "^18", "react-dom": "^18",
  "@xterm/xterm": "^5",
  "@xterm/addon-fit": "^0.10",
  "@xterm/addon-webgl": "^0.18",
  "@xterm/addon-search": "^0.15",
  "@xterm/addon-web-links": "^0.11",
  "dockview": "^1",                   // 标签页 + 分屏
  "allotment": "^1",                  // 三栏可调宽
  "zustand": "^4",
  "fuse.js": "^7"
}
// devDependencies: vite, typescript, @vitejs/plugin-react, tailwindcss, @tauri-apps/cli
```

---

## 2. 组件树

```
<App>                                  # 装配三栏 + 全局副作用
└─ <Allotment>                         # 水平三栏，宽度持久化
   ├─ <SkillPanel>                     # 左栏
   │   ├─ <SearchBox>                  # fuse.js 过滤
   │   └─ <SkillCard draggable> × N
   ├─ <TerminalDock>                   # 中栏：dockview 容器
   │   └─ DockviewReact → 每 panel 渲染 <TerminalView termId>
   └─ <MemoryPanel>                    # 右栏
       ├─ <ProjectSelector>            # 切换 memory 作用域
       ├─ <SearchBox>
       └─ <MemoryCard draggable> × N
```

---

## 3. 三栏 + dockview 布局

### 3.1 外层三栏（allotment）

```tsx
// App.tsx
import { Allotment } from "allotment";
import "allotment/dist/style.css";

export default function App() {
  return (
    <Allotment onDragEnd={persistSizes} defaultSizes={loadSizes()}>
      <Allotment.Pane minSize={180} preferredSize={240} snap>
        <SkillPanel />
      </Allotment.Pane>
      <Allotment.Pane>           {/* 中栏自适应 */}
        <TerminalDock />
      </Allotment.Pane>
      <Allotment.Pane minSize={180} preferredSize={240} snap>
        <MemoryPanel />
      </Allotment.Pane>
    </Allotment>
  );
}
```

- `snap` 让侧栏可拖到很窄时自动折叠；宽度变化写入配置。

### 3.2 中栏 dockview（标签页 + 分屏）

```tsx
// TerminalDock.tsx
import { DockviewReact, DockviewReadyEvent } from "dockview";
import "dockview/dist/styles/dockview.css";

const components = { terminal: TerminalPanel };  // panel 类型 → React 组件

function onReady(e: DockviewReadyEvent) {
  // 恢复上次布局；否则建默认两个终端面板
  const saved = loadDockLayout();
  if (saved) e.api.fromJSON(saved);
  else {
    e.api.addPanel({ id: t1, component: "terminal", title: "终端1",
                     params: { termId: t1, profile: "claude" } });
    e.api.addPanel({ id: t2, component: "terminal", title: "终端2",
                     params: { termId: t2, profile: "claude" },
                     position: { referencePanel: t1, direction: "right" } }); // 右分屏
  }
  e.api.onDidLayoutChange(() => persistDockLayout(e.api.toJSON()));
}

export function TerminalDock() {
  return <DockviewReact components={components} onReady={onReady} />;
}

// 每个 panel 的外壳，承载一个终端
function TerminalPanel(props: IDockviewPanelProps<{ termId: string; profile: string }>) {
  return <TerminalView termId={props.params.termId} profile={props.params.profile} />;
}
```

- dockview 原生支持：标签页拖动、左右/上下分屏、面板拖出重排；`toJSON/fromJSON` 做布局持久化。
- "+" 新建终端：调用 `api.addPanel`，弹出 Profile 选择（Claude / Codex / PowerShell / Bash）。

---

## 4. 终端组件（xterm 集成）

`TerminalView` 是核心：管理一个 xterm 实例的全生命周期，并与后端 PTY 双向桥接。

```tsx
// TerminalView.tsx
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

export function TerminalView({ termId, profile }: { termId: string; profile: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({ fontFamily: "Cascadia Code, monospace",
                                fontSize: 13, cursorBlink: true, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    try { term.loadAddon(new WebglAddon()); } catch { /* 回退 canvas */ }
    term.open(ref.current!);
    fit.fit();

    // 1) 后端 → 前端：Channel 接收 PTY 输出
    const onOutput = new Channel<number[] | Uint8Array>();
    onOutput.onmessage = (bytes) => term.write(new Uint8Array(bytes));

    // 2) 创建 PTY（把 Channel 传给后端）
    invoke("create_terminal", {
      id: termId,
      opts: buildSpawnOptions(profile),   // shell/cwd/env/cols/rows/launch_cmd
      onOutput,
    });

    // 3) 前端 → 后端：用户输入
    const dataSub = term.onData((data) => invoke("write_terminal", { id: termId, data }));

    // 4) 尺寸：容器变化 → fit → 通知后端
    const ro = new ResizeObserver(() => {
      fit.fit();
      invoke("resize_terminal", { id: termId, cols: term.cols, rows: term.rows });
    });
    ro.observe(ref.current!);

    // 5) 注册为拖放落点（见 §6）
    const dropCleanup = registerDropTarget(ref.current!, termId);

    return () => {
      dataSub.dispose(); ro.disconnect(); dropCleanup();
      invoke("close_terminal", { id: termId });
      term.dispose();
    };
  }, [termId]);

  return <div ref={ref} className="h-full w-full" data-term-id={termId} />;
}
```

要点：
- **WebGL 渲染**：claude TUI 重绘频繁，WebGL addon 显著降卡顿；失败回退 canvas。
- **ResizeObserver + FitAddon**：分屏/拖动改变面板尺寸时自动重排，并同步 PTY 的 cols/rows，避免 claude 排版错乱。
- **生命周期**：panel 关闭 → 组件卸载 → `close_terminal` 杀后端进程，防泄漏。
- **复制粘贴**：xterm 选区复制 + `Ctrl+Shift+V` 粘贴（走 `navigator.clipboard` + `term.paste`）。

---

## 5. Skill / Memory 面板

```tsx
// SkillPanel.tsx
export function SkillPanel() {
  const skills = useCatalog((s) => s.skills);          // zustand
  const [q, setQ] = useState("");
  const fuse = useMemo(() => new Fuse(skills,
      { keys: ["name", "description"], threshold: 0.4 }), [skills]);
  const list = q ? fuse.search(q).map((r) => r.item) : skills;

  return (
    <div className="flex flex-col h-full">
      <SearchBox value={q} onChange={setQ} placeholder="搜索 skill…" />
      <div className="overflow-y-auto">
        {list.map((sk) => <SkillCard key={sk.path} skill={sk} />)}
      </div>
    </div>
  );
}

// SkillCard.tsx —— 拖拽源
function SkillCard({ skill }: { skill: Skill }) {
  function onDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("application/x-htybox-item",
      JSON.stringify({ kind: "skill", skill }));
    e.dataTransfer.effectAllowed = "copy";
  }
  return (
    <div draggable onDragStart={onDragStart} className="card" title={skill.description}>
      <span className="name">{skill.name}</span>
      <Badge source={skill.source} />               {/* user/project/plugin 徽标 */}
      <p className="desc">{skill.description}</p>
    </div>
  );
}
```

- `MemoryPanel` / `MemoryCard` 同构，徽标改为 `mem_type`（user/feedback/project/reference）。
- `MemoryPanel` 顶部 `ProjectSelector`：切换当前项目 → 触发 `list_memories(projectPath)` 重新加载（作用域问题见 [04](./04-数据模型与注入.md)）。

---

## 6. 拖拽注入（前端侧）

落点是 `TerminalView` 的容器 div。`registerDropTarget` 处理拖放高亮与投递：

```ts
function registerDropTarget(el: HTMLElement, termId: string) {
  const onOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("application/x-htybox-item")) {
      e.preventDefault();                 // 允许 drop
      e.dataTransfer.dropEffect = "copy";
      el.classList.add("drop-hover");     // 高亮该面板
    }
  };
  const onLeave = () => el.classList.remove("drop-hover");
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); el.classList.remove("drop-hover");
    const raw = e.dataTransfer!.getData("application/x-htybox-item");
    const item = JSON.parse(raw);
    const submit = e.shiftKey;            // 按住 Shift 落下 = 自动回车发送
    invoke("inject_item", { termId, item, submit });
  };
  el.addEventListener("dragover", onOver);
  el.addEventListener("dragleave", onLeave);
  el.addEventListener("drop", onDrop);
  return () => { /* removeEventListener ... */ };
}
```

- **分屏命中**：每个 pane 是独立 drop target，落到哪个 pane 就注入哪个终端，并整面板高亮明确反馈。
- **自动发送**：默认只注入文本不回车（用户可在终端里确认/补充后再回车）；按住 **Shift** 落下则追加 `\r` 直接发送。该默认值可在设置里改。
- 注入文本由后端按目标 Profile 生成（前端只传 item + termId），保证"智能引用"逻辑单一来源。

---

## 7. 状态管理（Zustand）

```ts
// store/catalog.ts
interface CatalogState {
  skills: Skill[];
  memories: MemoryItem[];
  currentProject: string;                 // memory 作用域
  refreshSkills(): Promise<void>;          // invoke list_skills
  refreshMemories(): Promise<void>;        // invoke list_memories(currentProject)
  setProject(p: string): void;
}

// store/settings.ts —— 镜像后端持久化配置（布局尺寸、profiles、注入默认值…）
```

- 启动时拉一次 catalog；监听后端 `catalog-updated` 事件 → 调用对应 `refresh*`。
- 终端面板状态（哪些 termId、profile）由 dockview 的 layout JSON 承载，无需重复存。

---

## 8. IPC 封装层

`src/ipc/` 收口所有与 Rust 的交互，组件不直接散用 `invoke`：

```ts
// ipc/terminal.ts
export const createTerminal = (id, opts, onOutput: Channel) =>
  invoke("create_terminal", { id, opts, onOutput });
export const writeTerminal = (id, data) => invoke("write_terminal", { id, data });
export const resizeTerminal = (id, cols, rows) => invoke("resize_terminal", { id, cols, rows });
export const closeTerminal = (id) => invoke("close_terminal", { id });

// ipc/catalog.ts
export const listSkills = () => invoke<Skill[]>("list_skills");
export const listMemories = (projectPath: string) => invoke<MemoryItem[]>("list_memories", { projectPath });
export const injectItem = (termId, item, submit) => invoke("inject_item", { termId, item, submit });

// ipc/events.ts
import { listen } from "@tauri-apps/api/event";
export const onCatalogUpdated = (cb) => listen("catalog-updated", cb);
```

- TS 类型从 `src/types/`（与 Rust serde 结构手动对齐；后续可用 `tauri-specta` 自动生成）。

---

## 9. 样式与主题

- Tailwind 做布局与卡片；xterm 用自带主题对象配色（深色为主）。
- 拖放高亮、focus 终端的边框高亮、来源/类型徽标颜色统一在 `styles/tokens`。
- 可选：跟随系统深浅色（Tauri `theme` API）。
