"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Asset = { id: string; name: string; role: string; previewUrl: string; hidden: boolean };
type Job = { id: string; status: string; outputReady: boolean; downloadUrl: string | null };

async function upload(projectId: string, file: File, role: string) {
  const form = new FormData(); form.set("file", file); form.set("role", role);
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "ASSET_UPLOAD_FAILED");
  return data.asset as Asset;
}

export default function RedrawPage() {
  const { id } = useParams<{ id: string }>();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [source, setSource] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [requirements, setRequirements] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { Promise.all([fetch(`/api/projects/${encodeURIComponent(id)}/assets`, { cache: "no-store" }).then((r) => r.json()), fetch("/api/redraw/jobs", { cache: "no-store" }).then((r) => r.json())]).then(([assetData, jobData]) => { setAssets(Array.isArray(assetData.assets) ? assetData.assets : []); setJobs(Array.isArray(jobData.jobs) ? jobData.jobs.filter((job: { projectId?: string }) => job.projectId === id) : []); }).catch(() => setMessage("项目素材暂时无法读取。")); }, [id]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!source) return;
    setBusy(true); setMessage("");
    try {
      const sourceAsset = await upload(id, source, "scene");
      const referenceAsset = reference ? await upload(id, reference, "product") : null;
      const response = await fetch("/api/redraw/jobs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `website-redraw-${id}-${Date.now()}` }, body: JSON.stringify({ project_id: id, source_asset_id: sourceAsset.id, reference_asset_ids: referenceAsset ? [referenceAsset.id] : [], requirements: { subject_mode: "product", preserve_subject: true, target_style: requirements, scene: "", change_scene: false, aspect_ratio: "9:16" } }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "REDRAW_JOB_CREATE_FAILED");
      setJobs((items) => [data.job, ...items]); setAssets((items) => [sourceAsset, ...(referenceAsset ? [referenceAsset] : []), ...items]); setSource(null); setReference(null); setRequirements(""); setMessage("转绘任务已进入既有生产队列。");
    } catch (error) { setMessage(error instanceof Error ? `提交失败：${error.message}` : "提交失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <main className="workflow-page"><SiteHeader /><section className="workflow-shell"><header className="workflow-heading"><div><Link href={`/workspace/${encodeURIComponent(id)}`} className="workflow-back">← 项目工作台</Link><p>REDRAW</p><h1>一键转绘</h1><span>原片图片、参考素材和需求会绑定到当前项目。</span></div><Link href={`/workspace/${encodeURIComponent(id)}/deliveries`} className="workflow-delivery-link">项目交付</Link></header><div className="workflow-grid"><form className="workflow-panel" onSubmit={submit}><label>原片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSource(event.target.files?.[0] || null)} /></label><label>参考素材<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReference(event.target.files?.[0] || null)} /></label><label>需求<textarea value={requirements} maxLength={2000} onChange={(event) => setRequirements(event.target.value)} placeholder="填写希望保留的主体、场景和风格。" /></label><p className="workflow-note">提交后继续走既有转绘队列和质量门，不在网站里直接调用 Provider。</p>{message ? <div className="workflow-message" role="status">{message}</div> : null}<button type="submit" disabled={busy || !source}>{busy ? "正在上传并创建…" : "开始转绘"}</button></form><section className="workflow-panel"><header><b>当前项目转绘任务</b><span>{jobs.length} 条</span></header>{jobs.length ? <div className="workflow-list">{jobs.map((job) => <article key={job.id}><b>{job.outputReady ? "已完成" : job.status}</b>{job.downloadUrl ? <a href={job.downloadUrl} download>下载产物</a> : null}</article>)}</div> : <div className="workflow-empty">还没有转绘任务。</div>}{assets.length ? <small className="workflow-assets-count">当前项目已有 {assets.filter((asset) => !asset.hidden).length} 个素材</small> : null}</section></div></section></main>;
}
