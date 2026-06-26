import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  onAgentWake,
  onAgentLoop,
  onTerminalExit,
  getAgentTerminal,
  getTermAgent,
  wasIntentionallyClosed,
  agentExited,
  launchAgents,
  termInfoToSpec,
  bumpRespawn,
  respawnExceeded,
  relayAllow,
  relayStop,
  relayResume,
  relayUsage,
  interruptAllAgents,
  type AgentWake,
} from "../mcp";
import { autoInjectWhenQuiet, focusEngine } from "./terminalEngine";
import { useSettings } from "../settings";

// 唤醒注入语：让被唤醒的 agent 取消息后按协议继续。
const NUDGE = "（HtyBox）你有新消息，请调用 read_inbox 查看后继续。\r";

/**
 * M7-D 唤醒派发：监听 broker 的 "agent-wake"。
 * - 全自动(设置 autoRelay 开)：终端静默(物理确认)后自动注入，无需点击；受急停 + 次数上限护栏约束。
 * - 半自动(默认)：弹提示，用户点「唤醒」才注入。急停/触顶时全自动回退到半自动提示。
 */
export default function WakeToasts() {
  const { autoRelay } = useSettings();
  const [wakes, setWakes] = useState<AgentWake[]>([]); // 待手动唤醒
  const [loopWarn, setLoopWarn] = useState<string | null>(null); // 死循环告警
  const [downs, setDowns] = useState<{ termId: string; text: string }[]>([]); // 崩溃/替补提示
  const [, setTick] = useState(0); // 触发重渲染以刷新用量显示

  // 终端退出（M7-H 崩溃自愈）：排除主动关闭；急停中/熔断不替补，否则按原身份自动替补 + 复职简报
  useEffect(() => {
    const un = onTerminalExit((termId) => {
      const info = getTermAgent(termId);
      if (!info) return; // 非 agent 终端
      agentExited(info.token); // 主动关/崩溃都先从 broker 花名册注销该实例
      if (wasIntentionallyClosed(termId)) return; // 主动关：不替补、不提示
      const push = (text: string) =>
        setDowns((cur) => [...cur.filter((x) => x.termId !== termId), { termId, text }]);
      if (relayUsage().stopped) return push(`${info.roleName} 终端已退出（急停中，不替补）`);
      if (respawnExceeded(info.agentId))
        return push(`${info.roleName} 连续崩溃≥3 次，已停止自动替补`);
      const n = bumpRespawn(info.agentId);
      launchAgents(info.workspaceId, [termInfoToSpec(info)], { respawn: true });
      push(`${info.roleName} 崩溃 → 已自动替补顶岗（第 ${n} 次）`);
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  // 死循环：broker 检测到同内容空转 → 停自动接力并告警（护栏）
  useEffect(() => {
    const un = onAgentLoop((l) => {
      relayStop();
      setLoopWarn(`检测到 ${l.from} ↔ ${l.to} 疑似死循环，已停自动接力`);
      setTick((n) => n + 1);
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const un = onAgentWake((w) => {
      const termId = getAgentTerminal(w.agentId);
      // 全自动且仍有额度：静默后自动注入，不打扰用户
      if (autoRelay && termId && relayAllow()) {
        autoInjectWhenQuiet(termId, NUDGE);
        setTick((n) => n + 1);
        return;
      }
      // 半自动 / 已急停 / 触顶 → 弹提示让用户点击（同一 agent 只留最新一条）
      setWakes((cur) => [...cur.filter((x) => x.agentId !== w.agentId), w]);
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, [autoRelay]);

  const dismiss = (agentId: string) =>
    setWakes((cur) => cur.filter((x) => x.agentId !== agentId));

  const wake = (w: AgentWake) => {
    const termId = getAgentTerminal(w.agentId);
    if (termId) {
      invoke("write_terminal", { id: termId, data: NUDGE }).catch(() => {});
      focusEngine(termId);
    }
    dismiss(w.agentId);
  };

  const usage = relayUsage();
  const showRelayBar = autoRelay && (usage.count > 0 || usage.stopped);

  if (!wakes.length && !showRelayBar && !loopWarn && !downs.length) return null;
  return (
    <div className="fixed right-4 top-14 z-[90] flex w-72 flex-col gap-2">
      {downs.map((d) => (
        <div
          key={d.termId}
          className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--accent-soft)] px-3 py-2 shadow-lg"
        >
          <span className="text-xs text-[var(--danger)]">⚠ {d.text}</span>
          <button
            onClick={() => setDowns((cur) => cur.filter((x) => x.termId !== d.termId))}
            className="ml-auto shrink-0 rounded px-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>
      ))}
      {loopWarn && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--accent-soft)] px-3 py-2 shadow-lg">
          <span className="text-xs text-[var(--danger)]">⚠ {loopWarn}</span>
          <button
            onClick={() => setLoopWarn(null)}
            className="ml-auto shrink-0 rounded px-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>
      )}
      {showRelayBar && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 shadow-lg">
          <span className="text-xs text-[var(--text-2)]">
            {usage.stopped ? "⏸ 全自动已急停" : "⚡ 全自动接力中"} · {usage.count}/{usage.cap}
          </span>
          {usage.stopped ? (
            <button
              onClick={() => {
                relayResume();
                setTick((n) => n + 1);
              }}
              className="ml-auto rounded-md bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-white hover:bg-[var(--accent-text)]"
            >
              恢复
            </button>
          ) : (
            <button
              onClick={() => {
                relayStop();
                interruptAllAgents(); // 群发 Ctrl+C 真中断
                setTick((n) => n + 1);
              }}
              className="ml-auto rounded-md border border-[var(--danger)]/40 px-2 py-0.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10"
            >
              急停
            </button>
          )}
        </div>
      )}
      {wakes.map((w) => (
        <div
          key={w.agentId}
          className="rounded-lg border border-[var(--accent-border-soft)] bg-[var(--elevated)] p-3 shadow-lg"
        >
          <div className="text-xs font-semibold text-[var(--text)]">🔔 {w.roleName} 有新消息</div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
            来自 {w.from}：{w.preview}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => wake(w)}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--accent-text)]"
            >
              唤醒
            </button>
            <button
              onClick={() => dismiss(w.agentId)}
              className="rounded-md px-2.5 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--surface)]"
            >
              忽略
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
