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

// ---- M9：记忆树（分级文件夹结构）----
export interface MemoryNode {
  name: string;
  path: string;
  isDir: boolean;
  memType: string;
  description: string;
  children: MemoryNode[];
}
export const listMemoryTree = (slug: string) =>
  invoke<MemoryNode[]>("list_memory_tree", { slug });

// ---- M9：claude/codex 会话记录 ----
export interface SessionRef {
  id: string;
  label: string;
  ts: number; // 毫秒
  path: string;
}
export const listClaudeSessions = (cwd: string) =>
  invoke<SessionRef[]>("list_claude_sessions", { cwd });
export const listCodexSessions = (cwd: string) =>
  invoke<SessionRef[]>("list_codex_sessions", { cwd });
export const deleteClaudeSession = (id: string) =>
  invoke<void>("delete_claude_session", { id });
export const deleteCodexSession = (path: string) =>
  invoke<void>("delete_codex_session", { path });

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

// ---- M9：文件读写 / 增删改 ----
export interface ReadTextResult {
  content: string;
  editable: boolean;
  reason?: string;
}
export const readTextFile = (path: string) =>
  invoke<ReadTextResult>("read_text_file", { path });
export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content });
export const createEntry = (parentDir: string, name: string, isDir: boolean) =>
  invoke<string>("create_entry", { parentDir, name, isDir });
export const renameEntry = (path: string, newName: string) =>
  invoke<string>("rename_entry", { path, newName });
export const deleteEntry = (path: string) => invoke<void>("delete_entry", { path });
export const moveEntry = (src: string, destDir: string) =>
  invoke<string>("move_entry", { src, destDir });
export const copyEntry = (src: string, destDir: string) =>
  invoke<string>("copy_entry", { src, destDir });
export const importDroppedFile = (destDir: string, name: string, bytes: number[]) =>
  invoke<string>("import_dropped_file", { destDir, name, bytes });
export const revealInExplorer = (path: string) =>
  invoke<void>("reveal_in_explorer", { path });

// ---- M9：全局文件搜索（双击 Shift）----
export interface FileRef {
  name: string;
  rel: string;
  path: string;
}
export const listAllFiles = (root: string, skipFolders: string[], skipExts: string[]) =>
  invoke<FileRef[]>("list_all_files", { root, skipFolders, skipExts });
