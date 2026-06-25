mod broker;
mod catalog;
mod fs_tree;
mod pty;
mod sessions;
mod watcher;

use std::sync::Arc;

use pty::{PtyManager, SpawnOptions};
use tauri::ipc::Channel;
use tauri::{Manager, State};

struct AppState {
    pty: PtyManager,
    broker: Arc<broker::Broker>,
}

#[tauri::command]
fn create_terminal(
    state: State<'_, AppState>,
    id: String,
    opts: SpawnOptions,
    on_output: Channel<Vec<u8>>,
) -> Result<(), String> {
    state.pty.spawn(id, opts, on_output)
}

#[tauri::command]
fn write_terminal(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    state.pty.write(&id, data.as_bytes())
}

#[tauri::command]
fn resize_terminal(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(&id, cols, rows)
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.pty.close(&id)
}

#[tauri::command]
fn list_skills(project_dir: Option<String>) -> Vec<catalog::Skill> {
    catalog::scan_skills(project_dir.as_deref())
}

#[tauri::command]
fn list_project_skills(project_dir: String) -> Vec<catalog::Skill> {
    catalog::scan_project_skills(&project_dir)
}

#[tauri::command]
fn list_memories(slug: String) -> Vec<catalog::MemoryItem> {
    catalog::scan_memories(&slug)
}

/// M9：列某工作区记忆树（分级文件夹结构；隐藏 MEMORY.md/index_* 脚手架）。
#[tauri::command]
fn list_memory_tree(slug: String) -> Vec<catalog::MemoryNode> {
    catalog::scan_memory_tree(&slug)
}

#[tauri::command]
fn list_projects() -> Vec<catalog::ProjectRef> {
    catalog::list_projects()
}

/// M8：列工作区级 上架+下架 的全部 skill（带 enabled 标记）。
#[tauri::command]
fn list_managed_skills(project_dir: String) -> Vec<catalog::ManagedSkill> {
    catalog::scan_managed_skills(&project_dir)
}

/// M8：上架/下架单个 skill（在 .claude/skills ↔ .claude/downtime/skills 间移动文件夹）。
#[tauri::command]
fn set_skill_enabled(project_dir: String, dir: String, enabled: bool) -> Result<(), String> {
    catalog::set_skill_enabled(&project_dir, &dir, enabled)
}

/// M8：应用模板（dirs 全上架、其余全下架）；返回单项失败的 warnings（整体不报错）。
#[tauri::command]
fn apply_skill_template(project_dir: String, dirs: Vec<String>) -> Result<Vec<String>, String> {
    Ok(catalog::apply_skill_template(&project_dir, &dirs))
}

/// M8：列某目录的直接子项（文件树懒加载，一层）。
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<fs_tree::DirEntry>, String> {
    fs_tree::list_dir(&path)
}

/// M9：读文本文件（目录/二进制/超大 → editable=false）。
#[tauri::command]
fn read_text_file(path: String) -> Result<fs_tree::ReadTextResult, String> {
    fs_tree::read_text_file(&path)
}

/// M9：保存文本文件。
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs_tree::write_text_file(&path, &content)
}

/// M9：新建文件/文件夹。
#[tauri::command]
fn create_entry(parent_dir: String, name: String, is_dir: bool) -> Result<String, String> {
    fs_tree::create_entry(&parent_dir, &name, is_dir)
}

/// M9：同目录改名。
#[tauri::command]
fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    fs_tree::rename_entry(&path, &new_name)
}

/// M9：删除到回收站。
#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    fs_tree::delete_entry(&path)
}

/// M9：移动进目标目录。
#[tauri::command]
fn move_entry(src: String, dest_dir: String) -> Result<String, String> {
    fs_tree::move_entry(&src, &dest_dir)
}

/// M9：复制进目标目录。
#[tauri::command]
fn copy_entry(src: String, dest_dir: String) -> Result<String, String> {
    fs_tree::copy_entry(&src, &dest_dir)
}

/// M9：写 OS 拖入文件的字节到目标目录。
#[tauri::command]
fn import_dropped_file(dest_dir: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    fs_tree::import_dropped_file(&dest_dir, &name, bytes)
}

/// M9：在资源管理器中定位。
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    fs_tree::reveal_in_explorer(&path)
}

/// M9：递归列工作区所有文件（双击 Shift 全局搜索；排除噪声目录 + 忽略名单）。
#[tauri::command]
fn list_all_files(
    root: String,
    skip_folders: Vec<String>,
    skip_exts: Vec<String>,
) -> Vec<fs_tree::FileRef> {
    fs_tree::list_all_files(&root, skip_folders, skip_exts)
}

/// M9：列本工作区 claude 会话（取自 ~/.claude/history.jsonl，按 project==cwd）。
#[tauri::command]
fn list_claude_sessions(cwd: String) -> Vec<sessions::SessionRef> {
    sessions::list_claude_sessions(&cwd)
}

/// M9：列本工作区 codex 会话（~/.codex/sessions 按 session_meta.cwd）。
#[tauri::command]
fn list_codex_sessions(cwd: String) -> Vec<sessions::SessionRef> {
    sessions::list_codex_sessions(&cwd)
}

/// M9：删除 claude 会话（删 <id>.jsonl 入回收站）。
#[tauri::command]
fn delete_claude_session(id: String) -> Result<(), String> {
    sessions::delete_claude_session(&id)
}

/// M9：删除 codex 会话（删 rollout 文件入回收站）。
#[tauri::command]
fn delete_codex_session(path: String) -> Result<(), String> {
    sessions::delete_codex_session(&path)
}

/// M7-A：返回本地 MCP broker 的端点 URL（agent 的 .mcp.json 指向它）。
#[tauri::command]
fn mcp_broker_url(state: State<'_, AppState>) -> String {
    format!("http://127.0.0.1:{}/mcp", state.broker.port())
}

/// M7-F：宿主 UI(运行面板/仪表盘)读取协作状态快照（花名册/任务/归属/黑板/工具流）。
#[tauri::command]
fn broker_snapshot(state: State<'_, AppState>) -> serde_json::Value {
    state.broker.snapshot()
}

/// M7-H：agent 终端退出(主动关/崩溃) → 按 token 从 broker 花名册注销该实例。
#[tauri::command]
fn agent_exited(state: State<'_, AppState>, token: String) {
    state.broker.unregister(&token);
}

/// 把 htybox 这个 MCP server **合并**进 `<cwd>/.mcp.json`（保留用户已有的 server，如 unity-mcp）。
/// 用 `${HTYBOX_MCP_TOKEN}` 占位，token 由每个终端进程的环境变量提供 → 一份配置可区分多 agent。
fn write_mcp_json(cwd: &str, url: &str) -> Result<(), String> {
    let path = std::path::Path::new(cwd).join(".mcp.json");
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    servers.as_object_mut().unwrap().insert(
        "htybox".to_string(),
        serde_json::json!({
            "type": "http",
            "url": url,
            "headers": { "Authorization": "Bearer ${HTYBOX_MCP_TOKEN}" }
        }),
    );
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty).map_err(|e| e.to_string())
}

/// 把 htybox 这个 MCP server **合并**进 `<cwd>/.codex/config.toml`（保留用户已有配置）。
/// codex 不读 .mcp.json，用 `[mcp_servers.htybox]` 的 url + bearer_token_env_var；token 走
/// `HTYBOX_MCP_TOKEN` 环境变量。仅在 codex 信任该项目时此文件才被加载。
fn write_codex_config(cwd: &str, url: &str) -> Result<(), String> {
    let dir = std::path::Path::new(cwd).join(".codex");
    let path = dir.join("config.toml");
    let mut doc: toml_edit::DocumentMut = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.parse::<toml_edit::DocumentMut>().ok())
        .unwrap_or_default();

    let root = doc.as_table_mut();
    if !root.contains_key("mcp_servers") {
        let mut servers = toml_edit::Table::new();
        servers.set_implicit(true); // 渲染成 [mcp_servers.htybox] 而非裸 [mcp_servers]
        root.insert("mcp_servers", toml_edit::Item::Table(servers));
    }
    let servers = root
        .get_mut("mcp_servers")
        .and_then(|i| i.as_table_mut())
        .ok_or_else(|| "mcp_servers 不是表".to_string())?;
    let mut htybox = toml_edit::Table::new();
    htybox.insert("url", toml_edit::value(url));
    htybox.insert("bearer_token_env_var", toml_edit::value("HTYBOX_MCP_TOKEN"));
    servers.insert("htybox", toml_edit::Item::Table(htybox));

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&path, doc.to_string()).map_err(|e| e.to_string())
}

/// M7-A：注册一个 agent（token→身份）并把 htybox 合并进该 cwd 的 .mcp.json。
/// 之后前端用 `HTYBOX_MCP_TOKEN=<token>` 等环境变量起该 agent 的终端。
#[tauri::command]
fn setup_mcp_agent(
    state: State<'_, AppState>,
    cwd: String,
    token: String,
    agent_id: String,
    role: String,
    role_name: String,
    workspace: String,
) -> Result<(), String> {
    state.broker.register(
        token,
        broker::AgentInfo {
            agent_id,
            role,
            role_name,
            workspace,
        },
    );
    let url = format!("http://127.0.0.1:{}/mcp", state.broker.port());
    write_mcp_json(&cwd, &url)?; // claude 读
    write_codex_config(&cwd, &url) // codex 读（信任项目时）
}

/// M7-C：写某 agent 的协作简报到 `<cwd>/.htybox/brief-<agentId>.md`。
/// agent 启动时用位置 prompt 先读它，从而获知角色/职责/协作协议/总目标（应用级协议，非 skill）。
#[tauri::command]
fn write_agent_brief(cwd: String, agent_id: String, content: String) -> Result<(), String> {
    let safe: String = agent_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let dir = std::path::Path::new(&cwd).join(".htybox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("brief-{safe}.md"));
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let broker = broker::start();
    let broker_for_setup = broker.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pty: PtyManager::default(),
            broker,
        })
        .setup(move |app| {
            watcher::start(app.handle().clone());
            broker_for_setup.set_app(app.handle().clone()); // M7-B：broker 可发 "agent-wake" 事件
            app.state::<AppState>().pty.set_app(app.handle().clone()); // M7-H：子进程退出 emit "terminal-exit"
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            list_skills,
            list_project_skills,
            list_memories,
            list_memory_tree,
            list_projects,
            list_managed_skills,
            set_skill_enabled,
            apply_skill_template,
            list_dir,
            read_text_file,
            write_text_file,
            create_entry,
            rename_entry,
            delete_entry,
            move_entry,
            copy_entry,
            import_dropped_file,
            reveal_in_explorer,
            list_all_files,
            list_claude_sessions,
            list_codex_sessions,
            delete_claude_session,
            delete_codex_session,
            mcp_broker_url,
            setup_mcp_agent,
            write_agent_brief,
            broker_snapshot,
            agent_exited
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
