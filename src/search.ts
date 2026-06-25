// 统一搜索规则（全局所有搜索共用，行为贴近 Cursor）：
// 查询按空格分词，每个词都必须作为【连续子串】出现在 primary 或任一 rest 字段里（散落字符不算）。
// 返回排序分（越大越靠前）；-1 = 不匹配。primary（文件名/技能名等）命中权重最高、前缀/越靠前/越短越高。
export function searchScore(query: string, primary: string, ...rest: string[]): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const p = (primary || "").toLowerCase();
  const hay = [primary, ...rest].join(" ").toLowerCase();
  const tokens = q.split(/\s+/);
  for (const t of tokens) if (!hay.includes(t)) return -1; // 每个词必须是连续子串
  let s = 1;
  if (p === q) s += 1000;
  else if (p.startsWith(q)) s += 600;
  else if (p.includes(q)) s += 400 - Math.min(p.indexOf(q), 100);
  else for (const t of tokens) if (p.includes(t)) s += 60;
  if (hay.includes(q)) s += 30;
  s += Math.max(0, 50 - (primary || "").length); // primary 越短越靠前
  return s;
}

/** 过滤谓词版本。 */
export function searchMatch(query: string, primary: string, ...rest: string[]): boolean {
  return searchScore(query, primary, ...rest) > 0;
}
