//! 扫描并解析 Claude 的 Skill 与 Memory（M3）。
//! Skill：user(`~/.claude/skills`)、project(`<proj>/.claude/skills`)、plugin(市场)。
//! Memory：`~/.claude/projects/<slug>/memory/*.md`（排除 MEMORY.md 索引）。

use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: String,
    /// "user" | "project" | "plugin:<plugin>"
    pub source: String,
    /// 推导出的调用串：`/name` 或 `/plugin:name`
    pub invoke: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub name: String,
    pub description: String,
    pub mem_type: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub slug: String,
    pub path: String,
    pub memory_count: usize,
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// 解析以 `---` 包裹的 YAML frontmatter。
fn parse_frontmatter(content: &str) -> Option<serde_yaml::Value> {
    let rest = content.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    serde_yaml::from_str(&rest[..end]).ok()
}

fn str_field(v: &serde_yaml::Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(|s| s.trim().to_string())
}

fn file_stem(p: &Path) -> String {
    p.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("?")
        .to_string()
}

// ---------------- Skill ----------------

fn parse_skill(skill_md: &Path, source: String) -> Option<Skill> {
    let content = std::fs::read_to_string(skill_md).ok()?;
    let fm = parse_frontmatter(&content);
    let name = fm
        .as_ref()
        .and_then(|v| str_field(v, "name"))
        .unwrap_or_else(|| {
            skill_md
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("?")
                .to_string()
        });
    let description = fm
        .as_ref()
        .and_then(|v| str_field(v, "description"))
        .unwrap_or_default();
    let invoke = match source.strip_prefix("plugin:") {
        Some(plugin) => format!("/{plugin}:{name}"),
        None => format!("/{name}"),
    };
    Some(Skill {
        name,
        description,
        path: skill_md.to_string_lossy().into_owned(),
        source,
        invoke,
    })
}

/// 扫描某目录下每个一级子目录里的 SKILL.md。
fn scan_skill_dir(dir: &Path, source: &str, out: &mut Vec<Skill>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            let skill_md = p.join("SKILL.md");
            if skill_md.is_file() {
                if let Some(s) = parse_skill(&skill_md, source.to_string()) {
                    out.push(s);
                }
            }
        }
    }
}

/// 递归扫描插件市场里的 `*/skills/*/SKILL.md`，插件名取 skills 目录的父目录名。
fn scan_plugin_skills(root: &Path, out: &mut Vec<Skill>) {
    if !root.is_dir() {
        return;
    }
    for entry in WalkDir::new(root)
        .max_depth(8)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && entry.file_name() == "SKILL.md" {
            let p = entry.path();
            let plugin = p
                .parent() // <skill>/
                .and_then(|d| d.parent()) // skills/
                .and_then(|d| d.parent()) // <plugin>/
                .and_then(|d| d.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("plugin")
                .to_string();
            if let Some(s) = parse_skill(p, format!("plugin:{plugin}")) {
                out.push(s);
            }
        }
    }
}

pub fn scan_skills(project_dir: Option<&str>) -> Vec<Skill> {
    let mut out = Vec::new();
    if let Some(h) = home() {
        scan_skill_dir(&h.join(".claude").join("skills"), "user", &mut out);
        scan_plugin_skills(
            &h.join(".claude").join("plugins").join("marketplaces"),
            &mut out,
        );
    }
    if let Some(pd) = project_dir.filter(|p| !p.is_empty()) {
        scan_skill_dir(&Path::new(pd).join(".claude").join("skills"), "project", &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// 只扫某工作区文件夹自己的 `<dir>/.claude/skills`（用户/插件级 skill 留给未来单独界面）。
pub fn scan_project_skills(project_dir: &str) -> Vec<Skill> {
    let mut out = Vec::new();
    if !project_dir.is_empty() {
        scan_skill_dir(
            &Path::new(project_dir).join(".claude").join("skills"),
            "project",
            &mut out,
        );
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

// ---------------- Memory ----------------

fn projects_root() -> Option<PathBuf> {
    home().map(|h| h.join(".claude").join("projects"))
}

fn count_memory_md(mem_dir: &Path) -> usize {
    std::fs::read_dir(mem_dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| {
                    let p = e.path();
                    p.extension().map(|x| x == "md").unwrap_or(false)
                        && !p
                            .file_name()
                            .map(|n| n.eq_ignore_ascii_case("MEMORY.md"))
                            .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}

pub fn list_projects() -> Vec<ProjectRef> {
    let mut out = Vec::new();
    let Some(root) = projects_root() else {
        return out;
    };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            let count = count_memory_md(&p.join("memory"));
            if count > 0 {
                out.push(ProjectRef {
                    slug: file_name_str(&p),
                    path: p.to_string_lossy().into_owned(),
                    memory_count: count,
                });
            }
        }
    }
    out.sort_by(|a, b| b.memory_count.cmp(&a.memory_count).then(a.slug.cmp(&b.slug)));
    out
}

fn file_name_str(p: &Path) -> String {
    p.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string()
}

fn parse_memory(md: &Path) -> Option<MemoryItem> {
    let content = std::fs::read_to_string(md).ok()?;
    let fm = parse_frontmatter(&content);
    let name = fm
        .as_ref()
        .and_then(|v| str_field(v, "name"))
        .unwrap_or_else(|| file_stem(md));
    let description = fm
        .as_ref()
        .and_then(|v| str_field(v, "description"))
        .unwrap_or_default();
    let mem_type = fm
        .as_ref()
        .and_then(|v| v.get("metadata"))
        .and_then(|m| m.get("type"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    Some(MemoryItem {
        name,
        description,
        mem_type,
        path: md.to_string_lossy().into_owned(),
    })
}

pub fn scan_memories(slug: &str) -> Vec<MemoryItem> {
    let mut out = Vec::new();
    let Some(root) = projects_root() else {
        return out;
    };
    let mem_dir = root.join(slug).join("memory");
    let Ok(entries) = std::fs::read_dir(&mem_dir) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().map(|x| x == "md").unwrap_or(false)
            && !p
                .file_name()
                .map(|n| n.eq_ignore_ascii_case("MEMORY.md"))
                .unwrap_or(false)
        {
            if let Some(m) = parse_memory(&p) {
                out.push(m);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}
