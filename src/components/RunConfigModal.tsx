import { useState } from "react";
import { saveConfigs, emptyConfig, parseImport, type RunConfig } from "../runConfigs";
import { readTextFile } from "../catalog";

function PlayIcon() {
  return <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}

/** M9-N8：运行配置管理（左列增删改+设默认+运行，右列编辑命令）。自定义风格弹窗。 */
export default function RunConfigModal({
  workspaceId,
  root,
  configs,
  activeId,
  onChange,
  onPickActive,
  onRun,
  onClose,
}: {
  workspaceId: string;
  root: string;
  configs: RunConfig[];
  activeId: string | null;
  onChange: (list: RunConfig[]) => void;
  onPickActive: (id: string | null) => void;
  onRun: (c: RunConfig) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<RunConfig[]>(configs);
  const [selId, setSelId] = useState<string | null>(activeId ?? configs[0]?.id ?? null);
  const sel = list.find((c) => c.id === selId) ?? null;
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const persist = (next: RunConfig[]) => { setList(next); saveConfigs(workspaceId, next); onChange(next); };
  const add = () => { const c = emptyConfig(); c.name = "新配置"; persist([...list, c]); setSelId(c.id); onPickActive(c.id); };
  const del = (id: string) => { const next = list.filter((c) => c.id !== id); persist(next); if (selId === id) setSelId(next[0]?.id ?? null); };
  const patch = (p: Partial<RunConfig>) => { if (sel) persist(list.map((c) => (c.id === sel.id ? { ...c, ...p } : c))); };
  const choose = (id: string) => { setSelId(id); onPickActive(id); };
  // 从 <工作区>/.htybox/run-configs.json 导入（按名去重，仅追加新配置）
  const importFromProject = async () => {
    try {
      const r = await readTextFile(`${root}\\.htybox\\run-configs.json`);
      if (!r.editable) return setImportMsg("无法读取 .htybox/run-configs.json");
      const names = new Set(list.map((c) => c.name));
      const fresh = parseImport(r.content).filter((c) => !names.has(c.name));
      if (fresh.length === 0) return setImportMsg("没有新配置可导入");
      persist([...list, ...fresh]);
      setImportMsg(`已导入 ${fresh.length} 个配置`);
    } catch {
      setImportMsg("未找到 .htybox/run-configs.json");
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="flex h-[64vh] w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-[#e5e2d9] px-4 py-3">
          <span className="text-sm font-semibold text-[#191919]">运行配置</span>
          <div className="flex items-center gap-2">
            {importMsg && <span className="truncate text-[10.5px] text-[#a05a3a]">{importMsg}</span>}
            <button onClick={importFromProject} title="从 <工作区>/.htybox/run-configs.json 导入" className="shrink-0 rounded-md bg-[#ecebe2] px-2 py-0.5 text-[11px] font-semibold text-[#73726c] hover:bg-[#e3e1d6] hover:text-[#191919]">从项目导入</button>
            <button onClick={onClose} className="shrink-0 rounded px-2 text-[#a8a29a] hover:text-[#191919]">✕</button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-56 shrink-0 flex-col border-r border-[#e5e2d9] bg-[#faf9f5]">
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {list.length === 0 && <div className="px-1 pt-4 text-center text-[11px] text-[#a8a29a]">还没有配置</div>}
              {list.map((c) => (
                <div key={c.id} className={"flex items-center gap-1 rounded-lg px-2 py-1.5 " + (selId === c.id ? "bg-[#ecebe2]" : "hover:bg-[#f0efe8]")}>
                  <button onClick={(e) => { e.stopPropagation(); onRun(c); }} title="运行" className="shrink-0 text-[#2fa35e] hover:text-[#1f8048]"><PlayIcon /></button>
                  <button onClick={() => choose(c.id)} className="min-w-0 flex-1 truncate text-left text-[12px] text-[#191919]">{c.name || "（未命名）"}</button>
                  {activeId === c.id && <span className="shrink-0 text-[9px] font-bold text-[#d97757]">默认</span>}
                  <button onClick={() => del(c.id)} title="删除" className="shrink-0 text-[11px] text-[#cfcbc2] hover:text-[#d6453e]">✕</button>
                </div>
              ))}
            </div>
            <button onClick={add} className="m-2 rounded-lg border border-dashed border-[#d4a27f] px-2 py-1.5 text-[12px] font-semibold text-[#c15f3c] hover:bg-[#fdf6f2]">+ 新建配置</button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
            {!sel ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-[#a8a29a]">选择或新建一个配置</div>
            ) : (
              <>
                <label className="block">
                  <div className="mb-1 text-[11px] text-[#73726c]">名称</div>
                  <input value={sel.name} onChange={(e) => patch({ name: e.target.value })} className="w-full rounded-md border border-[#e5e2d9] px-2 py-1.5 text-[13px] outline-none focus:border-[#d4a27f]" />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] text-[#73726c]">命令（在 PowerShell 终端执行，如 npm run dev）</div>
                  <textarea value={sel.command} onChange={(e) => patch({ command: e.target.value })} rows={3} className="w-full resize-none rounded-md border border-[#e5e2d9] px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-[#d4a27f]" />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] text-[#73726c]">工作目录（可空 = 工作区根）</div>
                  <input value={sel.cwd ?? ""} onChange={(e) => patch({ cwd: e.target.value })} placeholder="留空用工作区根目录" className="w-full rounded-md border border-[#e5e2d9] px-2 py-1.5 font-mono text-[12px] outline-none focus:border-[#d4a27f]" />
                </label>
                <button onClick={() => onRun(sel)} disabled={!sel.command.trim()} className={"mt-1 self-start rounded-md px-3 py-1.5 text-[12px] font-semibold " + (sel.command.trim() ? "bg-[#2fa35e] text-white hover:bg-[#1f8048]" : "bg-[#ecebe2] text-[#a8a29a]")}>▶ 运行</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
