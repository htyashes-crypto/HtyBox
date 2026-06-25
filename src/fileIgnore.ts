// M9-N6：文件树忽略名单——顶层文件夹名 + 扩展名，按工作区(root 路径)分桶持久化。
export interface IgnoreCfg {
  folders: string[]; // 顶层文件夹名（精确匹配，仅作用于根的一级目录）
  exts: string[]; // 扩展名（不含点、小写；作用于所有层级的文件）
}

const KEY = "htybox.fileIgnore.v1"; // { [rootPath]: IgnoreCfg }

function readAll(): Record<string, IgnoreCfg> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (v && typeof v === "object") return v as Record<string, IgnoreCfg>;
  } catch {
    /* ignore */
  }
  return {};
}

export function loadIgnore(key: string): IgnoreCfg {
  const c = readAll()[key];
  return {
    folders: Array.isArray(c?.folders) ? c.folders : [],
    exts: Array.isArray(c?.exts) ? c.exts : [],
  };
}

export function saveIgnore(key: string, cfg: IgnoreCfg): void {
  try {
    const all = readAll();
    all[key] = cfg;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** 取扩展名（不含点、小写）；无扩展名返回空串。 */
export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};
