# HtyBox 设计与实现计划

> 一个把**多个终端**、**Claude Skill 列表**、**Claude Memory 列表**整合到同一窗口的桌面工作台。
> 核心交互：把左侧 Skill 或右侧 Memory **拖拽**到任意终端，自动向该终端里正在运行的 Claude Code / Codex 注入对应的引用（`/skill-name` 或 `@文件路径`）。

---

## 1. 这是什么

HtyBox 解决的痛点：使用 Claude Code / Codex 时，技能（skill）和记忆（memory）散落在 `~/.claude` 的目录里，每次想"喂"给某个会话都要手敲 `/xxx` 或贴路径。HtyBox 把它们做成可视化、可搜索的卡片，**拖一下就注入到对应终端**，并且支持多终端并排/标签页协作。

界面三栏（与原型一致）：

```
┌──────────┬────────────────────────────────────┬──────────┐
│  Skills  │   [终端1] [终端2] [+]   ← 标签页     │  Memory  │
│  ┌────┐  │  ┌───────────────┬───────────────┐  │  ┌────┐  │
│  │搜索│  │  │               │               │  │  │列表│  │
│  └────┘  │  │   terminal    │   terminal    │  │  └────┘  │
│  • skill │  │   (xterm.js)  │   (split)     │  │  • mem   │
│  • skill │  │               │               │  │  • mem   │
│  • skill │  │               │               │  │  • mem   │
│ (拖拽源) │  └───────────────┴───────────────┘  │ (拖拽源) │
└──────────┴────────────────────────────────────┴──────────┘
   可调宽            dockview 标签+分屏            可调宽
```

---

## 2. 三项已确认的关键决策

| 决策 | 选择 | 含义 |
|---|---|---|
| **技术栈** | Tauri 2 + Rust + xterm.js | 包体 ~10MB、省内存；PTY 用 Rust 的 `portable-pty`（Windows 走 ConPTY） |
| **注入方式** | 智能引用 | 拖 Skill → 注入 `/skill-name`；拖 Memory → 注入 `@绝对路径`；按终端类型自适应 |
| **终端形态** | 标签页 + 分屏 | 用 `dockview` 实现，可开多标签、可左右/上下分屏、可拖动重排 |

---

## 3. 文档索引

| 文档 | 内容 |
|---|---|
| [01-产品与架构.md](./01-产品与架构.md) | 产品目标、功能清单、整体架构图、数据流、仓库目录结构 |
| [02-后端Rust设计.md](./02-后端Rust设计.md) | Cargo 依赖、PTY 管理器、目录扫描/解析/监听、Tauri 命令清单、Channel 流式输出 |
| [03-前端React设计.md](./03-前端React设计.md) | 组件树、三栏+dockview 布局、xterm 集成、Zustand 状态、IPC 封装 |
| [04-数据模型与注入.md](./04-数据模型与注入.md) | Skill/Memory 数据模型、目录发现规则、项目 slug 算法、注入模板矩阵、终端 Profile、配置文件 |
| [05-里程碑与任务拆解.md](./05-里程碑与任务拆解.md) | M0–M6 里程碑、每阶段任务清单与验收标准、关键路径 |
| [06-风险测试与打包.md](./06-风险测试与打包.md) | 风险表与缓解、测试策略、打包分发、开发环境搭建 |
| [07-工作区管理.md](./07-工作区管理.md) | 工作区=团队容器；切换时 PTY 后台常驻；数据模型、UI、作用域、里程碑(M2.5) |
| [08-多Agent协作设计.md](./08-多Agent协作设计.md) | 多 Agent 协作：**Team 配置/团队库/一键开启 + 配置 GUI**；MCP 中枢 + 主控-工人 + 全自动接力 + 共享目录护栏；身份/唤醒/裁判/编排/崩溃自愈/里程碑(M7+任务清单) |

> 建议实现顺序：先读 01 建立全局认知 → 按 05 的里程碑推进（含 07 的 M2.5、08 的 M7）→ 编码时查 02/03/04 的细节。07/08 是设计讨论后追加的功能设计；08 的多 Agent 关键决策已闭合为可施工计划（M7 任务清单见 §14.1）。

**界面 Mockup**（深色 dev-tool 主题）见 [`svg/`](./svg/)：`workspace-main`（主工作区）· `team-library`（团队库/一键开启）· `team-editor`（Team 配置）· `orchestration-running`（运行编排面板）· `mcp-dashboard` / `mcp-dashboard-recovery`（MCP 仪表盘 + 崩溃自愈态）。VSCode 右键 SVG → `Open Preview` 预览。

---

## 4. 开发环境前置（给实现者）

| 工具 | 用途 | 安装 |
|---|---|---|
| Rust (stable) + Cargo | Tauri 后端 | https://rustup.rs |
| Node.js 20+ + pnpm | 前端构建 | `winget install OpenJS.NodeJS` + `npm i -g pnpm` |
| Tauri CLI 2.x | 脚手架/构建 | `pnpm add -D @tauri-apps/cli` |
| Visual Studio Build Tools (C++) | Windows 编译 Rust/Tauri 依赖 | VS Installer 勾选"使用 C++ 的桌面开发" |
| WebView2 Runtime | Tauri 渲染层（Win10/11 多已自带） | https://developer.microsoft.com/microsoft-edge/webview2 |

快速起步（脚手架细节见 [05](./05-里程碑与任务拆解.md) 的 M0）：

```powershell
pnpm create tauri-app@latest    # 选 React + TypeScript + Vite
cd HtyBox
pnpm install
pnpm tauri dev
```

---

## 5. 当前状态

📋 **规划阶段** — 本目录仅含设计文档，尚未开始编码。

- 基础应用（多终端 + skill/memory + 拖拽注入）：设计完成，下一步从 [05 里程碑](./05-里程碑与任务拆解.md) 的 **M0 脚手架** 启动。
- 工作区管理（[07](./07-工作区管理.md)）：设计完成。
- 多 Agent 协作（[08](./08-多Agent协作设计.md)）：**可施工计划** —— 关键决策（团队配置/通信/唤醒/文件安全/崩溃自愈/仪表盘/身份/并行/预算/模型/编排强度）已全部闭合，M7 各阶段任务清单见 [08 §14.1]；剩余仅实现期实测项。
