"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type CreditData = {
  balance: number;
  pricing: { recharge: { yuanPerCredit: number; packages: number[]; shopUrl: string | null; configured: boolean } };
  ledger: { id: string; amount: number; balanceAfter: number; reason: string; createdAt: string }[];
};

const reasonLabels: Record<string, string> = {
  ldxp_redeem: "兑换积分",
  video_automatic_reservation: "视频任务扣除",
  video_manual_reservation: "视频任务扣除",
  video_task_refund: "任务退款",
};
const packageLinks: Record<number, string> = {
  100: "https://pay.ldxp.cn/item/dk8n6w",
  300: "https://pay.ldxp.cn/item/jzmhxg",
  500: "https://pay.ldxp.cn/item/oixq4k",
  1000: "https://pay.ldxp.cn/item/6jt6a2",
};

export default function CreditsPage() {
  const router = useRouter();
  const [data, setData] = useState<CreditData | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()).then((session) => {
      if (!session.user) { router.replace("/login?next=/credits"); return; }
      return fetch("/api/credits", { cache: "no-store" });
    }).then((response) => response?.json()).then((payload) => { if (payload) setData(payload); }).catch(() => setMessage("积分信息暂时无法读取"));
  }, [router]);

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) { setMessage("请输入兑换码"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/credits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "redeem_ldxp_code", code }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "兑换失败");
      setCode(""); setMessage(`兑换成功，已到账 ${payload.redeemedCredits} 积分`);
      const refreshed = await fetch("/api/credits", { cache: "no-store" });
      if (refreshed.ok) setData(await refreshed.json());
    } catch (error) { setMessage(error instanceof Error ? error.message : "兑换失败，请检查兑换码"); }
    finally { setBusy(false); }
  }

  const pricing = data?.pricing.recharge;
  return <main className="credits-page"><SiteHeader />
    <section className="credits-shell">
      <header className="credits-heading"><button type="button" onClick={() => router.push("/home")}>← 返回工作台</button><div><p>NIANNIAN CREDITS</p><h1>积分中心</h1></div><div className="credits-balance"><span>当前余额</span><b>{data?.balance ?? "--"}</b><em>积分</em><button type="button" className="credits-contact-button" onClick={() => setContactOpen(true)}>联系客服</button></div></header>
      <div className="credits-layout">
        <section className="credits-panel credits-purchase-panel"><div className="credits-panel-heading"><h2>购买积分</h2><span>选择套餐后前往链动小铺</span></div><div className="credits-package-grid">{(pricing?.packages ?? [100, 300, 500, 1000]).map((amount) => <a className="credits-package" key={amount} href={packageLinks[amount] ?? pricing?.shopUrl ?? "https://pay.ldxp.cn"} target="_blank" rel="noopener noreferrer"><b>{amount} 积分</b><strong>¥{(amount * (pricing?.yuanPerCredit ?? 0.1)).toFixed(2)}</strong><span>购买卡密 →</span></a>)}</div></section>
        <section className="credits-panel credits-redeem-panel"><div className="credits-panel-heading"><h2>兑换积分</h2><span>输入购买后获得的卡密</span></div><form onSubmit={redeem}><label htmlFor="credit-code">积分兑换码</label><input id="credit-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="粘贴兑换码" autoComplete="off" /><button type="submit" disabled={busy}>{busy ? "兑换中…" : "兑换并到账"}</button>{message ? <p role="status">{message}</p> : null}</form></section>
      </div>
      <section className="credits-panel credits-ledger-panel"><div className="credits-panel-heading"><h2>积分明细</h2><span>最近 30 条记录</span></div>{data?.ledger?.length ? <div className="credits-ledger">{data.ledger.map((entry) => <div key={entry.id}><span>{reasonLabels[entry.reason] ?? "积分变动"}</span><time>{new Date(entry.createdAt).toLocaleString("zh-CN")}</time><b className={entry.amount >= 0 ? "positive" : "negative"}>{entry.amount >= 0 ? "+" : ""}{entry.amount}</b><small>余额 {entry.balanceAfter}</small></div>)}</div> : <div className="credits-empty">暂无积分明细</div>}</section>
      {contactOpen ? <div className="credits-contact-backdrop" role="presentation" onClick={() => setContactOpen(false)}><section className="credits-contact-dialog" role="dialog" aria-modal="true" aria-labelledby="credits-contact-title" onClick={(event) => event.stopPropagation()}><header><div><p>NIANNIAN SUPPORT</p><h2 id="credits-contact-title">联系客服</h2></div><button type="button" className="credits-contact-close" aria-label="关闭联系客服" onClick={() => setContactOpen(false)}>×</button></header><img src="/contact-qrcode.jpg" alt="联系客服二维码" /><span>扫码添加好友，获取充值和使用帮助</span></section></div> : null}
    </section>
  </main>;
}
