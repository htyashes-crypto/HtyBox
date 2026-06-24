mod broker;
mod catalog;
mod pty;
mod watcher;

use std::sync::Arc;

use pty::{PtyManager, SpawnOptions};
use tauri::ipc::Channel;
use tauri::State;

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

#[tauri::command]
fn list_projects() -> Vec<catalog::ProjectRef> {
    catalog::list_projects()
}

/// M7-A：返回本地 MCP broker 的端点 URL（agent 的 .mcp.json 指向它）。
#[tauri::command]
fn mcp_broker_url(state: State<'_, AppState>) -> String {
    format!("http://127.0.0.1:{}/mcp", state.broker.port())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let broker = broker::start();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pty: PtyManager::default(),
            broker,
        })
        .setup(|app| {
            watcher::start(app.handle().clone());
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
            list_projects,
            mcp_broker_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
