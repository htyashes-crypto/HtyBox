# HtyBox

> 把**多个终端**、**Claude Skill** 与 **Claude Memory** 整合到一个窗口的桌面工作台。
> 支持把 skill / memory **拖拽**喂给终端里运行的 Claude Code / Codex；并提供**多 Agent 团队协作**（可保存团队、一键开启、MCP 协作、崩溃自动替补）。

**技术栈**：Tauri 2 + Rust（`portable-pty`）+ React + TypeScript + xterm.js。

## 设计文档

完整设计与**可施工计划**在 [`Document/`](./Document/)（见 [文档索引](./Document/README.md)）：

| | |
|---|---|
| [01 产品与架构](./Document/01-产品与架构.md) | [02 后端 Rust](./Document/02-后端Rust设计.md) |
| [03 前端 React](./Document/03-前端React设计.md) | [04 数据模型与注入](./Document/04-数据模型与注入.md) |
| [05 里程碑 M0–M6](./Document/05-里程碑与任务拆解.md) | [06 风险/测试/打包](./Document/06-风险测试与打包.md) |
| [07 工作区管理](./Document/07-工作区管理.md) | [08 多 Agent 协作 M7](./Document/08-多Agent协作设计.md) |

界面 mockup：[`Document/svg/`](./Document/svg/)（6 张，深色 dev-tool 主题）。

## 状态

📋 **规划完成，尚未开始编码。** 下一步：按 [Document/05](./Document/05-里程碑与任务拆解.md) 的 **M0 脚手架** 起步，关键路径是 M1（单终端 PTY 跑通）。
