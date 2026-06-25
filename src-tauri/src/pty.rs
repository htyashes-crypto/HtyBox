//! 单终端 PTY 管理（M1）。
//! 每个终端 = 一对 PTY + 子进程；reader 线程把输出经 Channel 流给前端。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

pub type TermId = String;

/// 前端创建终端时传入的参数（M1 仅最小集）。
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    /// 启动的 shell；缺省按平台选默认。
    pub shell: Option<String>,
    /// 工作目录；缺省用用户主目录。
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// per-terminal 环境变量（M7-A：注入 agent 身份 HTYBOX_MCP_TOKEN / HTYBOX_AGENT_ID 等）。
    pub env: Option<HashMap<String, String>>,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<TermId, PtySession>>,
    app: Mutex<Option<AppHandle>>, // setup 后注入：子进程退出时 emit "terminal-exit"(崩溃自愈检测)
}

impl PtyManager {
    /// setup 后注入 AppHandle，使 reader 线程能在子进程退出时通知前端。
    pub fn set_app(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// 起一个 PTY 子进程，并在后台线程把输出推给 `on_output`。
    pub fn spawn(
        &self,
        id: TermId,
        opts: SpawnOptions,
        on_output: Channel<Vec<u8>>,
    ) -> Result<(), String> {
        let cols = if opts.cols == 0 { 80 } else { opts.cols };
        let rows = if opts.rows == 0 { 24 } else { opts.rows };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty: {e}"))?;

        let shell = opts
            .shell
            .filter(|s| !s.is_empty())
            .unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&shell);
        match opts.cwd.filter(|c| !c.is_empty()) {
            Some(cwd) => cmd.cwd(cwd),
            None => {
                if let Some(home) = home_dir() {
                    cmd.cwd(home);
                }
            }
        }

        // per-terminal 环境变量（agent 身份）；继承父进程环境 + 叠加这些
        if let Some(env) = opts.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn `{shell}`: {e}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer: {e}"))?;

        // 后台读线程：按块原样把字节转发到前端（xterm 自己处理半截 UTF-8）。
        let exit_app = self.app.lock().unwrap().clone();
        let exit_id = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break, // EOF 或读错误 → 子进程结束
                    Ok(n) => {
                        if on_output.send(buf[..n].to_vec()).is_err() {
                            return; // 前端通道关闭(刷新等) → 非崩溃，不发退出事件
                        }
                    }
                }
            }
            // 子进程退出 → 通知前端(崩溃自愈检测)；用户主动关闭由前端按"已知关闭"排除
            if let Some(app) = exit_app {
                let _ = app.emit("terminal-exit", &exit_id);
            }
        });

        self.sessions.lock().unwrap().insert(
            id,
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        let s = map.get_mut(id).ok_or("no such terminal")?;
        s.writer.write_all(data).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.sessions.lock().unwrap();
        let s = map.get(id).ok_or("no such terminal")?;
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(id) {
            let _ = s.child.kill();
        }
        Ok(())
    }
}

fn default_shell() -> String {
    if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    }
}

fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
}
