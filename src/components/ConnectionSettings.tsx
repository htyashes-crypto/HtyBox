import { useEffect, useState } from "react";
import { getLanEnabled, pairingOffer, setLanEnabled, type PairingOffer } from "../catalog";

/** 小开关（与 SettingsModal 同风格，本组件自带以解耦）。 */
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={"relative h-5 w-9 shrink-0 rounded-full transition-colors " + (on ? "bg-[var(--accent)]" : "bg-[var(--border)]")}
    >
      <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all " + (on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/** 设置「连接」区（L3）：展示监听端点 + LAN 开关 + 配对二维码/链接（手机扫码连接此 Host）。 */
export default function ConnectionSettings() {
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [lan, setLan] = useState(false);
  const [copied, setCopied] = useState(false);
  const [needRestart, setNeedRestart] = useState(false);

  const reload = () => {
    pairingOffer()
      .then(setOffer)
      .catch(() => setOffer(null));
    getLanEnabled()
      .then(setLan)
      .catch(() => {});
  };
  useEffect(reload, []);

  const toggleLan = async () => {
    const next = !lan;
    setLan(next);
    try {
      await setLanEnabled(next);
      setNeedRestart(true);
      reload();
    } catch {
      setLan(!next); // 失败回滚
    }
  };

  const copy = () => {
    if (!offer) return;
    navigator.clipboard
      .writeText(offer.offerUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="border-t border-[var(--border-soft)] pt-5">
      <div className="mb-1 text-[13px] font-semibold text-[var(--text)]">连接（手机配对）</div>
      <div className="mb-3 text-[11px] leading-relaxed text-[var(--text-3)]">
        在手机上用 HtyBox 扫码或粘贴链接，即可远程查看 / 操控本机终端。仅在同一局域网内可用（relay 远程后续支持）。
      </div>

      <div className="mb-2 flex items-center justify-between gap-3 text-[12px]">
        <span className="text-[var(--text-2)]">
          监听 <code className="font-mono text-[var(--text)]">127.0.0.1:{offer?.port ?? "…"}</code>
          {lan && offer?.lanEndpoint ? (
            <>
              {" · LAN "}
              <code className="font-mono text-[var(--accent-text)]">{offer.lanEndpoint}</code>
            </>
          ) : null}
        </span>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-[var(--text)]">允许局域网（LAN）访问</div>
          <div className="text-[10.5px] text-[var(--text-3)]">开启后绑定 0.0.0.0，远程连接强制端到端加密</div>
        </div>
        <Toggle on={lan} onChange={toggleLan} />
      </div>
      {needRestart && (
        <div className="mb-3 rounded-md border border-[var(--accent-border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[10.5px] text-[var(--accent-text)]">
          LAN 开关已更改，重启 HtyBox 后生效。
        </div>
      )}

      {lan ? (
        offer && offer.lanEndpoint ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-4">
            <div className="h-[220px] w-[220px] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: offer.qrSvg }} />
            <div className="text-[10.5px] text-[var(--text-3)]">扫描二维码，或复制链接发到手机</div>
            <button
              onClick={copy}
              className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--accent-text)]"
            >
              {copied ? "已复制" : "复制配对链接"}
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-[var(--text-3)]">正在生成配对信息…（确认本机已联网以探测 LAN 地址）</div>
        )
      ) : (
        <div className="rounded-md bg-[var(--surface-soft)] px-3 py-2.5 text-[11px] text-[var(--text-3)]">
          开启「局域网访问」后在此显示配对二维码（手机需与本机同一 WiFi）。
        </div>
      )}
    </div>
  );
}
