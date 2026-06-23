# 02 · 后端 Rust 设计

后端职责：管理 PTY（伪终端）子进程、扫描并解析 skill/memory 目录、监听文件变更、按终端 Profile 生成注入文本，并通过 Tauri 命令与事件/Channel 跟前端通信。

---

## 1. Cargo 依赖

`src-tauri/Cargo.toml`（版本以实现时的最新稳定版为准，下面给出主版本）：

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"            # 配置持久化
portable-pty = "0.8"               # 跨平台 PTY（Windows 走 ConPTY）
notify = "6"                        # 文件监听
notify-debouncer-full = "0.3"      # 监听事件防抖
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"                 # 解析 frontmatter YAML
walkdir = "2"                      # 递归扫描目录
dirs = "5"                         # 定位 ~/.claude（跨平台 home）
thiserror = "1"                    # 错误类型
anyhow = "1"                       # 命令层错误聚合
parking_lot = "0.12"              # 高性能 Mutex/RwLock
once_cell = "1"
```

> frontmatter 解析也可用 `gray_matter` crate；但用 `serde_yaml` + 手动切分 `---` 块更可控，推荐后者。

---

## 2. 模块划分

```
src-tauri/src/
├─ main.rs        # Tauri builder：注册 state / commands / plugins
├─ state.rs       # AppState：聚合 PtyManager + Catalog 缓存 + 配置
├─ error.rs       # AppError（thiserror）+ Result 别名，命令统一返回
├─ pty/
│  ├─ mod.rs      # PtyManager
│  └─ session.rs  # PtySession：单个 PTY + 子进程 + reader 线程
├─ catalog/
│  ├─ mod.rs      # 扫描入口 + 缓存
│  ├─ skill.rs    # Skill 模型 + 发现规则 + 解析
│  └─ memory.rs   # MemoryItem 模型 + 发现规则 + slug + 解析
├─ watcher.rs     # notify 监听 + 防抖 + emit catalog-updated
├─ inject.rs      # 注入模板矩阵（profile × item → text）
└─ commands.rs    # 所有 #[tauri::command]
```

---

## 3. PTY 管理器

### 3.1 数据结构

```rust
// pty/mod.rs
pub type TermId = String;                   // 前端生成的 uuid

pub struct PtyManager {
    sessions: parking_lot::Mutex<HashMap<TermId, PtySession>>,
}

// pty/session.rs
pub struct PtySession {
    writer: Box<dyn Write + Send>,          // 写子进程 stdin
    master: Box<dyn MasterPty + Send>,      // 用于 resize
    child:  Box<dyn Child + Send + Sync>,   // 子进程句柄，用于 kill/wait
    // reader 线程 handle 可选保存以便 join
}
```

### 3.2 创建终端

```rust
pub struct SpawnOptions {
    pub shell: String,            // 例: "powershell.exe" / "pwsh.exe" / "bash"
    pub args: Vec<String>,
    pub cwd: String,              // 终端工作目录（决定该终端的项目上下文）
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
    pub launch_cmd: Option<String>, // 启动后自动发送的命令，如 "claude\r"
}

impl PtyManager {
    pub fn spawn(
        &self,
        id: TermId,
        opts: SpawnOptions,
        on_output: tauri::ipc::Channel<Vec<u8>>,  // 输出流推回前端
    ) -> Result<(), AppError> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: opts.rows, cols: opts.cols, pixel_width: 0, pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(&opts.shell);
        cmd.args(&opts.args);
        cmd.cwd(&opts.cwd);
        for (k, v) in &opts.env { cmd.env(k, v); }

        let child = pair.slave.spawn_command(cmd)?;
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        // reader 线程：阻塞读 PTY，按块通过 Channel 推到前端
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,                         // EOF：进程退出
                    Ok(n) => { let _ = on_output.send(buf[..n].to_vec()); }
                    Err(_) => break,
                }
            }
            // 可再 emit 一个 "terminal-exited" 事件通知前端
        });

        let mut session = PtySession { writer, master: pair.master, child };
        // 可选：注入启动命令（如自动起 claude）
        if let Some(cmd) = opts.launch_cmd {
            session.writer.write_all(cmd.as_bytes())?;
        }
        self.sessions.lock().insert(id, session);
        Ok(())
    }

    pub fn write(&self, id: &TermId, data: &[u8]) -> Result<(), AppError> {
        let mut map = self.sessions.lock();
        let s = map.get_mut(id).ok_or(AppError::NoSuchTerminal)?;
        s.writer.write_all(data)?;
        s.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &TermId, cols: u16, rows: u16) -> Result<(), AppError> {
        let map = self.sessions.lock();
        let s = map.get(id).ok_or(AppError::NoSuchTerminal)?;
        s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
        Ok(())
    }

    pub fn close(&self, id: &TermId) -> Result<(), AppError> {
        if let Some(mut s) = self.sessions.lock().remove(id) {
            let _ = s.child.kill();
        }
        Ok(())
    }
}
```

> **为什么用 Channel 推输出**：Tauri 2 的 `tauri::ipc::Channel<T>` 是为高吞吐流式数据设计的，序列化开销小、点对点不广播。每个终端在 `create_terminal` 时由前端创建一个 Channel 传入，reader 线程往里 `send` 字节块。

### 3.3 Windows 注意事项（ConPTY）

- `portable-pty` 在 Windows 自动选用 **ConPTY**（Win10 1809+ 支持；目标机 Win10 19045 满足）。
- 启动 `claude` / `codex`：它们通常是 npm 全局安装的 `.cmd` 脚本，**直接当 exe 启动可能找不到**。推荐做法：
  - **PTY 内先起 shell**（如 `powershell.exe`），再通过 `launch_cmd` 自动发送 `claude\r`。这样命令解析交给 shell，规避 `.cmd` 解析问题，也更贴近用户真实用法。
- 字节流按 **UTF-8** 处理；xterm 端用 UTF-8 解码。注意 claude 的 TUI 含大量 ANSI 转义与重绘，reader 不要按行缓冲、要按块原样转发。
- 子进程退出后及时 `remove` 会话并通知前端关闭对应面板。

---

## 4. 目录扫描与解析（Catalog）

### 4.1 数据模型（与前端 TS 对齐）

```rust
#[derive(Serialize, Clone)]
pub struct Skill {
    pub name: String,          // frontmatter.name
    pub description: String,    // frontmatter.description
    pub path: String,           // SKILL.md 绝对路径
    pub source: SkillSource,    // 来源
    pub invoke: String,         // 推导出的调用串: "/name" 或 "/plugin:name"
}

#[derive(Serialize, Clone)]
pub enum SkillSource { User, Project, Plugin { plugin: String } }

#[derive(Serialize, Clone)]
pub struct MemoryItem {
    pub name: String,
    pub description: String,
    pub mem_type: String,       // metadata.type: user|feedback|project|reference
    pub path: String,           // 绝对路径
    pub project_slug: String,
}
```

### 4.2 发现规则（详见 [04](./04-数据模型与注入.md)）

- **Skill** 扫描三类根目录下的 `*/SKILL.md`：
  1. `~/.claude/skills/`（User）
  2. `<当前项目>/.claude/skills/`（Project）
  3. `~/.claude/plugins/marketplaces/**/skills/*/SKILL.md`（Plugin）
- **Memory** 扫描 `~/.claude/projects/<slug>/memory/*.md`（排除 `MEMORY.md` 索引文件本身，或单独解析它）。

### 4.3 frontmatter 解析

```rust
/// 解析以 `---` 包裹的 YAML frontmatter，返回 (frontmatter_value, body)
fn parse_frontmatter(content: &str) -> Option<(serde_yaml::Value, &str)> {
    let rest = content.strip_prefix("---")?;          // 必须以 --- 开头
    let end = rest.find("\n---")?;                     // 找到结束分隔
    let yaml = &rest[..end];
    let body = &rest[end + 4..];
    let value: serde_yaml::Value = serde_yaml::from_str(yaml).ok()?;
    Some((value, body))
}
```

- Skill：从 `value["name"]` / `value["description"]` 取值；缺失则用目录名兜底。
- Memory：取 `name` / `description` / `metadata.type`；解析失败的文件**跳过但记录日志**，不让单个坏文件拖垮整个列表。

### 4.4 缓存

`Catalog` 在 `AppState` 里持有一份 `RwLock<CatalogCache>`，扫描结果缓存其中；命令直接读缓存，watcher 触发时重扫并替换。

---

## 5. 文件监听（Watcher）

```rust
// watcher.rs
pub fn start(app: tauri::AppHandle, roots: Vec<PathBuf>) {
    let mut debouncer = new_debouncer(Duration::from_millis(400), move |res| {
        if let Ok(_events) = res {
            // 1) 重扫相关根目录 -> 更新 Catalog 缓存
            // 2) app.emit("catalog-updated", &payload) 通知前端
        }
    }).unwrap();
    for r in roots {
        let _ = debouncer.watcher().watch(&r, RecursiveMode::Recursive);
    }
    // 把 debouncer 存入 state 防止被 drop
}
```

- 防抖 400ms，避免编辑器保存触发的连续事件刷屏。
- payload 可区分 `skills` / `memories` 两类，前端按需局部刷新。

---

## 6. Tauri 命令清单

`commands.rs`，全部 `#[tauri::command]` 并在 `main.rs` 的 `invoke_handler` 注册：

| 命令 | 签名（简化） | 说明 |
|---|---|---|
| `create_terminal` | `(id, opts: SpawnOptions, on_output: Channel<Vec<u8>>) -> Result<()>` | 创建 PTY 并开始流式输出 |
| `write_terminal` | `(id, data: String) -> Result<()>` | 写用户输入到 PTY |
| `resize_terminal` | `(id, cols, rows) -> Result<()>` | 调整 PTY 尺寸 |
| `close_terminal` | `(id) -> Result<()>` | 杀子进程、清理会话 |
| `list_skills` | `() -> Result<Vec<Skill>>` | 返回扫描到的 skill |
| `list_memories` | `(project_path: String) -> Result<Vec<MemoryItem>>` | 返回该项目的 memory |
| `list_projects` | `() -> Result<Vec<ProjectRef>>` | 列出 `~/.claude/projects/*` 供切换 |
| `inject_item` | `(term_id, item: InjectPayload, submit: bool) -> Result<()>` | 按 Profile 生成注入文本并写 PTY |
| `read_item_body` | `(path: String) -> Result<String>` | 卡片悬停/点击预览正文（可选） |
| `get_config` / `set_config` | `() / (cfg)` | 读写持久化配置 |

> `inject_item` 内部调用 `inject::build_text(profile, item)`（见 [04](./04-数据模型与注入.md)），再走 `PtyManager.write`，`submit` 为真时追加 `"\r"`。

---

## 7. 应用状态与启动装配

```rust
// state.rs
pub struct AppState {
    pub pty: PtyManager,
    pub catalog: RwLock<CatalogCache>,
    pub config: RwLock<AppConfig>,
}

// main.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .setup(|app| {
            let roots = resolve_watch_roots(app);     // skills + 当前项目 memory
            watcher::start(app.handle().clone(), roots);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_terminal, write_terminal, resize_terminal, close_terminal,
            list_skills, list_memories, list_projects, inject_item,
            read_item_body, get_config, set_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HtyBox");
}
```

## 8. 错误处理

- 定义 `AppError`（`thiserror`），实现 `serde::Serialize`，使命令可把错误结构化返回前端（前端弹 toast）。
- 单个终端/单个文件的失败要**隔离**：一个终端崩溃不影响其它终端；一个坏 frontmatter 不影响整张目录。

---

## 9. Tauri 2 权限（capabilities）

Tauri 2 默认最小权限。需在 `src-tauri/capabilities/default.json` 放开：
- `store` 插件读写权限；
- 若用到 `dialog`（选项目目录）等插件，按需加。
- 自定义命令默认通过 `invoke_handler` 暴露，无需额外 ACL，但仍建议在 capability 里收敛窗口范围。
