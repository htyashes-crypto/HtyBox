// 主题 key（单列一文件，供 settings.ts 与 theme.ts 共享，避免循环依赖，对标 fontKeys.ts）。
// light=浅色奶油，dark=暖调棕黑，system=跟随 OS（prefers-color-scheme 实时）。
export type ThemeKey = "light" | "dark" | "system";
