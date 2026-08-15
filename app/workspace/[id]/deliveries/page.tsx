"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Delivery = { project: { title: string; type: string }; word: { status: string; url: string | null }; videoTasks: { id: string; status: string; outputReady: boolean; prompt: string }[]; redrawJobs: { id: string; status: string; outputReady: boolean; downloadUrl: string | null }[]; scripts: { id: string; status: string }[] };

export default function DeliveriesPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Delivery | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { fetch(`/api/projects/${encodeURIComponent(id)}/deliveries`, { cache: "no-store" }).then(async (response) => { const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || "PROJECT_DELIVERIES_UNAVAILABLE"); setData(value); }).catch(() => setMessage("交付状态暂时无法读取，请稍后重试。")); }, [id]);
  if (!data) return <main className="workflow-page"><SiteHeader /><div className="workspace-loading">{message || "正在读取项目交付…"}</div></main>;
  return <main className="workflow-page"><SiteHeader /><section className="workflow-shell"><header className="workflow-heading"><div><Link href={`/workspace/${encodeURIComponent(id)}`} className="workflow-back">← 项目工作台</Link><p>DELIVERIES</p><h1>{data.project.title}</h1><span>{data.project.type} · 真实交付</span></div></header><section className="delivery-grid"><article className="delivery-card"><span>STEP 04</span><h2>Word 交付</h2><b>{data.word.status === "ready" ? "可下载" : "尚未回读到真实 Word"}</b>{data.word.url ? <a href={data.word.url} download>下载 Word</a> : <p>只有真实文件路径和网站读取结果都确认后，这里才会开放下载。</p>}</article><article className="delivery-card"><span>VIDEO</span><h2>视频任务</h2>{data.videoTasks.length ? data.videoTasks.map((task) => <div className="delivery-row" key={task.id}><b>{task.outputReady ? "已完成" : task.status}</b><span>{task.prompt || "视频任务"}</span></div>) : <p>还没有已确认的视频交付。</p>}</article><article className="delivery-card"><span>REDRAW</span><h2>转绘产物</h2>{data.redrawJobs.length ? data.redrawJobs.map((job) => <div className="delivery-row" key={job.id}><b>{job.outputReady ? "已完成" : job.status}</b>{job.downloadUrl ? <a href={job.downloadUrl} download>下载产物</a> : null}</div>) : <p>还没有已确认的转绘产物。</p>}</article></section></section></main>;
}
