export type CanvasNodeKind = "text" | "asset" | "image" | "video" | "workflow";
export type CanvasEdgeKind = "depends_on" | "reference" | "derived_from";

export type WorkflowNodeType =
  | "source_video"
  | "step01_evidence"
  | "step02_fact_graph"
  | "step04a_identity_binding"
  | "step04b_asset_plan"
  | "step04c_prompt_compile"
  | "step04d_semantic_qa"
  | "step04d_word_delivery"
  | "step05_asset_execution"
  | "step05_visual_qa"
  | "step05_word_delivery"
  | "video_reference_pack"
  | "video_generation"
  | "video_qa";

export type WorkflowNodeStatus = "draft" | "ready" | "running" | "blocked" | "passed";

export type WorkflowArtifactRef = {
  id: string;
  kind: "source" | "evidence" | "facts" | "asset_plan" | "prompt" | "qa" | "word" | "video";
  label: string;
  sha256?: string;
};

export type CanvasPoint = { x: number; y: number };

export type CanvasNode = {
  id: string;
  kind: CanvasNodeKind;
  position: CanvasPoint;
  data: {
    projectId: string;
    title: string;
    prompt: string;
    entityType: CanvasNodeKind;
    entityId?: string;
    taskId?: string;
    assetIds?: string[];
    assetName?: string;
    assetUrl?: string;
    assetMimeType?: string;
    status?: string;
    durationSeconds?: number;
    aspectRatio?: string;
    workflowType?: WorkflowNodeType;
    skillId?: string;
    skillVersion?: string;
    workflowStatus?: WorkflowNodeStatus;
    failureCode?: string;
    inputArtifactRefs?: WorkflowArtifactRef[];
    outputArtifactRefs?: WorkflowArtifactRef[];
    referenceSlots?: string[];
    artifactSummary?: string;
  };
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  kind: CanvasEdgeKind;
};

export type CanvasDocument = {
  version: 2;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
};

export const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  "source_video",
  "step01_evidence",
  "step02_fact_graph",
  "step04a_identity_binding",
  "step04b_asset_plan",
  "step04c_prompt_compile",
  "step04d_semantic_qa",
  "step04d_word_delivery",
  "step05_asset_execution",
  "step05_visual_qa",
  "step05_word_delivery",
  "video_reference_pack",
  "video_generation",
  "video_qa",
];

export const isWorkflowNodeType = (value: unknown): value is WorkflowNodeType => WORKFLOW_NODE_TYPES.includes(value as WorkflowNodeType);

export const workflowNodeMeta: Record<WorkflowNodeType, {
  title: string;
  stage: string;
  skillId: string;
  skillVersion: string;
  action: "inspect" | "compile" | "qa" | "deliver" | "execute";
  prompt: string;
}> = {
  source_video: { title: "原片输入", stage: "输入", skillId: "mx-shortdrama-00-router", skillVersion: "current", action: "inspect", prompt: "接收用户上传的原片；只登记源文件路径、画幅、时长和 SHA-256，不推断下游资产资格。" },
  step01_evidence: { title: "Step01 证据提取", stage: "Step01", skillId: "mx-shortdrama-01-frame-extract", skillVersion: "current", action: "inspect", prompt: "从连续视频提取视觉、音频、OCR 和关键帧证据，输出可追溯的证据清单。" },
  step02_fact_graph: { title: "Step02 事实图", stage: "Step02", skillId: "mx-shortdrama-02-source-timeline", skillVersion: "current", action: "compile", prompt: "消费 Step01 证据，建立镜头、人物、动作、对白、场景和资产需求的结构化事实图。" },
  step04a_identity_binding: { title: "Step04A 身份绑定", stage: "Step04", skillId: "mx-shortdrama-00-router", skillVersion: "current", action: "compile", prompt: "把已闭合的角色事实绑定到中文 @参考名；未闭合身份不得创建最终人物资产。" },
  step04b_asset_plan: { title: "Step04B 资产计划", stage: "Step04", skillId: "mx-shortdrama-04-character-assets", skillVersion: "current", action: "compile", prompt: "消费 asset_requirements，生成角色、场景、道具的最终资产需求与参考槽位。" },
  step04c_prompt_compile: { title: "Step04C 提示词编译", stage: "Step04", skillId: "mx-shortdrama-00-router", skillVersion: "current", action: "compile", prompt: "把事实、动作、台词、镜头和参考图调用编译成短而可执行的提示词，不重复已由图片锁定的信息。" },
  step04d_semantic_qa: { title: "Step04D 语义 QA", stage: "Step04", skillId: "mx-shortdrama-production-harness", skillVersion: "current", action: "qa", prompt: "检查角色 @引用、说话人、台词位置、镜头时长、参考槽位、泛称和重复剧情；失败关闭。" },
  step04d_word_delivery: { title: "Step04 Word 交付", stage: "Step04", skillId: "mx-shortdrama-00-router", skillVersion: "current", action: "deliver", prompt: "仅交付用户需要的 B 层资产图提示词表和完整生视频提示词；Word 不作为下游上传源。" },
  step05_asset_execution: { title: "Step05 资产执行", stage: "Step05", skillId: "mx-shortdrama-04-character-assets", skillVersion: "current", action: "execute", prompt: "按资产类型调用图片渠道；人物角色卡必须回溯到唯一身份母图并完成提交、下载、SHA 和 QA。" },
  step05_visual_qa: { title: "Step05 视觉 QA", stage: "Step05", skillId: "mx-shortdrama-production-harness", skillVersion: "current", action: "qa", prompt: "验证文件、画幅、分辨率、角色同脸、服装、标签、无原片演员和来源链；最多一次定向重做。" },
  step05_word_delivery: { title: "Step05 Word 交付", stage: "Step05", skillId: "mx-shortdrama-04-character-assets", skillVersion: "current", action: "deliver", prompt: "把通过 QA 的最终资产图放入第五步 Word 对应位置；不展示母图或淘汰版本。" },
  video_reference_pack: { title: "视频参考组合", stage: "视频", skillId: "minimaxh3skill", skillVersion: "current", action: "compile", prompt: "只组合已验收最终资产原图和当前生产组提示词，最多九张参考图，不从 Word 反抽图。" },
  video_generation: { title: "生视频执行", stage: "视频", skillId: "minimaxh3skill", skillVersion: "current", action: "execute", prompt: "按实际参考图数量选择已登记 H3 通道；真实提交前先通过 Step04 语义合同校验。" },
  video_qa: { title: "视频 QA", stage: "视频", skillId: "mx-shortdrama-production-harness", skillVersion: "current", action: "qa", prompt: "核对人物身份、动作因果、画幅、时长、台词、参考消费和输出文件；不通过不得交付。" },
};

const workflowNode = (projectId: string, type: WorkflowNodeType, position: CanvasPoint, artifactSummary: string): CanvasNode => {
  const meta = workflowNodeMeta[type];
  return {
    id: `redraw-${type}`,
    kind: "workflow",
    position,
    data: {
      projectId,
      title: meta.title,
      prompt: meta.prompt,
      entityType: "workflow",
      workflowType: type,
      skillId: meta.skillId,
      skillVersion: meta.skillVersion,
      workflowStatus: type === "source_video" ? "ready" : "draft",
      status: type === "source_video" ? "ready" : "draft",
      artifactSummary,
      inputArtifactRefs: [],
      outputArtifactRefs: [],
    },
  };
};

export function shortdramaWorkflowDocument(projectId: string): CanvasDocument {
  const nodes: CanvasNode[] = [
    workflowNode(projectId, "source_video", { x: 60, y: 180 }, "原片路径 · 画幅 · 时长 · SHA-256"),
    workflowNode(projectId, "step01_evidence", { x: 360, y: 180 }, "视觉 · 音频 · OCR · 关键帧证据"),
    workflowNode(projectId, "step02_fact_graph", { x: 660, y: 180 }, "镜头事实 · 角色 · 台词 · 资产需求"),
    workflowNode(projectId, "step04a_identity_binding", { x: 960, y: 40 }, "中文 @角色名 · 身份闭合"),
    workflowNode(projectId, "step04b_asset_plan", { x: 960, y: 320 }, "角色卡 · 场景卡 · 道具卡 · 槽位"),
    workflowNode(projectId, "step04c_prompt_compile", { x: 1260, y: 40 }, "动作 · 镜头 · 台词 · 参考调用"),
    workflowNode(projectId, "step04d_semantic_qa", { x: 1560, y: 40 }, "泛称 · 重复 · 台词 · 时长 · 参考"),
    workflowNode(projectId, "step04d_word_delivery", { x: 1860, y: 40 }, "B 层资产提示词 + 生视频提示词"),
    workflowNode(projectId, "step05_asset_execution", { x: 1260, y: 320 }, "图片渠道执行 · 提交 · 下载 · SHA"),
    workflowNode(projectId, "step05_visual_qa", { x: 1560, y: 320 }, "画幅 · 2K · 同脸 · 无原片演员"),
    workflowNode(projectId, "step05_word_delivery", { x: 1860, y: 320 }, "最终资产图 + 第五步 Word"),
    workflowNode(projectId, "video_reference_pack", { x: 1260, y: 600 }, "最终资产原图 · 最多九张"),
    workflowNode(projectId, "video_generation", { x: 1560, y: 600 }, "H3 ultra · 9:16 · 5-15 秒"),
    workflowNode(projectId, "video_qa", { x: 1860, y: 600 }, "成片身份 · 动作 · 台词 · 文件"),
  ];
  const edgePairs: Array<[string, string, CanvasEdgeKind]> = [
    ["source_video", "step01_evidence", "depends_on"],
    ["step01_evidence", "step02_fact_graph", "depends_on"],
    ["step02_fact_graph", "step04a_identity_binding", "depends_on"],
    ["step02_fact_graph", "step04b_asset_plan", "depends_on"],
    ["step04a_identity_binding", "step04c_prompt_compile", "depends_on"],
    ["step04b_asset_plan", "step04c_prompt_compile", "reference"],
    ["step04c_prompt_compile", "step04d_semantic_qa", "depends_on"],
    ["step04d_semantic_qa", "step04d_word_delivery", "depends_on"],
    ["step04b_asset_plan", "step05_asset_execution", "depends_on"],
    ["step05_asset_execution", "step05_visual_qa", "depends_on"],
    ["step05_visual_qa", "step05_word_delivery", "depends_on"],
    ["step04d_semantic_qa", "video_reference_pack", "depends_on"],
    ["step05_visual_qa", "video_reference_pack", "reference"],
    ["video_reference_pack", "video_generation", "depends_on"],
    ["video_generation", "video_qa", "depends_on"],
  ];
  const edges: CanvasEdge[] = edgePairs.map(([sourceType, targetType, kind]) => ({
    id: `edge-redraw-${sourceType}-${targetType}`,
    source: `redraw-${sourceType}`,
    target: `redraw-${targetType}`,
    kind,
  }));
  return { version: 2, nodes, edges, viewport: { x: 0, y: 0, zoom: 0.42 } };
}

export const emptyCanvasDocument = (projectId: string): CanvasDocument => shortdramaWorkflowDocument(projectId);

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeCanvasDocument(value: unknown, projectId: string): CanvasDocument {
  const source = value && typeof value === "object" ? value as Partial<CanvasDocument> : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const nodes: CanvasNode[] = rawNodes.slice(0, 200).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const node = raw as Partial<CanvasNode>;
    const rawKind = String(node.kind ?? "");
    if (!node.id || !["text", "asset", "image", "video", "workflow"].includes(rawKind)) return [];
    const kind = rawKind as CanvasNodeKind;
    const rawData = node.data && typeof node.data === "object" ? node.data as Partial<CanvasNode["data"]> : {};
    const data: CanvasNode["data"] = {
      projectId,
      title: String(rawData.title ?? "未命名节点").slice(0, 120),
      prompt: String(rawData.prompt ?? "").slice(0, 2000),
      entityType: kind,
      ...(rawData.entityId ? { entityId: String(rawData.entityId).slice(0, 160) } : {}),
      ...(rawData.taskId ? { taskId: String(rawData.taskId).slice(0, 160) } : {}),
      ...(Array.isArray(rawData.assetIds) ? { assetIds: rawData.assetIds.map(String).slice(0, 12) } : {}),
      ...(rawData.assetName ? { assetName: String(rawData.assetName).slice(0, 180) } : {}),
      ...(rawData.assetUrl ? { assetUrl: String(rawData.assetUrl).slice(0, 500) } : {}),
      ...(rawData.assetMimeType ? { assetMimeType: String(rawData.assetMimeType).slice(0, 120) } : {}),
      ...(rawData.status ? { status: String(rawData.status).slice(0, 80) } : {}),
      ...(rawData.durationSeconds ? { durationSeconds: Math.max(4, Math.min(15, Math.round(Number(rawData.durationSeconds)))) } : {}),
      ...(rawData.aspectRatio ? { aspectRatio: String(rawData.aspectRatio).slice(0, 10) } : {}),
      ...(isWorkflowNodeType(rawData.workflowType) ? { workflowType: rawData.workflowType } : {}),
      ...(rawData.skillId ? { skillId: String(rawData.skillId).slice(0, 160) } : {}),
      ...(rawData.skillVersion ? { skillVersion: String(rawData.skillVersion).slice(0, 80) } : {}),
      ...(rawData.workflowStatus && ["draft", "ready", "running", "blocked", "passed"].includes(String(rawData.workflowStatus)) ? { workflowStatus: rawData.workflowStatus } : {}),
      ...(rawData.failureCode ? { failureCode: String(rawData.failureCode).slice(0, 120) } : {}),
      ...(Array.isArray(rawData.inputArtifactRefs) ? { inputArtifactRefs: rawData.inputArtifactRefs.slice(0, 32).flatMap((item) => item && typeof item === "object" && item.id && item.kind && item.label ? [{ id: String(item.id).slice(0, 160), kind: String(item.kind) as WorkflowArtifactRef["kind"], label: String(item.label).slice(0, 160), ...(item.sha256 ? { sha256: String(item.sha256).slice(0, 128) } : {}) }] : []) } : {}),
      ...(Array.isArray(rawData.outputArtifactRefs) ? { outputArtifactRefs: rawData.outputArtifactRefs.slice(0, 32).flatMap((item) => item && typeof item === "object" && item.id && item.kind && item.label ? [{ id: String(item.id).slice(0, 160), kind: String(item.kind) as WorkflowArtifactRef["kind"], label: String(item.label).slice(0, 160), ...(item.sha256 ? { sha256: String(item.sha256).slice(0, 128) } : {}) }] : []) } : {}),
      ...(Array.isArray(rawData.referenceSlots) ? { referenceSlots: rawData.referenceSlots.map(String).slice(0, 9) } : {}),
      ...(rawData.artifactSummary ? { artifactSummary: String(rawData.artifactSummary).slice(0, 240) } : {}),
    };
    const position = node.position && typeof node.position === "object" ? node.position as Partial<CanvasPoint> : {};
    return [{
      id: String(node.id).slice(0, 160),
      kind: kind as CanvasNodeKind,
      position: { x: finiteNumber(position.x, 80), y: finiteNumber(position.y, 80) },
      data,
    }];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = rawEdges.slice(0, 400).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const edge = raw as Partial<CanvasEdge>;
    if (!edge.id || !edge.source || !edge.target || !nodeIds.has(String(edge.source)) || !nodeIds.has(String(edge.target))) return [];
    const kind = ["depends_on", "reference", "derived_from"].includes(String(edge.kind)) ? edge.kind as CanvasEdgeKind : "depends_on";
    return [{ id: String(edge.id).slice(0, 160), source: String(edge.source), target: String(edge.target), kind }];
  });
  const viewport = source.viewport && typeof source.viewport === "object" ? source.viewport : {};
  return {
    version: 2,
    nodes,
    edges,
    viewport: {
      x: finiteNumber((viewport as { x?: unknown }).x, 0),
      y: finiteNumber((viewport as { y?: unknown }).y, 0),
      zoom: Math.max(0.35, Math.min(1.6, finiteNumber((viewport as { zoom?: unknown }).zoom, 1))),
    },
  };
}
