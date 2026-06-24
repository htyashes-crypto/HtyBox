# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本文件聚焦**命令**与**架构大图**（读多个文件才能拼出的部分）。项目通用铁律（API 必先查签名、`cargo` 只在 PowerShell 跑、写入分块、回复用简体中文、完工总结流程）见工作区 `..\.claude\CLAUDE.md`，不在此重复。

## 常用命令

在仓库根 `HtyBox/`（含 `package.json`）执行；包管理器是 **pnpm**（锁文件 `pnpm-lock.yaml`）：

| 命令 | 作用 |
|---|---|
| `pnpm install` | 装前端依赖 |
| `pnpm tauri dev` | **跑应用**（唯一入口）。Tauri 先执行 `beforeDevCommand: pnpm dev` 起 Vite（固定端口 1420），再编译 Rust 并拉起 WebView 窗口 |
| `pnpm dev` | 仅前端 Vite（很少单独用；纯前端调样式时可用） |
| `pnpm build` | `tsc && vite build` —— **类型检查 + 前端打包**，等同唯一的 lint/typecheck 手段 |
| `pnpm tauri build` | 出生产安装包（`bundle.targets: all`） |
| `cargo check` / `cargo build` | 在 `src-tauri/` 下单独验 Rust；**务必 PowerShell，勿用 Git Bash**（链接器冲突） |

- **没有测试**：仓库无任何 `#[test]` / 前端测试框架，故无"跑单测"命令。新增逻辑靠 `pnpm tauri dev` 手动验。
- **没有 ESLint 配置**：M0 文档提到要接但实际未落地；目前 lint 即 `tsc` 类型检查。

## 架构大图

Tauri 2 桌面应用，**两进程**经 IPC 协作：

- **Rust 后端**（`src-tauri/`，lib crate `htybox_app_lib`）持有所有原生资源：PTY 子进程、`~/.claude` 目录扫描、文件监听。入口 `main.rs` 仅调 `lib.rs::run()`；真正逻辑全在 `lib.rs` + 三个模块。
- **React 前端**（`src/`）是 WebView 里的 UI。
- **通信**：前端 `invoke("cmd", args)` → Rust `#[tauri::command]`；Rust 反向用 `emit(event)`（普通事件）和 `Channel<Vec<u8>>`（PTY 字节流）推回前端。

### IPC 命令面（改一处必须同步另一处）

所有命令在 `src-tauri/src/lib.rs` 的 `invoke_handler![...]` 注册，前端封装分散在 `src/catalog.ts` 与 `src/components/terminalEngine.ts`：

| 命令 / 事件 | 方向 | 后端实现 |
|---|---|---|
| `create_terminal`（带 `onOutput` Channel）/ `write_terminal` / `resize_terminal` / `close_terminal` | 前→后 | `pty.rs` `PtyManager` |
| `list_skills(projectDir?)` / `list_memories(slug)` / `list_projects()` | 前→后 | `catalog.rs` |
| `skills-changed` / `memory-changed` 事件 | 后→前 | `watcher.rs` |

> Rust 结构体用 `#[serde(rename_all = "camelCase")]`，故前端字段是 `memType`/`memoryCount`/`projectDir` 等小驼峰。

### 终端子系统（最易踩坑的一环）

- `pty.rs`：每终端 = 一对 `portable-pty` PTY + 子进程 + 一个**后台读线程**把原始字节经 `Channel` 推给前端；会话存在 `Mutex<HashMap<TermId, _>>`。Windows 走 ConPTY。
- `terminalEngine.ts`：**模块级注册表** `Map<termId, Engine>`，把 xterm 实例 + 后端 PTY 的生命周期**与 React/dockview 的挂载解耦**。
  - **为什么**：dockview 分屏/拖动重排时会卸载并重挂面板组件，若终端随 React 卸载就 dispose 会误杀 PTY。
  - 做法：xterm 挂在**游离 host 元素**上 —— `attachEngine`=塞进容器、`detachEngine`=移出但保留实例、`disposeEngine`=只有面板**真正关闭**时才结束 PTY。改终端相关代码时**切勿在 React unmount 里 dispose**。
- `TerminalDock.tsx`：dockview 宿主，每个 `DockTerminal` 面板绑定独立 `termId` + Profile；负责标签/分屏/重排，把布局持久化到 `localStorage["htybox.dock.layout.v1"]` 并在启动时恢复；面板移除 → `disposeEngine`。

### 拖拽注入闭环（核心功能）

1. **拖起**：`SkillPanel` / `MemoryPanel` 的卡片 `draggable`，在 `dataTransfer` 写 MIME `application/x-htybox-item`，载荷 `{kind, invoke?, path}`。
2. **落点**：`TerminalDock.tsx` 的 `DockTerminal` 监听 `drop`，读该 MIME，调用 `profiles.ts` 的 `injectText(item, agentKind)`。
3. **关键设计**：注入文本在**落点按目标终端的 `agentKind` 计算**（而非拖起时）。`injectText`：skill→ claude 用 `/name`、codex 用 `@path`、shell 用裸路径；memory→ `@path`（shell 用裸路径）。**落点按住 Shift** 会追加 `\r` 直接发送。
4. **陷阱**：`tauri.conf.json` 里 `"dragDropEnabled": false` 是必需的 —— 否则 Tauri 原生 OS 拖放会吞掉 WebView 的 HTML5 拖放（见 commit `8bd3c2d`）。

### Profile（`profiles.ts`）

`PROFILES` = PowerShell / Claude Code / Codex。各含 `shell` + 可选 `launchCmd`（如 `"claude\r"`）。claude/codex 的模式是"**先起 shell，等 ~600ms 出提示符后自动发 `launchCmd`**"（见 `terminalEngine.ts`）。`agentKind` 决定上面的注入格式。

### Skill / Memory 扫描与监听（`catalog.rs` + `watcher.rs`）

- **Skill** 扫三处：`~/.claude/skills/*/SKILL.md`（source=`user`）、`~/.claude/plugins/marketplaces/**/skills/*/SKILL.md`（source=`plugin:<名>`）、可选 `<projectDir>/.claude/skills/*/SKILL.md`（source=`project`）。解析 YAML frontmatter 取 name/description，推导 `invoke`（`/name` 或 `/plugin:name`）。
- **Memory**：`~/.claude/projects/<slug>/memory/*.md`，**排除索引 `MEMORY.md`**。`list_projects` 只列出含 ≥1 条 memory 的 slug。frontmatter 取 name/description/`metadata.type`。
- **监听**：`watcher.rs` 对 `~/.claude/{skills, plugins/marketplaces, projects}` 递归监听，500ms 防抖后 `emit` `skills-changed`/`memory-changed`，两个面板收到即 reload（见各自 `listen(...)`）。

### UI 外壳与样式

`App.tsx` = 顶部 workspace 标签栏（**占位**，M2.5 实装）+ 三栏 `allotment`（SkillPanel ｜ TerminalDock ｜ MemoryPanel）+ 底部状态栏。样式用 Tailwind v4（`@tailwindcss/vite` 插件，`index.css` 仅 `@import "tailwindcss"` + 少量全局/滚动条/拖放高亮）；配色是 Claude 奶油主题，色值**硬编码在 className 里**，终端面板内用暖深主题。

## 里程碑实现状态（README 已过时，以 git 历史为准）

代码注释用 M0–M7 标记。**已建**：M1 PTY、M2 dockview 多终端+分屏+布局持久化、M3 目录扫描、M3b 文件监听、M4 拖拽注入、M5 Profile。**未建**（设计在 `Document/`）：M2.5 工作区管理（顶部标签现为占位）、M6 打包、M7 多 Agent 协作（"多 Agent 协作"按钮现为占位，设计见 `Document/08`）。动工前先读 `Document/`（README.md 是索引）。
