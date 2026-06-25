import { invoke } from "@tauri-apps/api/core";

export interface Skill {
  name: string;
  description: string;
  path: string;
  /** "user" | "project" | "plugin:<plugin>" */
  source: string;
  invoke: string;
}

export interface MemoryItem {
  name: string;
  description: string;
  memType: string;
  path: string;
}

export interface ProjectRef {
  slug: string;
  path: string;
  memoryCount: number;
}

export const listSkills = (projectDir?: string) =>
  invoke<Skill[]>("list_skills", { projectDir });

/** 只取某工作区文件夹自己的 skill（<dir>/.claude/skills）。 */
export const listProjectSkills = (projectDir: string) =>
  invoke<Skill[]>("list_project_skills", { projectDir });

export const listMemories = (slug: string) =>
  invoke<MemoryItem[]>("list_memories", { slug });

export const listProjects = () => invoke<ProjectRef[]>("list_projects");

// ---- M8：Skill 上架/下架管理（工作区级） ----
export interface ManagedSkill {
  name: string;
  description: string;
  dir: string; // 文件夹名 = 稳定标识（移动/模板都用它）
  invoke: string;
  path: string;
  enabled: boolean; // true=已上架(.claude/skills)；false=已下架(.claude/downtime/skills)
}

/** 列工作区级 上架+下架 的全部 skill（带 enabled）。 */
export const listManagedSkills = (projectDir: string) =>
  invoke<ManagedSkill[]>("list_managed_skills", { projectDir });

/** 上架/下架单个 skill（移动文件夹）。 */
export const setSkillEnabled = (projectDir: string, dir: string, enabled: boolean) =>
  invoke<void>("set_skill_enabled", { projectDir, dir, enabled });

/** 应用模板：dirs 全上架、其余全下架；返回单项失败的 warnings。 */
export const applySkillTemplate = (projectDir: string, dirs: string[]) =>
  invoke<string[]>("apply_skill_template", { projectDir, dirs });

// ---- M8：工作区文件树（懒加载，一层） ----
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** 列某目录的直接子项。 */
export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
