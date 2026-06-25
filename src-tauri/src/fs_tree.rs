//! M8：工作区文件树（懒加载，一层）。供「文件」页签按需展开目录、拖文件进终端注入。

use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 列出某目录的直接子项（不递归）。目录在前、再文件；同类按名称不分大小写升序。
/// 包含点文件/点目录（如 `.claude`）。读失败返回 Err 供前端行内提示。
pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let rd = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        let Some(name) = p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else {
            continue;
        };
        out.push(DirEntry {
            name,
            path: p.to_string_lossy().into_owned(),
            is_dir: p.is_dir(), // 跟随符号链接：指向目录的链接也算目录
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

// ---------------- M9：文件读写 / 增删改 ----------------

const MAX_EDIT_BYTES: u64 = 1024 * 1024; // 1MB，超过不进编辑器

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextResult {
    pub content: String,
    pub editable: bool,
    pub reason: Option<String>,
}

/// 读文本文件；目录/超大/二进制/非 UTF-8 → editable=false + reason（不回内容）。
pub fn read_text_file(path: &str) -> Result<ReadTextResult, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("是目录，无法作为文本打开".into());
    }
    let not_editable = |reason: String| ReadTextResult {
        content: String::new(),
        editable: false,
        reason: Some(reason),
    };
    if meta.len() > MAX_EDIT_BYTES {
        return Ok(not_editable(format!("文件过大（{} KB），不支持编辑", meta.len() / 1024)));
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Ok(not_editable("二进制文件，不支持编辑".to_string()));
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadTextResult { content, editable: true, reason: None }),
        Err(_) => Ok(not_editable("非 UTF-8 文本，不支持编辑".to_string())),
    }
}

pub fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// 校验新名安全（防越界/非法）。
fn sanitize_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n.contains('/') || n.contains('\\') || n == "." || n == ".." || n.contains("..") {
        return Err(format!("非法名称：{name}"));
    }
    Ok(n.to_string())
}

pub fn create_entry(parent_dir: &str, name: &str, is_dir: bool) -> Result<String, String> {
    let n = sanitize_name(name)?;
    let target = Path::new(parent_dir).join(&n);
    if target.exists() {
        return Err(format!("已存在：{n}"));
    }
    if is_dir {
        std::fs::create_dir(&target).map_err(|e| e.to_string())?;
    } else {
        std::fs::File::create(&target).map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().into_owned())
}

pub fn rename_entry(path: &str, new_name: &str) -> Result<String, String> {
    let n = sanitize_name(new_name)?;
    let p = Path::new(path);
    let parent = p.parent().ok_or("无父目录")?;
    let target = parent.join(&n);
    if target.exists() {
        return Err(format!("已存在：{n}"));
    }
    std::fs::rename(p, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

pub fn delete_entry(path: &str) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// 目标目录里求不冲突的名字：name、name (2)、name (3)…（文件保留扩展名）。
fn unique_in_dir(dest_dir: &Path, file_name: &str) -> PathBuf {
    let first = dest_dir.join(file_name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (file_name.to_string(), String::new()),
    };
    let mut i = 2;
    loop {
        let c = dest_dir.join(format!("{stem} ({i}){ext}"));
        if !c.exists() {
            return c;
        }
        i += 1;
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for e in std::fs::read_dir(src).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            copy_recursive(&e.path(), &dst.join(e.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())
    }
}

/// 移动进目标目录（同卷 rename，跨卷回退 copy+删）。禁止移进自身/子目录。
pub fn move_entry(src: &str, dest_dir: &str) -> Result<String, String> {
    let s = Path::new(src);
    let dest = Path::new(dest_dir);
    if dest == s || dest.starts_with(s) {
        return Err("不能移动到自身或其子目录".into());
    }
    let name = s.file_name().ok_or("无效源")?.to_os_string();
    let target = dest.join(&name);
    if target.exists() {
        return Err(format!("目标已存在同名项：{}", name.to_string_lossy()));
    }
    if std::fs::rename(s, &target).is_err() {
        copy_recursive(s, &target)?;
        let r = if s.is_dir() {
            std::fs::remove_dir_all(s)
        } else {
            std::fs::remove_file(s)
        };
        r.map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().into_owned())
}

/// 复制进目标目录（同名自动改名）。禁止复制进自身/子目录。
pub fn copy_entry(src: &str, dest_dir: &str) -> Result<String, String> {
    let s = Path::new(src);
    let dest = Path::new(dest_dir);
    if dest == s || dest.starts_with(s) {
        return Err("不能复制到自身或其子目录".into());
    }
    let name = s.file_name().ok_or("无效源")?.to_string_lossy().into_owned();
    let target = unique_in_dir(dest, &name);
    copy_recursive(s, &target)?;
    Ok(target.to_string_lossy().into_owned())
}

/// 写 OS 拖入文件的字节到目标目录（同名自动改名）。
pub fn import_dropped_file(dest_dir: &str, name: &str, bytes: Vec<u8>) -> Result<String, String> {
    let n = sanitize_name(name)?;
    let target = unique_in_dir(Path::new(dest_dir), &n);
    std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// 在系统资源管理器中定位该文件/目录。
pub fn reveal_in_explorer(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---------------- M9：全局文件搜索（双击 Shift）----------------

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", ".svn", ".hg", ".plastic", "target", "Library", "Temp",
    "Obj", "obj", "Build", "Builds", "Logs", "dist", "build", ".next", "bin", ".cache",
    ".vs", "MemoryCaptures", "UserSettings",
];
const MAX_FILES: usize = 100000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub name: String,
    pub rel: String,
    pub path: String,
}

/// 递归列工作区所有文件（跳过常见重目录 + 忽略名单的文件夹名/扩展名，上限 MAX_FILES）。
/// 供 quick-open 前端过滤。skip_folders=忽略的文件夹名，skip_exts=忽略的扩展名(不含点)。
pub fn list_all_files(root: &str, skip_folders: Vec<String>, skip_exts: Vec<String>) -> Vec<FileRef> {
    use std::collections::HashSet;
    let root_path = Path::new(root);
    let folderset: HashSet<String> = skip_folders.into_iter().collect();
    let extset: HashSet<String> = skip_exts.into_iter().map(|e| e.to_lowercase()).collect();
    let mut out = Vec::new();
    let walker = WalkDir::new(root_path).into_iter().filter_entry(|e| {
        if e.file_type().is_dir() {
            if let Some(n) = e.file_name().to_str() {
                return !(SKIP_DIRS.contains(&n) || folderset.contains(n));
            }
        }
        true
    });
    for entry in walker.filter_map(|e| e.ok()) {
        if out.len() >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !extset.is_empty() {
            if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                if extset.contains(&ext.to_lowercase()) {
                    continue;
                }
            }
        }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let rel = p
            .strip_prefix(root_path)
            .ok()
            .and_then(|r| r.to_str())
            .unwrap_or("")
            .to_string();
        out.push(FileRef {
            name,
            rel,
            path: p.to_string_lossy().into_owned(),
        });
    }
    out
}
