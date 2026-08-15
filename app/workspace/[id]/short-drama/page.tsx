"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type RequestItem = { id: string; status: string; createdAt?: string; updatedAt?: string };

export default function ShortDramaPage() {
  const { id } = useParams<{ id: string }>();
  const [sourceText, setSourceText] = useState("");
  const [requirements, setRequirements] = useState("");
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { fetch(`/api/projects/${encodeURIComponent(id)}/short-drama`, { cache: "no-store" }).then((r) => r.json()).then((data) => setRequests(Array.isArray(data.requests) ? data.requests : [])).catch(() => undefined); }, [id]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!sourceText.trim()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/short-drama`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceText, requirements }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "SHORT_DRAMA_CREATE_FAILED");
      setRequests((items) => [data.request, ...items]); setSourceText(""); setRequirements(""); setMessage("剧本已登记，等待既有短剧生产线程接管。");
    } catch (error) { setMessage(error instanceof Error ? `提交失败：${error.message}` : "提交失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <main className="workflow-page"><SiteHeader /><section className="workflow-shell"><header className="workflow-heading"><div><Link href={`/workspace/${encodeURIComponent(id)}`} className="workflow-back">← 项目工作台</Link><p>SHORT DRAMA</p><h1>一键短剧</h1><span>从剧本输入开始，进入既有短剧生产流程。</span></div><Link href={`/workspace/${encodeURIComponent(id)}/deliveries`} className="workflow-delivery-link">项目交付</Link></header><div className="workflow-grid"><form className="workflow-panel" onSubmit={submit}><label>剧本正文<textarea value={sourceText} maxLength={120000} onChange={(event) => setSourceText(event.target.value)} placeholder="粘贴小说章节、故事梗概或剧本正文。" /></label><label>制作需求<textarea value={requirements} maxLength={4000} onChange={(event) => setRequirements(event.target.value)} placeholder="填写改编方向、集数或其他需求。" /></label><p className="workflow-note">提交后由既有任务管理线程接管，网站只回读项目状态和真实交付。</p>{message ? <div className="workflow-message" role="status">{message}</div> : null}<button type="submit" disabled={busy || !sourceText.trim()}>{busy ? "正在登记…" : "登记剧本"}</button></form><section className="workflow-panel"><header><b>项目请求</b><span>{requests.length} 条</span></header>{requests.length ? <div className="workflow-list">{requests.map((item) => <article key={item.id}><b>{item.status === "awaiting_production_dispatch" ? "等待生产线程" : item.status}</b><small>{item.updatedAt || item.createdAt || ""}</small></article>)}</div> : <div className="workflow-empty">还没有剧本请求。</div>}</section></div></section></main>;
}
