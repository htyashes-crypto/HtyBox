//! M8：工作区文件树（懒加载，一层）。供「文件」页签按需展开目录、拖文件进终端注入。

use std::path::Path;

use serde::Serialize;

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
