mod catalog;
mod pty;
mod watcher;

use pty::{PtyManager, SpawnOptions};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Default)]
struct AppState {
    pty: PtyManager,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
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
            list_projects
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
