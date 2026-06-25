import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// 记住被「跳过」的版本号：同一版本不再自动弹窗（但左上角标仍提示，可手动触发）
const SKIP_KEY = "htybox.update.skipped";

export function getSkippedVersion(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

export function setSkippedVersion(v: string | null): void {
  try {
    if (v) localStorage.setItem(SKIP_KEY, v);
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    /* ignore */
  }
}

/** 检查更新：有可用更新返回 Update，无更新 / 端点不可达 / 出错一律返回 null（不打扰用户）。 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    // 首版发布前端点 404、离线等都会落到这里 —— 静默忽略
    return null;
  }
}

export { relaunch };
export type { Update };
