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
    v.get(key)?
        .as_str()
        .map(|s| s.trim().to_string())
        // 值存在但为空/纯空白时视作"无"，让上层回退到文件名（否则 name 落空 → 空白卡片）
        .filter(|s| !s.is_empty())
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

// ---------------- M8：Skill 上架/下架管理（工作区级） ----------------
// 上架 = 文件夹在 <pd>/.claude/skills/<dir>；下架 = 移到 <pd>/.claude/downtime/skills/<dir>。
// 标识统一用文件夹名 `dir`（稳定），不用可能与文件夹名不一致的 frontmatter name。

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSkill {
    pub name: String,
    pub description: String,
    /// 文件夹名 = 稳定标识（移动/模板都用它）
    pub dir: String,
    /// 调用串 `/name`
    pub invoke: String,
    /// SKILL.md 绝对路径（上架后拖拽注入用）
    pub path: String,
    /// true=在 .claude/skills；false=在 .claude/downtime/skills
    pub enabled: bool,
}

/// 解析一个 skill 文件夹为 ManagedSkill；无 SKILL.md 则返回 None。
fn parse_managed_skill(skill_dir: &Path, enabled: bool) -> Option<ManagedSkill> {
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }
    let dir = skill_dir.file_name().and_then(|n| n.to_str())?.to_string();
    let content = std::fs::read_to_string(&skill_md).ok()?;
    let fm = parse_frontmatter(&content);
    let name = fm
        .as_ref()
        .and_then(|v| str_field(v, "name"))
        .unwrap_or_else(|| dir.clone());
    let description = fm
        .as_ref()
        .and_then(|v| str_field(v, "description"))
        .unwrap_or_default();
    let invoke = format!("/{name}");
    Some(ManagedSkill {
        name,
        description,
        dir,
        invoke,
        path: skill_md.to_string_lossy().into_owned(),
        enabled,
    })
}

/// 扫某根目录下每个含 SKILL.md 的一级子目录。
fn scan_managed_dir(root: &Path, enabled: bool, out: &mut Vec<ManagedSkill>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if let Some(s) = parse_managed_skill(&p, enabled) {
                out.push(s);
            }
        }
    }
}

/// 返回某根目录下的一级子目录名列表（用于 apply 计算当前已上架集合）。
fn skill_dir_names(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
                    out.push(n.to_string());
                }
            }
        }
    }
    out
}

/// 扫工作区级 上架(.claude/skills) + 下架(.claude/downtime/skills) 的全部 skill。
pub fn scan_managed_skills(project_dir: &str) -> Vec<ManagedSkill> {
    let mut out = Vec::new();
    if !project_dir.is_empty() {
        let base = Path::new(project_dir).join(".claude");
        scan_managed_dir(&base.join("skills"), true, &mut out);
        scan_managed_dir(&base.join("downtime").join("skills"), false, &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// 校验文件夹名安全（防路径越界）。
fn sanitize_dir(dir: &str) -> Result<(), String> {
    if dir.is_empty() || dir.contains('/') || dir.contains('\\') || dir.contains("..") {
        return Err(format!("非法 skill 目录名：{dir}"));
    }
    Ok(())
}

/// 上架/下架一个 skill 文件夹（同卷原子 rename）。
pub fn set_skill_enabled(project_dir: &str, dir: &str, enabled: bool) -> Result<(), String> {
    sanitize_dir(dir)?;
    let base = Path::new(project_dir).join(".claude");
    let active = base.join("skills").join(dir);
    let down = base.join("downtime").join("skills").join(dir);
    let (from, to) = if enabled { (&down, &active) } else { (&active, &down) };
    if !from.is_dir() {
        return Err(format!("源目录不存在：{}", from.display()));
    }
    if to.exists() {
        return Err(format!("目标已存在，未覆盖：{}", to.display()));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

/// 应用模板：目标 dirs 全上架、其余全下架。单项失败不中断，收集为 warnings 返回。
pub fn apply_skill_template(project_dir: &str, dirs: &[String]) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut target: std::collections::HashSet<String> = std::collections::HashSet::new();
    for d in dirs {
        match sanitize_dir(d) {
            Ok(()) => {
                target.insert(d.clone());
            }
            Err(e) => warnings.push(e),
        }
    }
    let base = Path::new(project_dir).join(".claude");
    let current = skill_dir_names(&base.join("skills"));
    // 下架：当前已上架但不在目标
    for d in &current {
        if !target.contains(d) {
            if let Err(e) = set_skill_enabled(project_dir, d, false) {
                warnings.push(format!("下架 {d} 失败：{e}"));
            }
        }
    }
    // 上架：目标里但当前未上架
    for d in &target {
        if !current.contains(d) {
            if let Err(e) = set_skill_enabled(project_dir, d, true) {
                warnings.push(format!("上架 {d} 失败：{e}"));
            }
        }
    }
    warnings
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

// ---------------- M9：记忆树（分级文件夹 + 封面索引链结构）----------------
// 新记忆结构：memory/ 根 = MEMORY.md + 分组文件夹 index_N[_set]_<组>/；
// topic(feedback_*/project_*/reference_*) 物理在所属组文件夹内。
// 树视图：分组文件夹=枝、topic=叶；隐藏 MEMORY.md 与 index_*.md(封面/子域索引脚手架)。兼容旧平铺结构。

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub mem_type: String,
    pub description: String,
    pub children: Vec<MemoryNode>,
}

fn build_memory_nodes(dir: &Path) -> Vec<MemoryNode> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            let children = build_memory_nodes(&p);
            if !children.is_empty() {
                out.push(MemoryNode {
                    name: file_name_str(&p),
                    path: p.to_string_lossy().into_owned(),
                    is_dir: true,
                    mem_type: String::new(),
                    description: String::new(),
                    children,
                });
            }
        } else if p.extension().map(|x| x == "md").unwrap_or(false) {
            let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // 跳过 MEMORY.md 与 index_*.md(封面/子域索引脚手架)，只收真正的 topic
            if fname.eq_ignore_ascii_case("MEMORY.md") || fname.starts_with("index_") {
                continue;
            }
            if let Some(m) = parse_memory(&p) {
                out.push(MemoryNode {
                    name: m.name,
                    path: m.path,
                    is_dir: false,
                    mem_type: m.mem_type,
                    description: m.description,
                    children: Vec::new(),
                });
            }
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// 扫某工作区记忆为树（分组文件夹 → topic）。
pub fn scan_memory_tree(slug: &str) -> Vec<MemoryNode> {
    let Some(root) = projects_root() else {
        return Vec::new();
    };
    build_memory_nodes(&root.join(slug).join("memory"))
}
