// 会话自定义名（用户手动重命名覆盖显示）：终端 Tab 与 Session 列表项【共享同一份】，
// 按 "agentKind:sessionId" 存（同一会话两处显示一致）。改名后派发事件，双方实时刷新。
// 终端 Tab 显示 = 实时状态前缀(✳ 等) + 此自定义名（无则回退会话名/ai-title）。

const KEY = "htybox.sessionTitles.v1";
const EVT = "htybox:session-titles";

const titleKey = (agentKind: string, sessionId: string) => `${agentKind}:${sessionId}`;

// 状态前缀字符集（U+2580–28FF 连段 + 点 ·•∙ / 星 * + 符号箭头）：覆盖 claude 空闲的 ✳、运行中的动画 · 点，
// 以及 codex 运行中的转圈 spinner（盲文 ⠿ 类 / 圆弧 / 方块）。这些是终端标题的实时状态前缀，剥离后才是纯会话名。
// 自定义名不该含它，否则终端 Tab 显示时会与"实时状态前缀"重复成两份。读/写都过一遍（兼容历史存坏值）。
const STATUS_PREFIX =
  /^[\s·•∙*▀-◿☀-⛿✀-➿⠀-⣿⬀-⯿]+/;
const stripStatus = (s: string): string => s.replace(STATUS_PREFIX, "").trim();
/** 拆分 claude/codex OSC 标题为 [状态前缀, 纯会话名]；终端 Tab 显示 = 实时状态前缀 + 名。 */
export function splitStatusPrefix(s: string): [string, string] {
  const m = s.match(STATUS_PREFIX);
  const prefix = m ? m[0] : "";
  return [prefix, s.slice(prefix.length).trim()];
}

function loadAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

/** 取某会话的用户自定义名；无则空串。 */
export function getSessionTitle(agentKind: string, sessionId: string): string {
  if (!sessionId) return "";
  return stripStatus(loadAll()[titleKey(agentKind, sessionId)] || "");
}

/** 设置/清除某会话的自定义名（空串=清除恢复原名），并派发事件通知两处刷新。 */
export function setSessionTitle(agentKind: string, sessionId: string, name: string): void {
  if (!sessionId) return;
  const m = loadAll();
  const k = titleKey(agentKind, sessionId);
  const t = stripStatus(name); // 去掉用户可能保留的前导 ✳，避免与 Tab 实时状态前缀重复
  if (t) m[k] = t;
  else delete m[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/** 订阅会话自定义名变化（终端 Tab / Session 列表用于实时刷新）。返回取消函数。 */
export function onSessionTitlesChange(fn: () => void): () => void {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}
