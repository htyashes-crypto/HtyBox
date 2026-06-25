import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  onAgentWake,
  onAgentLoop,
  getAgentTerminal,
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
  const [, setTick] = useState(0); // 触发重渲染以刷新用量显示

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

  if (!wakes.length && !showRelayBar && !loopWarn) return null;
  return (
    <div className="fixed right-4 top-14 z-[90] flex w-72 flex-col gap-2">
      {loopWarn && (
        <div className="flex items-start gap-2 rounded-lg border border-[#d6453e]/40 bg-[#fdf3f2] px-3 py-2 shadow-lg">
          <span className="text-xs text-[#d6453e]">⚠ {loopWarn}</span>
          <button
            onClick={() => setLoopWarn(null)}
            className="ml-auto shrink-0 rounded px-1.5 text-xs text-[#a8a29a] hover:text-[#191919]"
          >
            ✕
          </button>
        </div>
      )}
      {showRelayBar && (
        <div className="flex items-center gap-2 rounded-lg border border-[#e5e2d9] bg-white px-3 py-2 shadow-lg">
          <span className="text-xs text-[#73726c]">
            {usage.stopped ? "⏸ 全自动已急停" : "⚡ 全自动接力中"} · {usage.count}/{usage.cap}
          </span>
          {usage.stopped ? (
            <button
              onClick={() => {
                relayResume();
                setTick((n) => n + 1);
              }}
              className="ml-auto rounded-md bg-[#d97757] px-2 py-0.5 text-xs font-semibold text-white hover:bg-[#c15f3c]"
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
              className="ml-auto rounded-md border border-[#d6453e]/40 px-2 py-0.5 text-xs font-semibold text-[#d6453e] hover:bg-[#d6453e]/10"
            >
              急停
            </button>
          )}
        </div>
      )}
      {wakes.map((w) => (
        <div
          key={w.agentId}
          className="rounded-lg border border-[#e8c8bb] bg-white p-3 shadow-lg"
        >
          <div className="text-xs font-semibold text-[#191919]">🔔 {w.roleName} 有新消息</div>
          <div className="mt-0.5 truncate text-[11px] text-[#a8a29a]">
            来自 {w.from}：{w.preview}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => wake(w)}
              className="rounded-md bg-[#d97757] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#c15f3c]"
            >
              唤醒
            </button>
            <button
              onClick={() => dismiss(w.agentId)}
              className="rounded-md px-2.5 py-1 text-xs text-[#73726c] hover:bg-[#f4f3ee]"
            >
              忽略
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
