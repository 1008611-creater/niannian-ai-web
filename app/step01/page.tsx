"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Result = { project: { projectId: string; analysisRunId: string }; result: { status: "completed" | "not_ready"; blocker: string | null; artifacts: Array<{ role: string; mimeType: string; index: number }> } };
const names: Record<string, string> = { asr: "语音字幕", alignment: "时间对齐", ocr: "屏幕文字", shots: "镜头切分", frames: "原分辨率关键帧" };

export default function Step01Page() {
  const router = useRouter();
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    const response = await fetch("/api/admin/video-redraw-step01", { cache: "no-store" });
    if (response.status === 403) { router.replace("/login?next=/step01"); return; }
    if (!response.ok) { setError("暂时无法读取 Step01 结果"); return; }
    setData(await response.json());
  };
  useEffect(() => { load().catch(() => setError("暂时无法读取 Step01 结果")); }, []);
  return <main className="redraw-page"><SiteHeader /><section className="redraw-shell"><header className="redraw-heading"><p>念念 AI · 视频转绘</p><h1>源视频分析</h1><span>字幕、屏幕文字、镜头和关键帧只会在服务器完成完整 Step01 证据后显示。</span></header><section className="redraw-panel redraw-results"><header><div><span>Step01</span><h2>短剧源视频证据</h2></div><button onClick={() => load().catch(() => setError("刷新失败"))}>刷新状态</button></header>{error ? <p className="redraw-message">{error}</p> : null}{!data ? <p>正在读取结果…</p> : data.result.status !== "completed" ? <div className="redraw-empty"><strong>尚未生成可用分析结果</strong><span>当前状态：{data.result.blocker ?? "等待服务器执行"}</span></div> : <div className="redraw-job-list">{data.result.artifacts.map((artifact) => <article className="redraw-job status-completed" key={artifact.index}><header><strong>{names[artifact.role] ?? artifact.role}</strong></header>{artifact.mimeType.startsWith("image/") ? <img src={`/api/admin/video-redraw-step01/artifacts/${artifact.index}`} alt={names[artifact.role] ?? artifact.role} style={{ maxWidth: "100%", height: "auto" }} /> : <a className="redraw-download" href={`/api/admin/video-redraw-step01/artifacts/${artifact.index}`}>查看证据</a>}</article>)}</div>}</section></section></main>;
}
