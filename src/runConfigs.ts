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

/** "AI 自动配置"提示词：复制后粘给终端里的 AI，教它写 .htybox/run-configs.json，再由"从项目导入"加载。 */
export function buildAiPrompt(root: string): string {
  return [
    "请为当前项目生成 HtyBox 运行配置。",
    "",
    "目标文件：" + root + "/.htybox/run-configs.json（.htybox 目录不存在请先新建）。",
    "",
    "格式（JSON）：",
    '{ "configs": [ { "name": "开发", "command": "pnpm dev", "cwd": "" }, { "name": "构建", "command": "pnpm build" } ] }',
    "字段：name=配置显示名；command=在 PowerShell 终端执行的整行命令；cwd=工作目录，留空或省略=工作区根。",
    "",
    "要求：(1) 分析 package.json 的 scripts、Cargo.toml、Makefile、README，挑出开发/构建/测试/启动等常用命令；(2) 只写真实存在、可直接运行的命令，包管理器按锁文件判断（pnpm-lock.yaml→pnpm）；(3) 命令面向 Windows PowerShell。",
    "",
    "完成后提醒我：回到 HtyBox「运行配置」点「从项目导入」加载。",
  ].join("\n");
}
