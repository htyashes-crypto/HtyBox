// M9-N8 运行配置：每工作区一组命名命令（在终端里运行），localStorage 持久化。镜像 skillTemplates.ts。
export interface RunConfig {
  id: string;
  name: string;
  command: string; // 在 PowerShell 终端里执行的命令
  cwd?: string; // 工作目录；空 = 工作区根
}

const KEY = "htybox.runConfigs.v1"; // { [workspaceId]: RunConfig[] }
const ACTIVE_KEY = "htybox.activeRunConfig.v1"; // { [workspaceId]: id | null }

export function genId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
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

export function loadConfigs(wsId: string): RunConfig[] {
  const all = readBucket<RunConfig[]>(KEY);
  return Array.isArray(all[wsId]) ? all[wsId] : [];
}
export function saveConfigs(wsId: string, list: RunConfig[]): void {
  try {
    const all = readBucket<RunConfig[]>(KEY);
    all[wsId] = list;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
export function loadActiveConfig(wsId: string): string | null {
  return readBucket<string | null>(ACTIVE_KEY)[wsId] ?? null;
}
export function saveActiveConfig(wsId: string, id: string | null): void {
  try {
    const all = readBucket<string | null>(ACTIVE_KEY);
    all[wsId] = id;
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
export function emptyConfig(): RunConfig {
  return { id: genId(), name: "", command: "" };
}

/** 解析 .htybox/run-configs.json（数组或 {configs:[]}），重分配 id。 */
export function parseImport(json: string): RunConfig[] {
  const parsed = JSON.parse(json);
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { configs?: unknown[] })?.configs)
      ? (parsed as { configs: unknown[] }).configs
      : [];
  return arr
    .map((c) => c as Partial<RunConfig>)
    .filter((c) => typeof c?.name === "string" && typeof c?.command === "string")
    .map((c) => ({
      id: genId(),
      name: String(c.name),
      command: String(c.command),
      cwd: c.cwd ? String(c.cwd) : undefined,
    }));
}
