"use client";

import Link from "next/link";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState, WheelEvent } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { CanvasDocument, CanvasEdge, CanvasNode, CanvasNodeKind, shortdramaWorkflowDocument, workflowNodeMeta } from "@/lib/canvas-contract";

type Asset = { id: string; role: "character" | "product" | "scene"; name: string; mimeType: string; hidden: boolean; previewUrl: string };
type Project = { id: string; title: string; type: string };
type Task = { id: string; status: string; outputReady: boolean; outputUrl: string | null; prompt: string };

const NODE_WIDTH = 258;
const NODE_HEIGHT = 166;
const nodeNames: Record<CanvasNodeKind, string> = { text: "文本意图", asset: "参考素材", image: "图片节点", video: "视频节点", workflow: "转绘节点" };
const nodeHints: Record<CanvasNodeKind, string> = { text: "拆解画面、动作与情绪", asset: "接入人物、商品或场景", image: "承接图片生成结果", video: "提交到念念视频任务", workflow: "结构化 Skill 节点" };

function makeNode(projectId: string, kind: CanvasNodeKind, index: number): CanvasNode {
  const defaults = kind === "video" ? { title: "视频生成", prompt: "", status: "draft", durationSeconds: 5, aspectRatio: "9:16" } : kind === "image" ? { title: "图片生成", prompt: "", status: "draft" } : kind === "asset" ? { title: "参考素材", prompt: "", status: "draft" } : { title: "文本意图", prompt: "", status: "draft" };
  return { id: `${kind}-${Date.now()}-${index}`, kind, position: { x: 130 + (index % 3) * 310, y: 100 + Math.floor(index / 3) * 220 }, data: { projectId, entityType: kind, ...defaults } };
}

function nodeTaskStatus(task: Task | undefined) {
  if (!task) return "草稿";
  if (task.outputReady) return "已完成";
  if (["queued", "approved", "authorization"].includes(task.status)) return "排队中";
  if (task.status === "processing") return "生成中";
  if (task.status === "blocked" || task.status === "needs_you") return "需要处理";
  return task.status;
}

function workflowStatusLabel(node: CanvasNode, task: Task | undefined) {
  if (node.kind === "workflow") {
    return node.data.workflowStatus === "passed" ? "已通过" : node.data.workflowStatus === "running" ? "运行中" : node.data.workflowStatus === "blocked" ? "已阻断" : node.data.workflowStatus === "ready" ? "可运行" : "待运行";
  }
  return nodeTaskStatus(task);
}

function workflowMeta(node: CanvasNode) {
  return node.data.workflowType ? workflowNodeMeta[node.data.workflowType] : null;
}

export default function NomiCanvasPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const previewMode = projectId === "__shortdrama_preview__";
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [project, setProject] = useState<Project | null>(() => previewMode ? { id: projectId, title: "短剧转绘节点预览", type: "真人短剧" } : null);
  const [document, setDocument] = useState<CanvasDocument | null>(() => previewMode ? shortdramaWorkflowDocument(projectId) : null);
  const [revision, setRevision] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [zoom, setZoom] = useState(previewMode ? 0.42 : 1);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!previewMode);
  const [authRequired, setAuthRequired] = useState(false);

  const selectedNode = useMemo(() => document?.nodes.find((node) => node.id === selectedId) ?? document?.nodes[0] ?? null, [document, selectedId]);

  const saveDocument = useCallback((next: CanvasDocument, nextRevision = revision) => {
    setDocument(next);
    window.localStorage.setItem(`niannian-canvas:${projectId}`, JSON.stringify({ document: next, revision: nextRevision }));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/canvas`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: next, revision: nextRevision }) });
        const data = await response.json().catch(() => ({}));
        if (response.status === 409) throw new Error("画布已在其他窗口更新，请刷新后继续");
        if (!response.ok) throw new Error(data.error || "CANVAS_SAVE_FAILED");
        setRevision(data.revision);
        window.localStorage.setItem(`niannian-canvas:${projectId}`, JSON.stringify({ document: next, revision: data.revision }));
        setMessage("已保存");
      } catch (error) {
        setMessage(error instanceof Error ? `${error.message}，当前修改已保存在本机恢复缓存。` : "保存失败，当前修改已保存在本机恢复缓存。");
      } finally {
        setSaving(false);
      }
    }, 550);
  }, [projectId, revision]);

  useEffect(() => {
    let disposed = false;
    async function load() {
      if (previewMode) {
        setProject({ id: projectId, title: "短剧转绘节点预览", type: "真人短剧" });
        setDocument(shortdramaWorkflowDocument(projectId));
        setRevision(0);
        setZoom(0.42);
        setLoading(false);
        return;
      }
      try {
        const [canvasResponse, assetResponse, taskResponse] = await Promise.all([
          fetch(`/api/projects/${encodeURIComponent(projectId)}/canvas`, { cache: "no-store" }),
          fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" }),
          fetch(`/api/video-tasks?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        ]);
        if (canvasResponse.status === 401) { setAuthRequired(true); setLoading(false); window.location.assign(`/login?next=/canvas/${encodeURIComponent(projectId)}`); return; }
        const canvasData = await canvasResponse.json().catch(() => ({}));
        if (!canvasResponse.ok) throw new Error(canvasData.error || "CANVAS_UNAVAILABLE");
        const assetData = await assetResponse.json().catch(() => ({}));
        const taskData = await taskResponse.json().catch(() => ({}));
        if (disposed) return;
        setProject(canvasData.project);
        setDocument(canvasData.document);
        setRevision(Number(canvasData.revision) || 0);
        setAssets(Array.isArray(assetData.assets) ? assetData.assets : []);
        setTasks(Array.isArray(taskData.tasks) ? taskData.tasks : []);
        setZoom(Number(canvasData.document?.viewport?.zoom) || 1);
      } catch {
        setMessage("画布暂时无法读取，请刷新重试。");
      } finally {
        if (!disposed) { setLoading(false); }
      }
    }
    void load();
    return () => { disposed = true; if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [previewMode, projectId]);

  useEffect(() => {
    if (!document) return;
    const timer = window.setInterval(async () => {
       const response = await fetch(`/api/video-tasks?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const data = await response.json().catch(() => ({}));
      if (Array.isArray(data.tasks)) setTasks(data.tasks);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [document]);

  function updateNode(nodeId: string, update: (node: CanvasNode) => CanvasNode) {
    if (!document) return;
    saveDocument({ ...document, nodes: document.nodes.map((node) => node.id === nodeId ? update(node) : node) });
  }

  function addNode(kind: CanvasNodeKind) {
    if (!document) return;
    const node = makeNode(projectId, kind, document.nodes.length);
    const next = { ...document, nodes: [...document.nodes, node] };
    setSelectedId(node.id);
    saveDocument(next);
  }

  function loadShortdramaWorkflow() {
    const next = shortdramaWorkflowDocument(projectId);
    setSelectedId(next.nodes[0]?.id ?? null);
    setZoom(next.viewport.zoom);
    saveDocument(next);
    setMessage("已加载短剧转绘节点流程，当前仅展示合同与依赖，未调用 Provider。");
  }

  function updateWorkflowStatus(status: "draft" | "ready" | "running" | "blocked" | "passed") {
    if (!selectedNode || selectedNode.kind !== "workflow") return;
    updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, workflowStatus: status, status } }));
    setMessage(status === "running" ? "节点已进入本地运行态，尚未调用 Provider。" : status === "blocked" ? "节点已标记为阻断，恢复时从该节点继续。" : "节点状态已更新。");
  }

  function addAsset(asset: Asset) {
    if (!document) return;
    const node = makeNode(projectId, "asset", document.nodes.length);
    node.data = { ...node.data, title: asset.name, assetIds: [asset.id], assetName: asset.name, assetUrl: asset.previewUrl, assetMimeType: asset.mimeType, status: "ready" };
    const next = { ...document, nodes: [...document.nodes, node] };
    setSelectedId(node.id);
    saveDocument(next);
  }

  function deleteSelected() {
    if (!document || !selectedNode) return;
    const next = { ...document, nodes: document.nodes.filter((node) => node.id !== selectedNode.id), edges: document.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id) };
    setSelectedId(next.nodes[0]?.id ?? null);
    saveDocument(next);
  }

  function connectTo(targetId: string) {
    if (!document || !connectSource || connectSource === targetId) { setConnectSource(null); return; }
    if (document.edges.some((edge) => edge.source === connectSource && edge.target === targetId)) { setConnectSource(null); return; }
    const source = document.nodes.find((node) => node.id === connectSource);
    const target = document.nodes.find((node) => node.id === targetId);
    if (!source || !target) return;
    const kind: CanvasEdge["kind"] = source.kind === "asset" ? "reference" : "depends_on";
    saveDocument({ ...document, edges: [...document.edges, { id: `edge-${Date.now()}`, source: connectSource, target: targetId, kind }] });
    setConnectSource(null);
    setMessage("连接已建立");
  }

  function handleNodePointerDown(event: ReactPointerEvent, node: CanvasNode) {
    if ((event.target as HTMLElement).closest("button, input, textarea, select")) return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const scale = zoom;
    dragRef.current = { nodeId: node.id, offsetX: (event.clientX - rect.left) / scale - node.position.x, offsetY: (event.clientY - rect.top) / scale - node.position.y };
    setSelectedId(node.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleNodePointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    const board = boardRef.current;
    if (!drag || !board || !document) return;
    const rect = board.getBoundingClientRect();
    const nextPosition = { x: Math.max(16, (event.clientX - rect.left) / zoom - drag.offsetX), y: Math.max(16, (event.clientY - rect.top) / zoom - drag.offsetY) };
    setDocument({ ...document, nodes: document.nodes.map((node) => node.id === drag.nodeId ? { ...node, position: nextPosition } : node) });
  }

  function handleNodePointerUp() {
    if (!dragRef.current || !document) return;
    const cached = document;
    dragRef.current = null;
    saveDocument(cached);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 4) return;
    event.preventDefault();
    const nextZoom = Math.max(0.35, Math.min(1.45, zoom - event.deltaY * 0.001));
    setZoom(nextZoom);
    if (document) saveDocument({ ...document, viewport: { ...document.viewport, zoom: nextZoom } });
  }

  function setCanvasZoom(nextZoom: number) {
    const clamped = Math.max(0.35, Math.min(1.45, nextZoom));
    setZoom(clamped);
    if (document) saveDocument({ ...document, viewport: { ...document.viewport, zoom: clamped } });
  }

  function fitWorkflowToCanvas() {
    if (!document || !boardRef.current || !document.nodes.length) return;
    const maxX = Math.max(...document.nodes.map((node) => node.position.x + NODE_WIDTH));
    const maxY = Math.max(...document.nodes.map((node) => node.position.y + NODE_HEIGHT));
    const availableWidth = Math.max(320, boardRef.current.clientWidth - 48);
    const availableHeight = Math.max(260, boardRef.current.clientHeight - 72);
    setCanvasZoom(Math.min(1.05, Math.max(0.35, Math.min(availableWidth / maxX, availableHeight / maxY))));
  }

  async function generateSelected() {
    if (!document || !selectedNode || !["video", "image"].includes(selectedNode.kind)) return;
    if (selectedNode.kind === "image") { setMessage("图片节点已保留为画布扩展位，当前先通过视频任务生成。"); return; }
    const incoming = document.edges.filter((edge) => edge.target === selectedNode.id).map((edge) => document.nodes.find((node) => node.id === edge.source)).filter(Boolean) as CanvasNode[];
    const sourceText = incoming.filter((node) => node.kind === "text").map((node) => node.data.prompt).filter(Boolean).join("\n");
    const assetIds = [...new Set(incoming.flatMap((node) => node.data.assetIds ?? []))];
    const prompt = selectedNode.data.prompt.trim() || sourceText.trim();
    if (!prompt) { setMessage("请先填写视频节点提示词，或连接一个文本意图节点。"); return; }
    updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, status: "submitting" } }));
    setMessage("正在创建念念视频任务…");
    try {
      const response = await fetch("/api/video-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, prompt, product: "video_s", durationSeconds: selectedNode.data.durationSeconds ?? 5, aspectRatio: selectedNode.data.aspectRatio ?? "9:16", assetIds }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "VIDEO_TASK_CREATE_FAILED");
      const task = data.task as Task;
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, prompt, taskId: task.id, status: task.status } }));
      setMessage(`任务已创建：${task.id}`);
    } catch (error) {
      updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, status: "failed" } }));
      setMessage(error instanceof Error ? `任务创建失败：${error.message}` : "任务创建失败，请重试。");
    }
  }

  if (loading || (!document && !authRequired)) return <main className="canvas-page"><SiteHeader /><div className="canvas-loading">{message || "正在打开 Nomi 画布…"}</div></main>;
  if (authRequired) return <main className="canvas-page"><SiteHeader /><div className="canvas-loading"><div><b>请先登录念念 AI</b><br /><Link href={`/login?next=/canvas/${encodeURIComponent(projectId)}`} className="canvas-primary-button">前往登录</Link></div></div></main>;
  if (!document) return <main className="canvas-page"><SiteHeader /><div className="canvas-loading">画布数据暂时为空，请刷新重试。</div></main>;

  return <main className="canvas-page">
    <SiteHeader />
    <section className="nomi-shell">
          <header className="nomi-toolbar">
        <div className="nomi-toolbar-title"><Link href={`/workspace/${encodeURIComponent(projectId)}`} aria-label="返回项目工作台">←</Link><div><small>NOMI CANVAS V1</small><h1>{project?.title ?? "视频项目"}</h1></div></div>
        <div className="nomi-toolbar-actions"><span className="nomi-save-state">{saving ? "保存中…" : message || "已连接念念任务系统"}</span><button type="button" className="nomi-workflow-load" onClick={loadShortdramaWorkflow}>加载转绘流程</button><button type="button" onClick={() => addNode("text")}>+ 文本</button><button type="button" onClick={() => addNode("video")}>+ 视频</button><button type="button" onClick={deleteSelected} disabled={!selectedNode}>删除节点</button></div>
      </header>
      <div className="nomi-workbench">
        <aside className="nomi-side-panel nomi-library-panel">
          <div className="nomi-panel-heading"><span>素材库</span><Link href="/assets">管理</Link></div>
          <p className="nomi-panel-hint">点击素材，把它放到画布作为人物、商品或场景参考。</p>
          <div className="nomi-asset-list">{assets.filter((asset) => !asset.hidden).map((asset) => <button type="button" className="nomi-asset-item" key={asset.id} onClick={() => addAsset(asset)}><img src={asset.previewUrl} alt="" /><span><b>{asset.name}</b><small>{asset.role === "character" ? "人物" : asset.role === "product" ? "商品" : "场景"}</small></span></button>)}</div>
          {!assets.length ? <div className="nomi-panel-empty">素材库为空<br /><Link href="/assets">先上传素材</Link></div> : null}
        </aside>
        <div className="nomi-canvas-wrap">
          <div className="nomi-canvas-topline"><span>{document.nodes.length} 个节点 · {document.edges.length} 条连接</span><div className="nomi-canvas-zoom"><button type="button" aria-label="缩小画布" onClick={() => setCanvasZoom(zoom - 0.1)}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大画布" onClick={() => setCanvasZoom(zoom + 0.1)}>+</button><button type="button" className="nomi-fit-button" onClick={fitWorkflowToCanvas}>适合全部</button></div></div>
          <div className="nomi-canvas-board" ref={boardRef} onWheel={handleWheel} onClick={(event) => { if (event.target === event.currentTarget) { setSelectedId(null); setConnectSource(null); } }}>
            <div className="nomi-canvas-world" style={{ transform: `scale(${zoom})` }}>
              <svg className="nomi-edge-layer" width="2400" height="1500" aria-hidden="true">{document.edges.map((edge) => { const source = document.nodes.find((node) => node.id === edge.source); const target = document.nodes.find((node) => node.id === edge.target); if (!source || !target) return null; return <line key={edge.id} x1={source.position.x + NODE_WIDTH} y1={source.position.y + 76} x2={target.position.x} y2={target.position.y + 76} className={`nomi-edge nomi-edge-${edge.kind}`} />; })}</svg>
              {document.nodes.map((node) => { const task = node.data.taskId ? tasks.find((item) => item.id === node.data.taskId) : undefined; const meta = workflowMeta(node); return <article key={node.id} data-node-id={node.id} data-node-kind={node.kind} {...(node.data.workflowType ? { "data-workflow-type": node.data.workflowType } : {})} aria-label={node.data.title} className={`nomi-node nomi-node-${node.kind}${meta ? ` nomi-workflow-node nomi-workflow-${node.data.workflowType}` : ""}${selectedNode?.id === node.id ? " is-selected" : ""}${connectSource === node.id ? " is-connecting" : ""}`} style={{ left: node.position.x, top: node.position.y }} onPointerDown={(event) => handleNodePointerDown(event, node)} onPointerMove={handleNodePointerMove} onPointerUp={handleNodePointerUp} onClick={() => setSelectedId(node.id)}>
                <button className="nomi-node-input" type="button" aria-label={`连接到${node.data.title}`} onClick={(event) => { event.stopPropagation(); connectTo(node.id); }}>●</button><header><span>{meta?.stage ?? nodeNames[node.kind]}</span><small>{workflowStatusLabel(node, task)}</small></header><h2>{node.data.title}</h2>{node.kind === "asset" && node.data.assetUrl ? <img className="nomi-node-thumb" src={node.data.assetUrl} alt="" /> : null}{meta ? <><p className="nomi-workflow-skill">{meta.skillId}</p><p>{node.data.artifactSummary || meta.prompt}</p></> : node.kind !== "asset" ? <p>{node.data.prompt || nodeHints[node.kind]}</p> : <p>{node.data.assetName || nodeHints[node.kind]}</p>}{node.data.failureCode ? <span className="nomi-node-failure">{node.data.failureCode}</span> : null}<button className="nomi-node-output" type="button" aria-label={`从${node.data.title}开始连接`} onClick={(event) => { event.stopPropagation(); setConnectSource(node.id); setMessage("请选择另一个节点作为连接目标"); }}>●</button>
              </article>; })}
            </div>
          </div>
        </div>
        <aside className="nomi-side-panel nomi-inspector-panel">
          <div className="nomi-panel-heading"><span>节点属性</span><small>{selectedNode ? workflowMeta(selectedNode)?.stage ?? nodeNames[selectedNode.kind] : "未选择"}</small></div>
          {selectedNode ? <div className="nomi-inspector-form"><label>名称<input value={selectedNode.data.title} maxLength={120} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, title: event.target.value } }))} /></label>{selectedNode.kind === "workflow" ? <><div className="nomi-contract-card"><strong>{workflowMeta(selectedNode)?.skillId}</strong><span>Skill 版本：{selectedNode.data.skillVersion || "current"}</span><span>动作：{workflowMeta(selectedNode)?.action}</span><span>状态：{workflowStatusLabel(selectedNode, undefined)}</span></div><label>节点合同<textarea value={selectedNode.data.prompt} maxLength={2000} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, prompt: event.target.value } }))} /></label><label>产物摘要<input value={selectedNode.data.artifactSummary || ""} maxLength={240} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, artifactSummary: event.target.value } }))} /></label>{selectedNode.data.failureCode ? <div className="nomi-failure-box">阻断原因：{selectedNode.data.failureCode}</div> : null}<div className="nomi-workflow-actions"><button type="button" onClick={() => updateWorkflowStatus("running")}>运行节点</button><button type="button" onClick={() => updateWorkflowStatus("draft")}>从此处恢复</button><button type="button" onClick={() => updateWorkflowStatus("blocked")}>标记阻断</button></div></> : selectedNode.kind !== "asset" ? <label>提示词<textarea value={selectedNode.data.prompt} maxLength={2000} placeholder={nodeHints[selectedNode.kind]} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, prompt: event.target.value } }))} /></label> : <div className="nomi-inspector-asset">{selectedNode.data.assetUrl ? <img src={selectedNode.data.assetUrl} alt="" /> : null}<span>{selectedNode.data.assetName || "未绑定素材"}</span></div>}{selectedNode.kind === "video" ? <div className="nomi-inspector-options"><label>时长<select value={selectedNode.data.durationSeconds ?? 5} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, durationSeconds: Number(event.target.value) } }))}><option value="5">5 秒</option><option value="8">8 秒</option><option value="10">10 秒</option><option value="15">15 秒</option></select></label><label>比例<select value={selectedNode.data.aspectRatio ?? "9:16"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, data: { ...node.data, aspectRatio: event.target.value } }))}><option>9:16</option><option>16:9</option><option>1:1</option></select></label></div> : null}{selectedNode.data.taskId ? <Link className="nomi-task-link" href={`/workspace/${encodeURIComponent(projectId)}/deliveries`}>打开项目交付 ↗</Link> : null}<button className="nomi-generate-button" type="button" disabled={!['video', 'image'].includes(selectedNode.kind) || selectedNode.data.status === "submitting"} onClick={() => { void generateSelected(); }}>{selectedNode.kind === "video" ? "提交视频任务" : "图片节点"}</button></div> : <div className="nomi-panel-empty">选择一个节点查看属性。</div>}
        </aside>
      </div>
    </section>
  </main>;
}
