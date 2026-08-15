"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Project = { id: string; title: string; type: string; status: string; updated_at: string };

export default function CanvasProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("我的视频画布");
  const [type, setType] = useState("真人短剧");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { setAuthRequired(true); setLoading(false); window.location.assign("/login?next=/canvas"); return; }
        if (!response.ok) throw new Error(data.error || "PROJECTS_UNAVAILABLE");
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      })
      .catch(() => setMessage("项目暂时无法读取，请刷新重试。"))
      .finally(() => setLoading(false));
  }, [router]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, type }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PROJECT_CREATE_FAILED");
       router.push(`/studio/${data.project.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? `创建失败：${error.message}` : "创建失败，请重试。");
    } finally {
      setCreating(false);
    }
  }

  return <main className="canvas-projects-page">
    <SiteHeader />
    <section className="canvas-projects-shell">
      <header className="canvas-projects-heading">
        <div><p>NOMI CANVAS</p><h1>选择视频项目</h1></div>
         <Link href="/projects" className="canvas-quiet-button">返回项目</Link>
      </header>
      {loading ? <div className="canvas-empty-state">正在读取项目…</div> : authRequired ? <div className="canvas-empty-state"><b>请先登录念念 AI</b><Link href="/login?next=/canvas" className="canvas-primary-button">前往登录</Link></div> : <div className="canvas-projects-layout">
        <section className="canvas-project-list" aria-label="已有项目">
          <div className="canvas-section-title"><span>已有项目</span><small>{projects.length} 个</small></div>
           {projects.length ? projects.map((project) => <button className="canvas-project-item" type="button" key={project.id} onClick={() => router.push(`/studio/${project.id}`)}>
            <span className="canvas-project-mark">{project.type.slice(0, 1)}</span>
            <span><b>{project.title}</b><small>{project.type} · {project.status}</small></span>
            <span aria-hidden="true">→</span>
          </button>) : <div className="canvas-list-empty">还没有项目，先创建一个画布。</div>}
        </section>
        <form className="canvas-create-project" onSubmit={createProject}>
          <div className="canvas-section-title"><span>新建画布项目</span><small>项目数据会绑定到你的账户</small></div>
          <label>项目名称<input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>项目类型<select value={type} onChange={(event) => setType(event.target.value)}><option>真人短剧</option><option>动态漫</option><option>广告片</option></select></label>
          {message ? <p className="canvas-form-message" role="alert">{message}</p> : null}
          <button className="canvas-primary-button" type="submit" disabled={creating}>{creating ? "正在创建…" : "进入 Nomi 画布"}</button>
        </form>
      </div>}
    </section>
  </main>;
}
