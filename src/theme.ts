// 全局可切换界面主题。切换仅给 <html> 加/去 `dark` 类 —— 全套语义配色 CSS 变量
// （--bg/--surface/--text/--accent… 见 index.css）随之翻转，组件用 var(--xxx) 引用，零逻辑改动。
// 对标 fonts.ts：applyTheme 即时生效，initTheme 在 main.tsx 渲染前调用一次（避免主题闪烁）。
import type { ThemeKey } from "./themeKeys";
import { getSettings } from "./settings";

export type { ThemeKey };

export interface ThemeDef {
  key: ThemeKey;
  label: string;
  desc: string;
}

export const THEMES: ThemeDef[] = [
  { key: "light", label: "浅色", desc: "奶油亮色（默认）" },
  { key: "dark", label: "深色", desc: "暖调棕黑 · 夜间护眼" },
  { key: "system", label: "跟随系统", desc: "随 OS 深浅自动切换" },
];

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** 解析某主题在当前环境下是否应呈暗色（system → 读系统偏好）。 */
function isDark(key: ThemeKey): boolean {
  return key === "dark" || (key === "system" && darkQuery().matches);
}

/** 把所选主题应用到 <html>：暗色加 `.dark` 类、浅色去掉。全局 token 随之翻转。 */
export function applyTheme(key: ThemeKey): void {
  document.documentElement.classList.toggle("dark", isDark(key));
}

// system 档下监听 OS 深浅切换的回调句柄（保证只绑定一次，切走时解绑）。
let sysListener: ((e: MediaQueryListEvent) => void) | null = null;

/** 仅 system 档需要：订阅 OS 深浅变化、实时重应用；切到 light/dark 时解绑。
 *  切换主题（设置面板 onClick）时须在 applyTheme 之后调用本函数。 */
export function watchSystemTheme(): void {
  const m = darkQuery();
  if (sysListener) m.removeEventListener("change", sysListener);
  if (getSettings().theme === "system") {
    sysListener = () => applyTheme("system");
    m.addEventListener("change", sysListener);
  } else {
    sysListener = null;
  }
}

/** 启动时按持久化设置应用一次（在 main.tsx 渲染前调用，避免主题闪烁）。 */
export function initTheme(): void {
  applyTheme(getSettings().theme);
  watchSystemTheme();
}
