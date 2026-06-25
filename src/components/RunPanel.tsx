import { useEffect, useMemo, useState } from "react";
import {
  brokerSnapshot,
  getAgentTerminal,
  relayStop,
  interruptAllAgents,
  type BrokerSnapshot,
} from "../mcp";
import { focusEngine } from "./terminalEngine";

// 状态徽标配色
const STATE_CLR: Record<string, string> = {
  working: "text-[#2fa35e] bg-[#2fa35e]/12",
  idle: "text-[#73726c] bg-[#73726c]/12",
  pending: "text-[#c15f3c] bg-[#d97757]/15",
  waiting: "text-[#d6453e] bg-[#d6453e]/12",
};
const STATE_CN: Record<string, string> = {
  working: "工作中",
  idle: "挂起",
  pending: "待唤醒",
  waiting: "卡住",
};

/** M7-F 运行面板：轮询 broker 快照，展示花名册/任务板/工具流/归属/黑板 + 大红 STOP。 */
export default function RunPanel() {
  const [snap, setSnap] = useState<BrokerSnapshot | null>(null);
  const [filter, setFilter] = useState(""); // "" = 全部；否则 agentId
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      brokerSnapshot()
        .then((s) => alive && setSnap(s))
        .catch(() => {});
    poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const byId = useMemo(
    () => new Map((snap?.agents ?? []).map((a) => [a.agentId, a.roleName])),
    [snap],
  );
  const name = (id: string) => byId.get(id) ?? id.slice(0, 6);

  if (!snap) {
    return <div className="p-6 text-center text-sm text-[#a8a29a]">读取协作状态…</div>;
  }

  const log = filter ? snap.log.filter((l) => l.agentId === filter) : snap.log;
  const sharedKeys = Object.keys(snap.shared);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* 服务器卡 + 大红 STOP */}
      <div className="flex items-center gap-3 rounded-lg border border-[#e5e2d9] bg-white px-3 py-2">
        <span className="text-xs text-[#73726c]">
          MCP broker · 127.0.0.1:{snap.port} · 运行 {Math.floor(snap.uptimeSecs / 60)}m
          {snap.uptimeSecs % 60}s · {snap.agents.length} agent
        </span>
        <button
          onClick={() => {
            relayStop();
            interruptAllAgents();
            force((n) => n + 1);
          }}
          className="ml-auto rounded-md bg-[#d6453e] px-3 py-1 text-xs font-bold text-white hover:bg-[#b8392f]"
        >
          ⏹ 全部急停
        </button>
      </div>

      {/* 花名册 */}
      <Section title={`花名册 (${snap.agents.length})`}>
        {snap.agents.map((a) => (
          <button
            key={a.agentId}
            onClick={() => {
              const t = getAgentTerminal(a.agentId);
              if (t) focusEngine(t);
            }}
            title="跳到该 agent 终端"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[#f4f3ee]"
          >
            <span className="truncate font-medium text-[#191919]">
              {a.role === "lead" ? "👑" : "🔧"} {a.roleName}
            </span>
            <span
              className={
                "ml-auto rounded px-1.5 py-0.5 text-[10px] " +
                (STATE_CLR[a.state] ?? "text-[#73726c] bg-[#73726c]/12")
              }
            >
              {STATE_CN[a.state] ?? a.state}
            </span>
          </button>
        ))}
      </Section>

      {/* 任务板 */}
      <Section title={`任务板 (${snap.tasks.length})`}>
        {snap.tasks.length === 0 && <Empty>暂无任务</Empty>}
        {snap.tasks.map((t) => (
          <div key={t.id} className="rounded-md px-2 py-1.5 text-xs hover:bg-[#f4f3ee]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[#a8a29a]">{t.id}</span>
              <span className="truncate text-[#191919]">{t.task}</span>
              <span
                className={
                  "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] " +
                  (t.status === "done"
                    ? "bg-[#2fa35e]/12 text-[#2fa35e]"
                    : "bg-[#d97757]/15 text-[#c15f3c]")
                }
              >
                {t.status === "done" ? "完成" : "进行中"}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-[#a8a29a]">
              {name(t.assigner)} → {name(t.worker)}
              {t.fileScope ? ` · 范围 ${t.fileScope}` : ""}
              {t.summary ? ` · ${t.summary}` : ""}
            </div>
          </div>
        ))}
      </Section>

      {/* 工具调用流（统一时间线 + 按 agent 筛选） */}
      <Section
        title="工具调用流"
        right={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border border-[#e5e2d9] bg-white px-1.5 py-0.5 text-[10px] text-[#73726c] outline-none"
          >
            <option value="">全部</option>
            {snap.agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.roleName}
              </option>
            ))}
          </select>
        }
      >
        {log.length === 0 && <Empty>暂无调用</Empty>}
        {log
          .slice()
          .reverse()
          .slice(0, 60)
          .map((l) => (
            <div key={l.seq} className="flex items-center gap-2 px-2 py-0.5 text-[11px]">
              <span className="font-mono text-[#a8a29a]">#{l.seq}</span>
              <span className="text-[#73726c]">{l.roleName}</span>
              <span className="font-mono text-[#c15f3c]">{l.tool}</span>
            </div>
          ))}
      </Section>

      {/* 文件归属 + 黑板 */}
      {snap.claims.length > 0 && (
        <Section title={`文件归属 (${snap.claims.length})`}>
          {snap.claims.map((c) => (
            <div key={c.path} className="flex items-center gap-2 px-2 py-0.5 text-[11px]">
              <span className="truncate font-mono text-[#73726c]">{c.path}</span>
              <span className="ml-auto shrink-0 text-[#a8a29a]">{name(c.owner)}</span>
            </div>
          ))}
        </Section>
      )}
      {sharedKeys.length > 0 && (
        <Section title={`黑板 (${sharedKeys.length})`}>
          {sharedKeys.map((k) => (
            <div key={k} className="px-2 py-0.5 text-[11px]">
              <span className="font-mono text-[#c15f3c]">{k}</span>
              <span className="text-[#73726c]">：{snap.shared[k]}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#e5e2d9] bg-white p-2">
      <div className="mb-1 flex items-center px-1">
        <span className="text-xs font-semibold text-[#73726c]">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1 text-[11px] text-[#a8a29a]">{children}</div>;
}
