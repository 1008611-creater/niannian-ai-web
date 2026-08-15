"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Overview = { project: { id: string; title: string; type: string; status: string; progress: number }; assets: unknown[]; tasks: { status: string }[]; scripts: { status: string }[] };

const entries = [
  { key: "canvas", href: (id: string) => `/studio/${encodeURIComponent(id)}`, title: "无限画布", label: "NOMI CANVAS", detail: "把文本、素材和生成任务放进同一个创作空间。" },
  { key: "redraw", href: (id: string) => `/workspace/${encodeURIComponent(id)}/redraw`, title: "一键转绘", label: "REDRAW", detail: "上传原片、参考素材和需求，进入既有转绘流程。" },
  { key: "short_drama", href: (id: string) => `/workspace/${encodeURIComponent(id)}/short-drama`, title: "一键短剧", label: "SHORT DRAMA", detail: "从剧本输入开始，交给既有短剧生产流程。" },
];

export default function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(id)}/overview`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { location.assign(`/login?next=/workspace/${encodeURIComponent(id)}`); return; }
      if (!response.ok) throw new Error(data.error || "PROJECT_OVERVIEW_UNAVAILABLE");
      setOverview(data);
    }).catch(() => setMessage("项目暂时无法读取，请返回项目列表重试。"));
  }, [id]);
  if (!overview) return <main className="workspace-page"><SiteHeader /><div className="workspace-loading">{message || "正在打开项目工作台…"}</div></main>;
  return <main className="workspace-page"><SiteHeader /><section className="workspace-shell">
    <header className="workspace-heading"><div><Link href="/projects" className="workspace-back">← 项目</Link><p>PROJECT WORKSPACE</p><h1>{overview.project.title}</h1><span>{overview.project.type} · {overview.project.status}</span></div><Link href={`/workspace/${encodeURIComponent(id)}/deliveries`} className="workspace-delivery-link">项目交付</Link></header>
    <section className="workspace-entry-grid" aria-label="创作入口">{entries.map((entry) => <Link className="workspace-entry" key={entry.key} href={entry.href(id)}><span>{entry.label}</span><h2>{entry.title}</h2><p>{entry.detail}</p><b>进入 →</b></Link>)}</section>
    <section className="workspace-summary"><div><span>项目进度</span><b>{overview.project.progress || 0}%</b></div><div><span>项目素材</span><b>{overview.assets.length}</b></div><div><span>项目任务</span><b>{overview.tasks.length}</b></div><div><span>短剧请求</span><b>{overview.scripts.length}</b></div></section>
  </section></main>;
}
