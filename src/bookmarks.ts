import { useSyncExternalStore } from "react";

// 书签：随手暂存需求/想法/笔记。**按工作区(scope=工作区 slug)分桶**持久化，
// 镜像 favSkills/wsState 的 { [scope]: value } 模式（用户拍板按工作区独立，见计划决策 1）。
// 标题、内容均可空（但 UI 限制不可同时为空）；颜色=分类、星标=重要(置顶)。

export type BookmarkColorKey = "red" | "amber" | "green" | "blue" | "purple" | "gray";

// 书签标签色（数据维度，非主题 token）：柔和值，与奶油主题协调、dark 下亦可读。
export const BOOKMARK_COLORS: { key: BookmarkColorKey; label: string; dot: string }[] = [
  { key: "red", label: "红", dot: "#d6695e" },
  { key: "amber", label: "橙", dot: "#d99a4e" },
  { key: "green", label: "绿", dot: "#6aa563" },
  { key: "blue", label: "蓝", dot: "#5b8fc9" },
  { key: "purple", label: "紫", dot: "#9d7cc4" },
  { key: "gray", label: "灰", dot: "#9b968c" },
];

export const DEFAULT_COLOR: BookmarkColorKey = "blue";

/** 取某颜色的圆点色值（未知 key 降级灰）。 */
export const colorDot = (key: BookmarkColorKey): string =>
  BOOKMARK_COLORS.find((c) => c.key === key)?.dot ?? "#9b968c";

export interface Bookmark {
  id: string;
  title: string; // 可空
  body: string; // 可空
  color: BookmarkColorKey;
  important: boolean;
  createdAt: number;
  updatedAt: number;
}

const KEY = "htybox.bookmarks.v1";

// 空数组共享常量：getBookmarks 对无书签的 scope 返回它，保证 useSyncExternalStore 快照引用稳定。
const EMPTY: Bookmark[] = [];

function load(): Record<string, Bookmark[]> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, Bookmark[]>;
  } catch {
    /* localStorage 不可用 / 损坏 → 降级空对象 */
  }
  return {};
}

// 模块级缓存：mutation 时整体替换 store 引用、替换对应 scope 的数组引用 → 快照按 scope 稳定。
let store: Record<string, Bookmark[]> = load();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 静默放弃（与既有 load/save 一致） */
  }
}

function commit(scope: string, list: Bookmark[]): void {
  store = { ...store, [scope]: list };
  save();
  emit();
}

/** 读某 scope 的书签（无则返回共享空数组，引用稳定）。 */
export function getBookmarks(scope: string): Bookmark[] {
  return store[scope] ?? EMPTY;
}

export interface BookmarkInput {
  title: string;
  body: string;
  color: BookmarkColorKey;
  important: boolean;
}

export function addBookmark(scope: string, input: BookmarkInput): void {
  const now = Date.now();
  const b: Bookmark = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
  commit(scope, [b, ...getBookmarks(scope)]);
}

export function updateBookmark(scope: string, id: string, patch: Partial<BookmarkInput>): void {
  commit(
    scope,
    getBookmarks(scope).map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)),
  );
}

export function deleteBookmark(scope: string, id: string): void {
  commit(scope, getBookmarks(scope).filter((b) => b.id !== id));
}

export function toggleImportant(scope: string, id: string): void {
  commit(
    scope,
    getBookmarks(scope).map((b) =>
      b.id === id ? { ...b, important: !b.important, updatedAt: Date.now() } : b,
    ),
  );
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 订阅某 scope 的书签（mutation 后自动重渲染；快照引用稳定不会死循环）。 */
export function useBookmarks(scope: string): Bookmark[] {
  return useSyncExternalStore(
    subscribe,
    () => getBookmarks(scope),
  );
}

/** 排序：重要(星标)置顶，再按 updatedAt 降序。 */
export function sortedBookmarks(list: Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

// —— 显示 / 复制 / 注入 文本规则（标题、内容均可空，见计划决策 7）——
/** 卡片单行显示：标题优先，无标题则内容。 */
export const displayText = (b: Bookmark): string => b.title.trim() || b.body.trim();
/** 复制：内容非空复制内容，内容空复制标题。 */
export const copyTextOf = (b: Bookmark): string => (b.body.trim() ? b.body : b.title);
/** 注入：标题、内容中非空者拼接（都在则「标题\n内容」），换行由 injectText 压成单行。 */
export const injectTextOf = (b: Bookmark): string =>
  [b.title, b.body].map((s) => s.trim()).filter(Boolean).join("\n");
