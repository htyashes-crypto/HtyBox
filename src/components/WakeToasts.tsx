import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onAgentWake, getAgentTerminal, type AgentWake } from "../mcp";
import { focusEngine } from "./terminalEngine";

/**
 * M7-B 半自动唤醒：监听 broker 的 "agent-wake"（某挂起 agent 收到新消息）。
 * 用户点「唤醒」→ 向该 agent 的终端 PTY 注入提示，让其 read_inbox 后继续。
 * （物理确认/自动唤醒属 M7-B 后续：Stop hook / codex 静默 + M7-D 全自动）
 */
export default function WakeToasts() {
  const [wakes, setWakes] = useState<AgentWake[]>([]);

  useEffect(() => {
    const un = onAgentWake((w) =>
      // 同一 agent 多条消息只保留最新一条提示
      setWakes((cur) => [...cur.filter((x) => x.agentId !== w.agentId), w]),
    );
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  const dismiss = (agentId: string) =>
    setWakes((cur) => cur.filter((x) => x.agentId !== agentId));

  const wake = (w: AgentWake) => {
    const termId = getAgentTerminal(w.agentId);
    if (termId) {
      invoke("write_terminal", {
        id: termId,
        data: "（HtyBox）你有新消息，请调用 read_inbox 查看后继续。\r",
      }).catch(() => {});
      focusEngine(termId);
    }
    dismiss(w.agentId);
  };

  if (!wakes.length) return null;
  return (
    <div className="fixed right-4 top-14 z-[90] flex w-72 flex-col gap-2">
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
