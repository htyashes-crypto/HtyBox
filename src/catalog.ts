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
