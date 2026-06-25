//! M9：列出/删除 claude & codex 的工作区会话（"会话记录"按钮）。已按官方文档 + CLI --help 实证：
//! - claude：会话存 ~/.claude/projects/<slug>/<id>.jsonl；标题取自 ~/.claude/history.jsonl(project==cwd 的 display)；
//!   复原 `claude --resume <id>`(须在该 cwd 下跑)；无原生删除 → 删 <id>.jsonl 文件。
//! - codex：会话 ~/.codex/sessions/Y/M/D/rollout-*.jsonl，首行 session_meta.payload{id,cwd}；
//!   复原 `codex resume <id>`；删除走删 rollout 文件。
//! 删除统一移入回收站(trash，非交互、可恢复)。

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionRef {
    pub id: String,
    pub label: String,
    pub ts: i64,      // 毫秒时间戳（排序/显示）
    pub path: String, // 会话文件路径（codex 删除用；claude 留空，按 id 查找）
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

const MAX_CODEX_SCAN: usize = 1200; // 最多扫描的 codex rollout 数（按文件名时间倒序）

/// claude：从 ~/.claude/history.jsonl 取本工作区(project==cwd)会话，标题=首条非斜杠提示，时间取最新。
pub fn list_claude_sessions(cwd: &str) -> Vec<SessionRef> {
    let Some(h) = home() else {
        return Vec::new();
    };
    let Ok(f) = std::fs::File::open(h.join(".claude").join("history.jsonl")) else {
        return Vec::new();
    };
    // sessionId -> (label, ts, label_still_slash)
    let mut map: HashMap<String, (String, i64, bool)> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if v.get("project").and_then(|p| p.as_str()) != Some(cwd) {
            continue;
        }
        let Some(id) = v.get("sessionId").and_then(|s| s.as_str()) else {
            continue;
        };
        let display = v
            .get("display")
            .and_then(|d| d.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let ts = v.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);
        let is_slash = display.is_empty() || display.starts_with('/');
        match map.entry(id.to_string()) {
            std::collections::hash_map::Entry::Vacant(slot) => {
                order.push(id.to_string());
                slot.insert((display, ts, is_slash));
            }
            std::collections::hash_map::Entry::Occupied(mut slot) => {
                let cur = slot.get_mut();
                if ts > cur.1 {
                    cur.1 = ts;
                }
                if cur.2 && !is_slash {
                    cur.0 = display;
                    cur.2 = false;
                }
            }
        }
    }
    let mut out: Vec<SessionRef> = order
        .into_iter()
        .filter_map(|id| {
            map.get(&id).map(|(label, ts, _)| SessionRef {
                label: if label.is_empty() {
                    "(无标题)".into()
                } else {
                    label.clone()
                },
                id: id.clone(),
                ts: *ts,
                path: String::new(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    out
}

/// 删除 claude 会话：① 在 ~/.claude/projects/*/ 下找 <id>.jsonl 移入回收站；
/// ② 从 ~/.claude/history.jsonl 移除该 sessionId 的行（否则列表源自 history，删后仍会显示）。
pub fn delete_claude_session(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("非法会话 id：{id}"));
    }
    let Some(h) = home() else {
        return Err("无 home 目录".into());
    };
    let claude = h.join(".claude");
    let mut did = false;
    // ① transcript 文件 → 回收站（best-effort）
    if let Ok(dirs) = std::fs::read_dir(claude.join("projects")) {
        let fname = format!("{id}.jsonl");
        for d in dirs.flatten() {
            let p = d.path().join(&fname);
            if p.is_file() {
                let _ = trash::delete(&p);
                did = true;
                break;
            }
        }
    }
    // ② history.jsonl 移除该 sessionId 的行（这才让它从列表消失）
    let hist = claude.join("history.jsonl");
    if let Ok(content) = std::fs::read_to_string(&hist) {
        let needle = format!("\"sessionId\":\"{id}\"");
        let kept: Vec<&str> = content.lines().filter(|l| !l.contains(&needle)).collect();
        if kept.len() != content.lines().count() {
            let mut out = kept.join("\n");
            if content.ends_with('\n') {
                out.push('\n');
            }
            std::fs::write(&hist, out).map_err(|e| e.to_string())?;
            did = true;
        }
    }
    if did {
        Ok(())
    } else {
        Err("未找到该会话".into())
    }
}

// ---------------- codex ----------------

fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_head_lines(path: &Path, max: usize) -> Vec<String> {
    let Ok(f) = std::fs::File::open(path) else {
        return Vec::new();
    };
    BufReader::new(f)
        .lines()
        .map_while(Result::ok)
        .take(max)
        .collect()
}

/// 从一行 codex rollout 取首个 input_text 文本。
fn extract_input_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let content = v.get("payload")?.get("content")?.as_array()?;
    for item in content {
        if item.get("type").and_then(|t| t.as_str()) == Some("input_text") {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// codex：扫 ~/.codex/sessions 的 rollout，session_meta.payload.cwd==cwd 的列出，标题=首条非环境用户消息。
pub fn list_codex_sessions(cwd: &str) -> Vec<SessionRef> {
    let Some(h) = home() else {
        return Vec::new();
    };
    let root = h.join(".codex").join("sessions");
    if !root.is_dir() {
        return Vec::new();
    }
    let mut files: Vec<PathBuf> = WalkDir::new(&root)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
                .unwrap_or(false)
        })
        .collect();
    files.sort_by(|a, b| b.file_name().cmp(&a.file_name())); // 文件名含 ISO 时间 → 倒序=最近优先
    files.truncate(MAX_CODEX_SCAN);

    let mut out = Vec::new();
    for p in files {
        let head = read_head_lines(&p, 12);
        if head.is_empty() {
            continue;
        }
        let Ok(meta) = serde_json::from_str::<serde_json::Value>(&head[0]) else {
            continue;
        };
        if meta.get("type").and_then(|t| t.as_str()) != Some("session_meta") {
            continue;
        }
        let payload = meta.get("payload");
        if payload.and_then(|p| p.get("cwd")).and_then(|c| c.as_str()) != Some(cwd) {
            continue;
        }
        let id = payload
            .and_then(|p| p.get("id"))
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let mut label = String::new();
        for l in head.iter().skip(1) {
            if !l.contains("\"input_text\"") {
                continue;
            }
            if let Some(t) = extract_input_text(l) {
                if !t.starts_with("<environment_context") {
                    label = t.chars().take(80).collect();
                    break;
                }
            }
        }
        out.push(SessionRef {
            id,
            label: if label.is_empty() {
                "(无标题)".into()
            } else {
                label
            },
            ts: mtime_ms(&p),
            path: p.to_string_lossy().into_owned(),
        });
    }
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    out
}

/// 删除 codex 会话：移入回收站（仅限 ~/.codex/sessions 内）。
pub fn delete_codex_session(path: &str) -> Result<(), String> {
    let Some(h) = home() else {
        return Err("无 home 目录".into());
    };
    let p = Path::new(path);
    if !p.starts_with(h.join(".codex").join("sessions")) {
        return Err("路径不在 codex sessions 目录内".into());
    }
    if !p.is_file() {
        return Err("会话文件不存在".into());
    }
    trash::delete(p).map_err(|e| e.to_string())
}
