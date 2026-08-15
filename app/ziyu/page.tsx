"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type Mode = "i2v" | "t2v" | "t2i";
type AssetType = "image" | "video" | "audio";
type Model = {
  id: string; name: string; type: string; modes: Mode[]; allowedDurations: number[]; allowedRatios: string[];
  allowedAssetTypes: AssetType[]; assetLimits: Record<string, number>; resolution: string; promptMaxLength: number;
  cost: number | null; costPerSecond: number | null; durationCosts: Record<string, number>;
};
type Job = { id: string; status: string; previewUrl: string | null; failureReason?: string; message?: string };

const modeLabels: Record<Mode, string> = { i2v: "图生视频", t2v: "文生视频", t2i: "文生图" };
const assetLabels: Record<AssetType, string> = { image: "图片参考", video: "视频参考", audio: "音频参考" };

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function jobLabel(status: string) {
  const labels: Record<string, string> = { queued: "排队中", processing: "生成中", running: "生成中", completed: "已完成", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
  return labels[status] ?? status;
}

export default function ZiyuPage() {
  const router = useRouter();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<Mode>("i2v");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("");
  const [duration, setDuration] = useState("");
  const [files, setFiles] = useState<Record<AssetType, File[]>>({ image: [], video: [], audio: [] });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const model = useMemo(() => models.find((item) => item.id === selectedId) ?? models[0], [models, selectedId]);
  const durations = model?.allowedDurations ?? [];
  const ratios = model?.allowedRatios ?? [];
  const cost = duration && model ? model.durationCosts[duration] ?? (model.costPerSecond ? model.costPerSecond * Number(duration) : model.cost) : model?.cost;

  async function loadJobs() {
    const response = await fetch("/api/ziyu/jobs?limit=30", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setJobs((payload.jobs ?? []).filter((item: Job) => typeof item.id === "string").map((item: Job) => ({ ...item, previewUrl: item.previewUrl ?? null })));
  }

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()).then((session) => {
      if (!session.user) { router.replace("/login?next=/ziyu"); return; }
      return fetch("/api/providers", { cache: "no-store" });
    }).then((response) => response?.json()).then((payload) => {
      const available = Array.isArray(payload?.ziyu?.models) ? payload.ziyu.models as Model[] : [];
      setModels(available);
      setSelectedId(available[0]?.id ?? "");
      void loadJobs();
    }).catch(() => setMessage("紫域模型目录暂时无法读取，请稍后刷新"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!model) return;
    const nextMode = model.modes.includes(mode) ? mode : model.modes[0];
    setMode(nextMode);
    setRatio((current) => model.allowedRatios.includes(current) ? current : model.allowedRatios[0] ?? "");
    setDuration((current) => model.allowedDurations.includes(Number(current)) ? current : model.allowedDurations[0] ? String(model.allowedDurations[0]) : "");
    setFiles({ image: [], video: [], audio: [] });
  }, [model?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => { void loadJobs(); }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  function selectFiles(type: AssetType, event: ChangeEvent<HTMLInputElement>) {
    if (!model) return;
    const limit = model.assetLimits[type] ?? 10;
    const next = Array.from(event.target.files ?? []);
    setFiles((current) => ({ ...current, [type]: [...current[type], ...next].slice(0, limit) }));
    event.target.value = "";
  }

  async function createJob() {
    if (!model || !prompt.trim()) { setMessage("请先填写生成描述"); return; }
    if (prompt.length > model.promptMaxLength && model.promptMaxLength > 0) { setMessage(`描述不能超过 ${model.promptMaxLength} 字`); return; }
    if (mode === "i2v" && !files.image.length && !files.video.length) { setMessage("当前图生视频模式需要图片或视频参考"); return; }
    setSubmitting(true); setMessage("正在上传参考素材并创建紫域任务…");
    try {
      const uploadFiles = (Object.entries(files) as [AssetType, File[]][]).flatMap(([type, entries]) => entries.map((file) => ({ type, name: file.name, file })));
      const uploaded: Record<AssetType, Array<{ url: string }>> = { image: [], video: [], audio: [] };
      if (uploadFiles.length) {
        const response = await fetch("/api/ziyu/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: await Promise.all(uploadFiles.map(async ({ type, name, file }) => ({ type, name, data: await fileToDataUrl(file) }))) }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "ZIYU_UPLOAD_FAILED");
        (payload.assets ?? []).forEach((asset: { url?: string; type?: AssetType }, index: number) => { const source = uploadFiles[index]; if (asset.url && source) uploaded[asset.type ?? source.type].push({ url: asset.url }); });
      }
      const response = await fetch("/api/ziyu/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: model.id, mode, prompt: prompt.trim(), ratio: ratio || undefined, duration: duration || undefined, assets: uploaded }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "ZIYU_JOB_CREATE_FAILED");
      setMessage("紫域任务已创建，正在等待结果。");
      setPrompt(""); setFiles({ image: [], video: [], audio: [] });
      await loadJobs();
    } catch (error) { setMessage(error instanceof Error ? `创建失败：${error.message}` : "创建失败，请稍后重试"); }
    finally { setSubmitting(false); }
  }

  if (loading) return <main className="ziyu-page"><SiteHeader /><div className="ziyu-shell ziyu-empty">正在读取紫域模型目录…</div></main>;
  return (
    <main className="ziyu-page">
      <SiteHeader />
      <section className="ziyu-shell">
        <header className="ziyu-heading"><div><p>ZIYU API</p><h1>紫域模型工作台</h1><span>实时目录 · {models.length} 个模型 · 图片、视频、音频参考</span></div><a href="/home">返回标准工作台</a></header>
        {!model ? <div className="ziyu-panel ziyu-empty"><b>紫域模型目录不可用</b><span>{message || "请检查服务配置后刷新页面"}</span></div> : <div className="ziyu-layout">
          <section className="ziyu-panel ziyu-form">
            <label className="ziyu-label">模型</label>
            <select className="ziyu-select" value={model.id} onChange={(event) => setSelectedId(event.target.value)}>{models.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
            <div className="ziyu-model-meta"><span>{model.type === "image" ? "图像模型" : "视频模型"}</span><span>{model.resolution || "自适应清晰度"}</span>{model.cost !== null ? <span>{model.cost} 积分起</span> : null}</div>
            <label className="ziyu-label">生成模式</label>
            <div className="ziyu-segmented">{model.modes.map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
            <label className="ziyu-label" htmlFor="ziyu-prompt">生成描述</label>
            <textarea id="ziyu-prompt" className="ziyu-prompt" maxLength={model.promptMaxLength || 10000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "t2i" ? "描述画面主体、风格、构图和光线" : "描述主体、动作、镜头运动和节奏"} />
            <div className="ziyu-count">{prompt.length} / {model.promptMaxLength || 10000}</div>
            <div className="ziyu-option-grid">
              {durations.length ? <label><span>时长</span><select className="ziyu-select" value={duration} onChange={(event) => setDuration(event.target.value)}>{durations.map((item) => <option key={item} value={item}>{item} 秒</option>)}</select></label> : null}
              {ratios.length ? <label><span>比例</span><select className="ziyu-select" value={ratio} onChange={(event) => setRatio(event.target.value)}>{ratios.map((item) => <option key={item}>{item}</option>)}</select></label> : null}
            </div>
            {model.allowedAssetTypes.length ? <div className="ziyu-assets"><label className="ziyu-label">参考素材</label><div className="ziyu-asset-buttons">{model.allowedAssetTypes.map((type) => <label className="ziyu-file-button" key={type}><input type="file" multiple accept={type === "image" ? "image/*" : type === "video" ? "video/*" : "audio/*"} onChange={(event) => selectFiles(type, event)} /><span>+ {assetLabels[type]}</span><small>{files[type].length}/{model.assetLimits[type] ?? 10}</small></label>)}</div><div className="ziyu-file-list">{(Object.entries(files) as [AssetType, File[]][]).flatMap(([type, entries]) => entries.map((file, index) => <button type="button" key={`${type}-${file.name}-${index}`} onClick={() => setFiles((current) => ({ ...current, [type]: current[type].filter((_, itemIndex) => itemIndex !== index) }))}>{file.name} ×</button>))}</div></div> : null}
            {message ? <p className="ziyu-message" role="status">{message}</p> : null}
            <button className="ziyu-submit" type="button" disabled={submitting} onClick={createJob}>{submitting ? "创建中…" : `创建紫域任务${cost ? ` · ${cost} 积分` : ""}`}</button>
          </section>
          <aside className="ziyu-panel ziyu-catalogue"><header><div><h2>模型能力</h2><span>当前模型的真实限制</span></div><b>{model.modes.map((item) => modeLabels[item]).join(" / ")}</b></header><dl><div><dt>参考类型</dt><dd>{model.allowedAssetTypes.length ? model.allowedAssetTypes.map((item) => assetLabels[item]).join("、") : "无需参考素材"}</dd></div><div><dt>支持比例</dt><dd>{ratios.length ? ratios.join("、") : "自动"}</dd></div><div><dt>支持时长</dt><dd>{durations.length ? `${durations[0]}-${durations[durations.length - 1]} 秒` : "不适用"}</dd></div><div><dt>清晰度</dt><dd>{model.resolution || "自适应"}</dd></div></dl><p className="ziyu-note">“不卡人脸”等名称是渠道原始描述，工作台会按接口返回的限制提交参数。</p></aside>
        </div>}
        <section className="ziyu-panel ziyu-jobs"><header><div><h2>紫域任务</h2><span>自动刷新任务状态</span></div><button type="button" onClick={() => void loadJobs()}>刷新</button></header>{jobs.length ? <div className="ziyu-job-list">{jobs.map((job) => <article key={job.id}><div><b>{jobLabel(job.status)}</b><span>{job.id}</span></div>{job.previewUrl ? <a href={job.previewUrl} target="_blank" rel="noreferrer">查看结果</a> : <small>{job.failureReason || job.message || "等待结果"}</small>}</article>)}</div> : <div className="ziyu-empty">还没有紫域任务</div>}</section>
      </section>
    </main>
  );
}
