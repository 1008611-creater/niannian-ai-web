import type { ArtifactLedgerEntry, SubmissionGate, TeamMember, WorkflowNode } from "./shortdrama-contract";

export const demoMembers: TeamMember[] = [
  { id: "m1", name: "林念", role: "owner", title: "团队所有者", avatar: "念", status: "online" },
  { id: "m2", name: "周导", role: "director", title: "连续性总监 · Step04 Owner", avatar: "周", status: "online" },
  { id: "m3", name: "小桥", role: "editor", title: "资产与视频执行", avatar: "桥", status: "online" },
  { id: "m4", name: "陈审", role: "reviewer", title: "质量审核", avatar: "审", status: "away" },
];

export const workflowNodes: WorkflowNode[] = [
  { id: "step01", shortLabel: "01", label: "证据提取", status: "verified", ownerId: "m3", summary: "帧、音频、OCR、ASR 已登记为诊断证据", artifactCount: 38 },
  { id: "step02", shortLabel: "02", label: "干净时间轴", status: "verified", ownerId: "m2", summary: "原片镜头边界与对白时间轴已审核", artifactCount: 12 },
  { id: "step04", shortLabel: "04", label: "本土化与提示词", status: "in_progress", ownerId: "m2", summary: "角色连续性合同由周导统一维护", artifactCount: 9 },
  { id: "step05", shortLabel: "05", label: "资产图执行", status: "review", ownerId: "m3", summary: "候选角色、场景与首帧等待确认", artifactCount: 16 },
  { id: "reference", shortLabel: "✓", label: "参考图确认", status: "blocked", ownerId: "m4", summary: "首帧、上传参考与辅助资产需分类确认", artifactCount: 0 },
  { id: "seedance", shortLabel: "S2", label: "Seedance 2", status: "blocked", ownerId: "m3", summary: "video_task_spec 与授权门禁未通过", artifactCount: 0 },
  { id: "qa", shortLabel: "QA", label: "质检与交付", status: "blocked", ownerId: "m4", summary: "真实输出下载、探针、回读与登记后开放", artifactCount: 0 },
];

export const artifactLedger: ArtifactLedgerEntry[] = [
  { id: "timeline-v3", label: "EP01 干净原片时间轴", authority: "authoritative", version: 3, ownerId: "m2", verifiedBy: "m4" },
  { id: "continuity-v5", label: "角色连续性合同", authority: "authoritative", version: 5, ownerId: "m2", verifiedBy: "m4" },
  { id: "shot-s01-prompt-v4", label: "S01 视频提示词", authority: "candidate", version: 4, ownerId: "m2" },
  { id: "s01-firstframe-v2", label: "S01 候选首帧", authority: "candidate", version: 2, ownerId: "m3" },
];

export const submissionGates: SubmissionGate[] = [
  { id: "spec", label: "video_task_spec.json", passed: true, detail: "结构已生成，等待引用最终资产" },
  { id: "references", label: "参考资产已确认", passed: false, detail: "首帧仍为 candidate" },
  { id: "quota", label: "费用与配额回读", passed: false, detail: "Seedance 2 接口未配置" },
  { id: "auth", label: "用户提交授权", passed: false, detail: "尚未授权真实费用操作" },
];
