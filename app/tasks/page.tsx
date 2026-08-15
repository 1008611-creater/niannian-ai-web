"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

type Task = { id: string; prompt: string; status: string; createdAt: string; updatedAt: string; outputReady: boolean };

const labels: Record<string, string> = { queued: "排队中", queued_skill: "排队中", processing: "处理中", running: "处理中", completed: "已完成", blocked: "需要处理", needs_you: "需要处理", authorization: "等待确认" };

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/video-tasks", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) { location.assign("/login?next=/tasks"); return; }
      const data = await response.json().catch(() => ({}));
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);
  return <main className="project-hub-page"><SiteHeader /><section className="task-hub-shell">
    <header className="project-hub-heading"><div><p>TASKS</p><h1>全部任务</h1><span>查看你参与的所有生成任务。</span></div><Link className="project-hub-task-link" href="/projects">返回项目</Link></header>
    {loading ? <div className="project-hub-empty">正在读取任务…</div> : !tasks.length ? <div className="project-hub-empty">还没有任务。</div> : <div className="task-hub-list">{tasks.map((task) => <article key={task.id}><div><b>{labels[task.status] || task.status}</b><small>{new Date(task.updatedAt || task.createdAt).toLocaleString("zh-CN")}</small></div><p>{task.prompt || "未命名任务"}</p><span>{task.outputReady ? "已有真实产物" : "等待结果"}</span></article>)}</div>}
  </section></main>;
}
