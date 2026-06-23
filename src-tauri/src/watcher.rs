//! 监听 skill / memory 目录，防抖后向前端发刷新事件（M3b）。

use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use tauri::{AppHandle, Emitter};

pub fn start(app: AppHandle) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let claude = home.join(".claude");

    let handler_app = app.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: DebounceEventResult| {
            let Ok(events) = res else {
                return;
            };
            let mut skills = false;
            let mut memory = false;
            for e in &events {
                let p = e.path.to_string_lossy().replace('\\', "/");
                if p.contains("/.claude/skills/") || p.contains("/plugins/") {
                    skills = true;
                }
                if p.contains("/projects/") && p.contains("/memory/") {
                    memory = true;
                }
            }
            if skills {
                let _ = handler_app.emit("skills-changed", ());
            }
            if memory {
                let _ = handler_app.emit("memory-changed", ());
            }
        },
    );

    let Ok(mut debouncer) = debouncer else {
        return;
    };
    let w = debouncer.watcher();
    // 目录不存在时 watch 报错，忽略即可
    let _ = w.watch(&claude.join("skills"), RecursiveMode::Recursive);
    let _ = w.watch(
        &claude.join("plugins").join("marketplaces"),
        RecursiveMode::Recursive,
    );
    let _ = w.watch(&claude.join("projects"), RecursiveMode::Recursive);

    // 保活到进程结束：drop 会停止监听
    std::mem::forget(debouncer);
}
