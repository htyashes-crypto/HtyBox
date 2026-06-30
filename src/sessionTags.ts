import { useMemo, useSyncExternalStore } from "react";
import { rotateColor, type TagColorKey } from "./tagColors";

// Session 标签系统：给 claude/codex 会话打可自定义 tag。
// - tag 是一等对象 {id,name,color} 存于全局【词表 vocab】；会话只存 tagId[]（关联表 bySession）。
//   改名/改色一处生效；按 "agentKind:sessionId" 关联（session id 全局唯一，不分工作区）。
// - 全局单一来源 + 订阅：终端 Tab 与 Session 列表【共享同一份】，一处打 tag 另一处实时刷新
//   （镜像 bookmarks.ts 的 useSyncExternalStore + 模块级 store；与 sessionTitles 的两处联动同理）。

export interface Tag {
  id: string;
  name: string;
  color: TagColorKey;
}

export interface TagStore {
  vocab: Tag[]; // 全局 tag 词表
  bySession: Record<string, string[]>; // "agentKind:sessionId" -> tagId[]
}

const KEY = "htybox.sessionTags.v1";

export const sessionKey = (agentKind: string, sessionId: string): string =>
  `${agentKind}:${sessionId}`;

// 空数组共享常量：无 tag 的会话返回它，保证 useSyncExternalStore 快照引用稳定（不死循环）。
const EMPTY: string[] = [];

function load(): TagStore {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (v && typeof v === "object") {
      const vocab = Array.isArray(v.vocab) ? (v.vocab as Tag[]) : [];
      const bySession =
        v.bySession && typeof v.bySession === "object"
          ? (v.bySession as Record<string, string[]>)
          : {};
      return { vocab, bySession };
    }
  } catch {
    /* localStorage 不可用 / 损坏 → 降级空 */
  }
  return { vocab: [], bySession: {} };
}

// 模块级 store：mutation 时【整体替换 store 引用 + 替换被改 slice 的引用】→ 各 slice 快照按需稳定。
let store: TagStore = load();
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
function setVocab(vocab: Tag[]): void {
  store = { ...store, vocab };
  save();
  emit();
}
function setSessionIds(key: string, ids: string[]): void {
  store = { ...store, bySession: { ...store.bySession, [key]: ids } };
  save();
  emit();
}

// join：tagId[] → Tag[]（按词表解析、过滤悬挂 id，保持 ids 顺序）。
function joinTags(ids: string[], vocab: Tag[]): Tag[] {
  return ids
    .map((id) => vocab.find((t) => t.id === id))
    .filter((t): t is Tag => !!t);
}

// ===== 读 API（非响应式；引用稳定，可直接作 useSyncExternalStore 快照） =====

/** 全局 tag 词表（store.vocab 原引用，稳定）。 */
export function getVocab(): Tag[] {
  return store.vocab;
}

/** 某会话的 tagId[]（store 原引用，稳定）；无则共享空数组。 */
export function getSessionTagIds(agentKind: string, sessionId: string): string[] {
  return store.bySession[sessionKey(agentKind, sessionId)] ?? EMPTY;
}

/** 某会话的 tag 对象（join 词表、过滤悬挂 id）。非响应式，用于搜索 / 一次性读取。 */
export function getSessionTags(agentKind: string, sessionId: string): Tag[] {
  return joinTags(getSessionTagIds(agentKind, sessionId), store.vocab);
}

// ===== 写 API =====

/** 新建 tag（去重：同名返回已存在；未指定颜色按词表大小轮转取色）。 */
export function createTag(name: string, color?: TagColorKey): Tag {
  const n = name.trim();
  const existing = store.vocab.find((t) => t.name === n);
  if (existing) return existing;
  const tag: Tag = {
    id: crypto.randomUUID(),
    name: n,
    color: color ?? rotateColor(store.vocab.length),
  };
  setVocab([...store.vocab, tag]);
  return tag;
}

/** 给会话加 tag（已有忽略）。key = sessionKey(agentKind, id)。 */
export function addTag(key: string, tagId: string): void {
  const ids = store.bySession[key] ?? EMPTY;
  if (ids.includes(tagId)) return;
  setSessionIds(key, [...ids, tagId]);
}

/** 从会话移除 tag。 */
export function removeTag(key: string, tagId: string): void {
  const ids = store.bySession[key] ?? EMPTY;
  if (!ids.includes(tagId)) return;
  setSessionIds(key, ids.filter((x) => x !== tagId));
}

/** 切换会话的 tag（有则移除、无则添加）。 */
export function toggleTag(key: string, tagId: string): void {
  const ids = store.bySession[key] ?? EMPTY;
  if (ids.includes(tagId)) setSessionIds(key, ids.filter((x) => x !== tagId));
  else setSessionIds(key, [...ids, tagId]);
}

/** 清除某会话全部 tag 关联（删除会话时调；词表保留）。 */
export function clearSession(key: string): void {
  if (!(key in store.bySession)) return;
  const next = { ...store.bySession };
  delete next[key];
  store = { ...store, bySession: next };
  save();
  emit();
}

// ===== 订阅 + hooks（mutation 后自动重渲染；快照引用稳定不死循环） =====
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 订阅全局 tag 词表。 */
export function useVocab(): Tag[] {
  return useSyncExternalStore(subscribe, getVocab);
}

/** 订阅某会话的 tag（内部 join 词表，ids/vocab 引用稳定时 useMemo 不重算）。 */
export function useSessionTags(agentKind: string, sessionId: string): Tag[] {
  const ids = useSyncExternalStore(subscribe, () => getSessionTagIds(agentKind, sessionId));
  const vocab = useSyncExternalStore(subscribe, getVocab);
  return useMemo(() => joinTags(ids, vocab), [ids, vocab]);
}

/** 订阅整个 store：vocab 或【任意会话】tag 关联变化都触发重渲染（store mutation 整体换引用）。
 *  用于需随任意 tag 变化刷新的容器（SessionPanel：卡片 chips 用 getSessionTags 非响应式读，
 *  靠此 hook 驱动顶层重渲染；筛选结果与下拉计数同理）。 */
export function useTagStore(): TagStore {
  return useSyncExternalStore(subscribe, () => store);
}
