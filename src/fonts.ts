// 全局可切换界面字体。字体文件为本地内置子集（src/assets/fonts/*.woff2，~1MB/款，
// 含 GB2312 全汉字+拉丁+常用标点），离线可用。切换通过 CSS 变量 --app-font 即时生效，
// 全局 UI / 会话 / 编辑器 / Markdown 预览均继承之；终端与代码块另用等宽，不受影响。
import type { FontKey } from "./fontKeys";
import { getSettings } from "./settings";

export type { FontKey };

export interface FontDef {
  key: FontKey;
  label: string;
  desc: string;
  /** CSS font-family 栈（@font-face 名见 index.css；末尾回退微软雅黑） */
  stack: string;
}

export const FONTS: FontDef[] = [
  { key: "harmony", label: "鸿蒙 HarmonyOS", desc: "人文中性 · 柔和耐看（默认）", stack: '"HarmonyOS Sans SC", "Microsoft YaHei", sans-serif' },
  { key: "dingtalk", label: "钉钉进步体", desc: "现代亲和 · 字脚利落", stack: '"DingTalk JinBuTi", "Microsoft YaHei", sans-serif' },
  { key: "alibaba", label: "阿里巴巴普惠体", desc: "规整专业 · 大方百搭", stack: '"Alibaba PuHuiTi", "Microsoft YaHei", sans-serif' },
  { key: "lxgw", label: "霞鹜文楷", desc: "温润楷书 · 文艺", stack: '"LXGW WenKai", "Microsoft YaHei", serif' },
];

export function fontStack(key: FontKey): string {
  return (FONTS.find((f) => f.key === key) ?? FONTS[0]).stack;
}

/** 把所选字体写入 CSS 变量 --app-font，全局即时跟随。 */
export function applyFont(key: FontKey): void {
  document.documentElement.style.setProperty("--app-font", fontStack(key));
}

/** 启动时按持久化设置应用一次（在 main.tsx 渲染前调用）。 */
export function initFont(): void {
  applyFont(getSettings().fontFamily);
}
