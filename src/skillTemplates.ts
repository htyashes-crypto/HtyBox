// M8-C 技能模板：SkillTemplate 数据模型 + 模板库（localStorage 持久化，按工作区分桶）。
// 模板 = 一组 skill 文件夹名（稳定标识）。同一工作区同一时间只启用一个模板（activeTemplate 指针）。
// 持久化沿用本项目既有 localStorage 约定（与 favSkills/teams 一致），零后端存储。

export interface SkillTemplate {
  id: string;
  name: string;
  skillDirs: string[]; // 文件夹名集合（稳定标识）
}

const KEY = "htybox.skillTemplates.v1"; // { [projectDir]: SkillTemplate[] }
const ACTIVE_KEY = "htybox.activeSkillTemplate.v1"; // { [projectDir]: templateId | null }

export function genId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `tpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function readBucket<T>(key: string): Record<string, T> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "{}");
    if (v && typeof v === "object") return v as Record<string, T>;
  } catch {
    /* ignore */
  }
  return {};
}

export function loadTemplates(projectDir: string): SkillTemplate[] {
  const all = readBucket<SkillTemplate[]>(KEY);
  return Array.isArray(all[projectDir]) ? all[projectDir] : [];
}

export function saveTemplates(projectDir: string, list: SkillTemplate[]): void {
  try {
    const all = readBucket<SkillTemplate[]>(KEY);
    all[projectDir] = list;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function loadActiveTemplate(projectDir: string): string | null {
  const all = readBucket<string | null>(ACTIVE_KEY);
  return all[projectDir] ?? null;
}

export function saveActiveTemplate(projectDir: string, id: string | null): void {
  try {
    const all = readBucket<string | null>(ACTIVE_KEY);
    all[projectDir] = id;
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function emptyTemplate(): SkillTemplate {
  return { id: genId(), name: "", skillDirs: [] };
}

/** 校验：模板需有名字。返回错误文案或 null。 */
export function validateTemplate(t: SkillTemplate): string | null {
  if (!t.name.trim()) return "请填写模板名";
  return null;
}
