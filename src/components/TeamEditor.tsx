import { useState } from "react";
import {
  type Team,
  type TeamAgentDef,
  DEFAULT_MODELS,
  emptyAgent,
  validateTeam,
} from "../teams";

const inputCls =
  "rounded border border-[#e5e2d9] bg-white px-2 py-1 text-xs text-[#191919] outline-none focus:border-[#d4a27f]";

/** Team 编辑器（M7-G §13.2）：四要素 + 类型→模型联动 datalist + Lead 单选 + 校验。 */
export default function TeamEditor({
  team: initial,
  onCancel,
  onSave,
}: {
  team: Team;
  onCancel: () => void;
  onSave: (team: Team) => void;
}) {
  const [team, setTeam] = useState<Team>(initial);
  const [err, setErr] = useState("");

  const patchAgent = (id: string, p: Partial<TeamAgentDef>) =>
    setTeam({ ...team, agents: team.agents.map((a) => (a.id === id ? { ...a, ...p } : a)) });
  const setLead = (id: string) =>
    setTeam({ ...team, agents: team.agents.map((a) => ({ ...a, isLead: a.id === id })) });

  const save = () => {
    const e = validateTeam(team);
    if (e) return setErr(e);
    onSave(team);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6" onClick={onCancel}>
      <datalist id="models-claude">
        {DEFAULT_MODELS.claude.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="models-codex">
        {DEFAULT_MODELS.codex.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div
        className="flex max-h-[82vh] w-[680px] max-w-full flex-col overflow-hidden rounded-xl border border-[#e5e2d9] bg-[#faf9f5] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[#e5e2d9] bg-[#f4f3ee] px-4 py-3">
          <span className="text-sm font-bold text-[#191919]">编辑团队</span>
          {err && <span className="text-xs text-[#d6453e]">{err}</span>}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex gap-2">
            <input
              className={inputCls + " flex-1"}
              placeholder="团队名"
              value={team.name}
              onChange={(e) => setTeam({ ...team, name: e.target.value })}
            />
            <input
              className={inputCls + " flex-1"}
              placeholder="描述（可选）"
              value={team.description ?? ""}
              onChange={(e) => setTeam({ ...team, description: e.target.value })}
            />
          </div>

          {team.agents.map((a, i) => (
            <div key={a.id} className="rounded-lg border border-[#e5e2d9] bg-white p-3">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold text-[#73726c]">成员 {i + 1}</span>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-[#c15f3c]">
                  <input
                    type="radio"
                    name="lead"
                    checked={a.isLead}
                    onChange={() => setLead(a.id)}
                    className="accent-[#d97757]"
                  />
                  Lead（编排者）
                </label>
                <button
                  onClick={() => setTeam({ ...team, agents: team.agents.filter((x) => x.id !== a.id) })}
                  className="ml-auto rounded px-2 py-0.5 text-xs text-[#a8a29a] hover:bg-[#f4f3ee] hover:text-[#d6453e]"
                >
                  删除
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className={inputCls + " w-[140px]"}
                  placeholder="角色名"
                  value={a.roleName}
                  onChange={(e) => patchAgent(a.id, { roleName: e.target.value })}
                />
                <select
                  className={inputCls}
                  value={a.agentKind}
                  onChange={(e) => patchAgent(a.id, { agentKind: e.target.value as "claude" | "codex" })}
                >
                  <option value="claude">ClaudeCode</option>
                  <option value="codex">Codex</option>
                </select>
                <input
                  className={inputCls + " w-[120px]"}
                  list={a.agentKind === "codex" ? "models-codex" : "models-claude"}
                  placeholder="模型（默认）"
                  value={a.model}
                  onChange={(e) => patchAgent(a.id, { model: e.target.value })}
                />
              </div>
              <input
                className={inputCls + " mt-2 w-full"}
                placeholder="职责内容（拆解派活 / 探查现状 …）"
                value={a.responsibility}
                onChange={(e) => patchAgent(a.id, { responsibility: e.target.value })}
              />
            </div>
          ))}

          <button
            onClick={() => setTeam({ ...team, agents: [...team.agents, emptyAgent()] })}
            className="rounded-md border border-dashed border-[#d4a27f] px-3 py-1.5 text-xs text-[#c15f3c] hover:bg-[#d97757]/8"
          >
            + 添加成员
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#e5e2d9] bg-[#f4f3ee] px-4 py-2.5">
          <button
            onClick={onCancel}
            className="rounded-md border border-[#e5e2d9] px-3 py-1 text-xs text-[#73726c] hover:border-[#d4a27f] hover:text-[#191919]"
          >
            取消
          </button>
          <button
            onClick={save}
            className="rounded-md bg-[#d97757] px-3 py-1 text-xs font-semibold text-white hover:bg-[#c15f3c]"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
