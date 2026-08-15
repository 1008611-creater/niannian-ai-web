"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

type Project = { id: string; title: string; type: string; status: string; progress: number; updatedAt: string; episodes: number };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("真人短剧");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { location.assign("/login?next=/projects"); return; }
      if (!response.ok) throw new Error(data.error || "PROJECTS_UNAVAILABLE");
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch { setMessage("项目暂时无法读取，请稍后重试。"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true); setMessage("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, type }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PROJECT_CREATE_FAILED");
      location.assign(`/workspace/${encodeURIComponent(data.project.id)}`);
    } catch (error) { setMessage(error instanceof Error ? `创建失败：${error.message}` : "创建失败，请重试。"); }
    finally { setCreating(false); }
  }

  return <main className="project-hub-page">
    <SiteHeader />
    <section className="project-hub-shell">
      <header className="project-hub-heading">
        <div><p>PROJECTS</p><h1>我的项目</h1><span>从一个项目进入全部创作工具。</span></div>
        <Link className="project-hub-task-link" href="/tasks">查看全部任务</Link>
      </header>
      <div className="project-hub-layout">
        <section className="project-hub-list" aria-label="我的项目">
          <div className="project-hub-section-title"><b>项目</b><span>{projects.length} 个</span></div>
          {loading ? <div className="project-hub-empty">正在读取项目…</div> : projects.length ? <div className="project-hub-projects">{projects.map((project) => <Link className="project-hub-project" key={project.id} href={`/workspace/${encodeURIComponent(project.id)}`}>
            <span className="project-hub-project-mark">{project.type.slice(0, 1)}</span>
            <span className="project-hub-project-copy"><b>{project.title}</b><small>{project.type} · {project.status}</small></span>
            <span className="project-hub-project-progress">{Math.max(0, Math.min(100, Number(project.progress) || 0))}%</span>
            <span aria-hidden="true">→</span>
          </Link>)}</div> : <div className="project-hub-empty">还没有项目，先创建一个。</div>}
        </section>
        <form className="project-hub-create" onSubmit={createProject}>
          <div className="project-hub-section-title"><b>新建项目</b><span>项目创建后进入工作台</span></div>
          <label>项目名称<input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="例如：我的第一部短剧" /></label>
          <label>内容类型<select value={type} onChange={(event) => setType(event.target.value)}><option>真人短剧</option><option>动态漫</option><option>广告片</option></select></label>
          {message ? <p className="project-hub-message" role="alert">{message}</p> : null}
          <button type="submit" disabled={creating}>{creating ? "正在创建…" : "创建项目"}</button>
        </form>
      </div>
    </section>
  </main>;
}
