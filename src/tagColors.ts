// Session 标签(tag)色板：6 种「数据维度色」，与书签同源的柔和值（暗色下亦可读）。
// 独立于 bookmarks（两者演化方向不同：tag 随用户自定义可能增多，书签是固定分类）。
// 仅作"分类着色"用，非主题 token，故不进 index.css 的 --xxx 体系。

export type TagColorKey = "blue" | "green" | "amber" | "purple" | "red" | "gray";

export const TAG_COLORS: { key: TagColorKey; label: string; dot: string }[] = [
  { key: "blue", label: "蓝", dot: "#5b8fc9" },
  { key: "green", label: "绿", dot: "#6aa563" },
  { key: "amber", label: "橙", dot: "#d99a4e" },
  { key: "purple", label: "紫", dot: "#9d7cc4" },
  { key: "red", label: "红", dot: "#d6695e" },
  { key: "gray", label: "灰", dot: "#9b968c" },
];

export const DEFAULT_TAG_COLOR: TagColorKey = "blue";

/** 取某颜色 key 的圆点色值（未知降级灰）。 */
export const tagDot = (key: TagColorKey): string =>
  TAG_COLORS.find((c) => c.key === key)?.dot ?? "#9b968c";

/** 按序号轮转取色（新建 tag 未指定颜色时用，让相邻新建色不同）。 */
export const rotateColor = (n: number): TagColorKey =>
  TAG_COLORS[((n % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length].key;
