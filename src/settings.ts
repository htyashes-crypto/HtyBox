import { useSyncExternalStore } from "react";

/** 全局设置（未来各种开关都加到这里）。持久化在 localStorage。 */
export interface Settings {
  /** Skill/Memory 卡片鼠标悬停时弹出详情浮层 */
  hoverPreview: boolean;
}

const KEY = "htybox.settings.v1";
const DEFAULTS: Settings = { hoverPreview: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): void {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 订阅全局设置（任意组件读取，setSetting 后自动重渲染）。 */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
