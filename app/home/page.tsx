"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ChevronLeftIcon, ClockIcon, CloseIcon, ExpandIcon, PlusIcon, SparkIcon, UploadIcon } from "@/components/Icons";
import { formatDateTime } from "@/lib/date-display";

const assetConfig = {
  character: { title: "人物图", accept: "image/*", referenceIntent: "identity" },
  product: { title: "关键资产图", accept: "image/*", referenceIntent: "asset_lock" },
  scene: { title: "场景图", accept: "image/*", referenceIntent: "scene" },
  reference_video: { title: "视频参考（可选）", accept: "video/*", referenceIntent: "overall_expression" },
  reference_audio: { title: "音频参考（可选）", accept: "audio/*", referenceIntent: "audio_sync" },
} as const;

type AssetRole = keyof typeof assetConfig;
type SessionUser = { email: string; isAdmin?: boolean };

type PendingAsset = {
  assetId: string | null;
  name: string;
  url: string;
  type: string;
  file: File | null;
  referenceIntent: string;
};
type LibraryAsset = { id: string; role: "character" | "product" | "scene" | "motion" | "reference_video"; name: string; mimeType: string; hidden: boolean; previewUrl: string; projectId?: string; projectTitle?: string };
type AssetProjectGroup = { id: string; title: string; assets: LibraryAsset[] };

type VideoTask = {
  id: string;
  prompt: string;
  channel: string;
  status: string;
  outputReady: boolean;
  outputUrl: string | null;
  executionNotice: string | null;
  durationSeconds: number;
  aspectRatio: string;
  creditCost: number;
  thumbnailUrl: string | null;
  createdAt: string;
  assetIds: string[];
};
type ZiyuJobState = { id: string; status: string; previewUrl: string | null; failureReason: string | null; message: string | null; prompt?: string; model?: string; modelId?: string; mode?: ZiyuMode; ratio?: string; createdAt?: string; assets?: Record<string, Array<{ url: string; type?: string }>> };

function keepFreshMediaUrl(previous: VideoTask | undefined, next: VideoTask) {
  if (!previous?.outputUrl || !next.outputUrl || previous.outputUrl === next.outputUrl) return next;
  try {
    const previousUrl = new URL(previous.outputUrl, window.location.origin);
    const nextUrl = new URL(next.outputUrl, window.location.origin);
    const expiresAt = Number(previousUrl.searchParams.get("exp"));
    const sameMedia = previousUrl.origin === nextUrl.origin && previousUrl.pathname === nextUrl.pathname;
    if (sameMedia && Number.isFinite(expiresAt) && expiresAt - Math.floor(Date.now() / 1000) > 45) {
      return { ...next, outputUrl: previous.outputUrl };
    }
  } catch {
    // Use the refreshed URL when the previous URL cannot be inspected.
  }
  return next;
}
type StudioProduct = string;
type ZiyuMode = "i2v" | "t2v" | "t2i";
type ZiyuModel = {
  id: string; name: string; modes: ZiyuMode[]; allowedDurations: number[]; allowedRatios: string[];
  allowedAssetTypes: ("image" | "video" | "audio")[]; assetLimits: Record<string, number>;
  resolution: string; promptMaxLength: number; cost: number | null; costPerSecond: number | null; durationCosts: Record<string, number>;
};

type CreditSummary = {
  balance: number;
  pricing: {
    automatic: Record<string, number>;
    recharge: { yuanPerCredit: number; packages: number[]; fulfillment: string; shopUrl: string | null; configured: boolean };
  };
  rechargeRequests: { id: string; requestedCredits: number; status: string; createdAt: string }[];
};

const emptyAssets: Record<AssetRole, PendingAsset[]> = {
  character: [],
  product: [],
  scene: [],
  reference_video: [],
  reference_audio: [],
};
const assetRoleNames = { character: "人物图", product: "关键资产图", scene: "场景图", reference_audio: "音频参考" };

function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "正在排队处理",
    approved: "等待开始",
    processing: "处理中",
    needs_you: "等待你完成平台验证",
    authorization: "等待执行授权",
    blocked: "任务受阻",
    completed: "已完成",
  };
  return labels[status] ?? status;
}

function displayResolution(value: string, fallback: string) {
  const normalized = value.trim();
  if (!normalized) return fallback;
  const match = normalized.match(/^(\d+)\s*[pP]$/);
  return match ? `${match[1]}p` : normalized;
}

export default function HomePage() {
  const router = useRouter();
  const objectUrls = useRef(new Set<string>());
  const draftHydrated = useRef(false);
  const [user, setUser] = useState<SessionUser | null>();
  const [prompt, setPrompt] = useState("");
  const [ziyuModels, setZiyuModels] = useState<ZiyuModel[]>([]);
  const [ziyuMode, setZiyuMode] = useState<ZiyuMode>("i2v");
  const [duration, setDuration] = useState("15 秒");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [product, setProduct] = useState<StudioProduct>("");
  const [assets, setAssets] = useState<Record<AssetRole, PendingAsset[]>>(emptyAssets);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [libraryProjects, setLibraryProjects] = useState<AssetProjectGroup[]>([]);
  const [activeAssetProjectId, setActiveAssetProjectId] = useState("all");
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [ziyuJob, setZiyuJob] = useState<ZiyuJobState | null>(null);
  const [ziyuHistory, setZiyuHistory] = useState<ZiyuJobState[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [credits, setCredits] = useState<CreditSummary | null>(null);
  const [formFullscreen, setFormFullscreen] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const taskStatusRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const promptImages = useMemo(() => (Object.entries(assets) as [AssetRole, PendingAsset[]][])
    .flatMap(([role, entries]) => entries.map((asset, index) => ({ role, asset, index })))
    .filter(({ asset }) => asset.type.startsWith("image/")), [assets]);
  const highlightedPrompt = useMemo(() => prompt.split(/(@图片\d+)/g).map((part, index) => /^@图片\d+$/.test(part)
    ? <mark key={`${part}-${index}`}>{part}</mark>
    : <span key={`text-${index}`}>{part}</span>), [prompt]);

  function insertPromptMention(assetIndex: number) {
    if (promptAssetsDisabled) return;
    const input = promptRef.current;
    const token = `@图片${assetIndex + 1}`;
    const start = input?.selectionStart ?? prompt.length;
    const end = input?.selectionEnd ?? start;
    setPrompt((current) => `${current.slice(0, start)}${token}${current.slice(end)}`.slice(0, 2000));
    setShowMentionPicker(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const loadTasks = useCallback(async () => {
    const response = await fetch("/api/video-tasks", { cache: "no-store" });
    if (!response.ok) throw new Error("VIDEO_TASKS_UNAVAILABLE");
    const taskData = await response.json();
    setTasks((current) => {
      const previousById = new Map(current.map((task) => [task.id, task]));
      return (taskData.tasks ?? []).map((task: VideoTask) => keepFreshMediaUrl(previousById.get(task.id), task));
    });
  }, []);

  const loadCredits = useCallback(async () => {
    const response = await fetch("/api/credits", { cache: "no-store" });
    if (!response.ok) throw new Error("CREDITS_UNAVAILABLE");
    setCredits(await response.json());
  }, []);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.user) {
          router.replace("/login?next=/home");
          return;
        }
        setUser(data.user);
        loadTasks().catch(() => undefined);
        loadCredits().catch(() => undefined);
        fetch("/api/providers", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => {
          const models = Array.isArray(payload?.ziyu?.models) ? payload.ziyu.models as ZiyuModel[] : [];
          setZiyuModels(models);
          setProduct((current) => current.startsWith("ziyu:") && models.some((model) => current === `ziyu:${model.id}`)
            ? current
            : models[0] ? `ziyu:${models[0].id}` : "");
        }).catch(() => undefined);
      fetch("/library/assets", { cache: "no-store" })
          .then(async (response) => response.ok ? response.json() : { assets: [] })
          .then((payload) => {
            const availableAssets = Array.isArray(payload.assets) ? payload.assets as LibraryAsset[] : [];
            setLibraryAssets(availableAssets);
            const selectedAssetId = window.localStorage.getItem("niannian-library-selected-asset");
            const asset = availableAssets.find((entry) => entry.id === selectedAssetId);
            if (!asset) return;
            window.localStorage.removeItem("niannian-library-selected-asset");
            setAssets((current) => ({
              ...current,
                [asset.role]: current[asset.role as AssetRole].some((entry) => entry.assetId === asset.id)
                ? current[asset.role as AssetRole]
                : [...current[asset.role as AssetRole], { assetId: asset.id, name: asset.name, url: asset.previewUrl, type: asset.mimeType, file: null, referenceIntent: assetConfig[asset.role as AssetRole].referenceIntent }],
            }));
            setMessage(`已从素材库加入：${asset.name}`);
          })
          .catch(() => undefined);
      })
      .catch(() => router.replace("/login?next=/home"));

    const storedDraft = window.localStorage.getItem("niannian-generator-draft");
    if (storedDraft) {
      try {
        const draft = JSON.parse(storedDraft);
        setPrompt(draft.prompt ?? "");
        setDuration("15 秒");
        setAspectRatio(draft.aspectRatio ?? "9:16");
        setProduct(typeof draft.product === "string" && draft.product.startsWith("ziyu:") ? draft.product : "");
      } catch {
        window.localStorage.removeItem("niannian-generator-draft");
      }
    }
    draftHydrated.current = true;
  }, [loadCredits, loadTasks, router]);

  const ziyuProductSelected = product.startsWith("ziyu:");
  const selectedZiyuModel = ziyuModels.find((model) => product === `ziyu:${model.id}`);
  const promptAssetsDisabled = ziyuProductSelected && ziyuMode === "t2v";
  const resolution = selectedZiyuModel
    ? displayResolution(selectedZiyuModel.resolution, "渠道默认")
    : "720p";
  const durationOptions = selectedZiyuModel?.allowedDurations.length ? selectedZiyuModel.allowedDurations.map((value) => `${value} 秒`) : Array.from({ length: 12 }, (_, index) => `${index + 4} 秒`);
  const ratioOptions = selectedZiyuModel?.allowedRatios.length ? selectedZiyuModel.allowedRatios : ["9:16", "16:9", "1:1"];

  useEffect(() => {
    if (!selectedZiyuModel) return;
    setZiyuMode((current) => selectedZiyuModel.modes.includes(current) ? current : selectedZiyuModel.modes[0]);
    setDuration("15 秒");
    setAspectRatio((current) => selectedZiyuModel.allowedRatios.includes(current) ? current : ratioOptions[0] ?? "");
  }, [selectedZiyuModel?.id]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("niannian-generator-draft", JSON.stringify({ prompt, duration, aspectRatio, product }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [aspectRatio, duration, product, prompt]);

  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    const minHeight = 120;
    const maxHeight = 360;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt, selectedZiyuModel?.id]);

  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => { loadTasks().catch(() => undefined); loadCredits().catch(() => undefined); }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadCredits, loadTasks, user]);

  useEffect(() => {
    if (!user || ziyuJob) return;
    fetch("/api/ziyu/jobs?limit=20", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => {
      const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      const normalized = jobs.filter((job: { id?: string }) => job.id).map((job: ZiyuJobState) => ({ id: job.id, status: job.status ?? "processing", previewUrl: job.previewUrl ?? null, failureReason: job.failureReason ?? null, message: job.message ?? null, prompt: job.prompt, model: job.model, modelId: job.modelId, mode: job.mode, ratio: job.ratio, assets: job.assets, createdAt: job.createdAt }));
      if (normalized.length) { setZiyuHistory(normalized); setZiyuJob(normalized[0]); }
    }).catch(() => undefined);
  }, [user, ziyuJob]);

  useEffect(() => {
    if (!ziyuJob?.id || ["completed", "failed", "cancelled"].includes(ziyuJob.status)) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(`/api/ziyu/jobs/${encodeURIComponent(ziyuJob.id)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      const job = payload.job;
      if (!cancelled && job?.id) {
        const nextJob = { id: job.id, status: job.status ?? "processing", previewUrl: job.previewUrl ?? null, failureReason: job.failureReason ?? null, message: job.message ?? null, prompt: job.prompt, model: job.model, modelId: job.modelId, mode: job.mode, ratio: job.ratio, assets: job.assets, createdAt: job.createdAt };
        setZiyuJob(nextJob);
        setZiyuHistory((current) => [nextJob, ...current.filter((item) => item.id !== nextJob.id)]);
        if (job.status === "completed") setMessage("视频已生成，可在预览区播放或下载。");
        if (["failed", "cancelled"].includes(job.status)) setMessage(`视频生成${job.status === "cancelled" ? "已取消" : "失败"}${job.failureReason ? `：${job.failureReason}` : ""}`);
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 4_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [ziyuJob?.id, ziyuJob?.status]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const assetCountByType = useMemo(() => ({
    image: assets.character.length + assets.product.length + assets.scene.length,
    video: assets.reference_video.length,
    audio: assets.reference_audio.length,
  }), [assets.character.length, assets.product.length, assets.scene.length, assets.reference_video.length, assets.reference_audio.length]);

  function assetType(asset: LibraryAsset | PendingAsset): "image" | "video" | "audio" {
    const mimeType = "mimeType" in asset ? asset.mimeType : asset.type;
    const role = "role" in asset ? asset.role : "";
    if (mimeType.startsWith("video/") || role === "motion" || role === "reference_video") return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "image";
  }

  const pickerAssets = useMemo(() => libraryProjects.find((group) => group.id === activeAssetProjectId)?.assets ?? libraryAssets.filter((asset) => !asset.hidden), [activeAssetProjectId, libraryAssets, libraryProjects]);
  const allowedPickerTypes = selectedZiyuModel?.allowedAssetTypes ?? (ziyuProductSelected ? [] : ["image"]);
  const pickerAssetCount = (type: "image" | "video" | "audio") => assets.character.concat(assets.product, assets.scene, assets.reference_video, assets.reference_audio).filter((asset) => assetType(asset) === type).length;
  const pickerAssetLimit = (type: "image" | "video" | "audio") => selectedZiyuModel?.assetLimits[type] ?? (type === "image" && !ziyuProductSelected ? 12 : 0);
  const canOpenAssetPicker = !promptAssetsDisabled && allowedPickerTypes.some((type) => pickerAssetCount(type) < pickerAssetLimit(type));

  function pickerRoleFor(asset: LibraryAsset, targetType: "image" | "video" | "audio") {
    if (targetType === "video") return "reference_video" as AssetRole;
    if (targetType === "audio") return "reference_audio" as AssetRole;
    return asset.role === "character" || asset.role === "product" || asset.role === "scene" ? asset.role : "scene";
  }

  async function openAssetPicker() {
    if (promptAssetsDisabled) {
      setMessage("文生视频模式不能添加素材，已有素材会保留");
      return;
    }
    setShowAssetPicker(true);
    setLibraryLoading(true);
    try {
      const [assetResponse, projectResponse] = await Promise.all([fetch("/library/assets", { cache: "no-store" }), fetch("/api/projects", { cache: "no-store" })]);
      const assetPayload = await assetResponse.json().catch(() => ({ assets: [] }));
      const projectPayload = await projectResponse.json().catch(() => ({ projects: [] }));
      if (!assetResponse.ok) throw new Error("ASSET_LIBRARY_UNAVAILABLE");
      const globalAssets = (Array.isArray(assetPayload.assets) ? assetPayload.assets : []).filter((asset: LibraryAsset) => !asset.hidden);
      const projects = Array.isArray(projectPayload.projects) ? projectPayload.projects : [];
      const projectGroups = await Promise.all(projects.map(async (project: { id: string; title: string }) => {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({ assets: [] }));
        return { id: project.id, title: project.title, assets: (Array.isArray(payload.assets) ? payload.assets : []).filter((asset: LibraryAsset) => !asset.hidden).map((asset: LibraryAsset) => ({ ...asset, projectId: project.id, projectTitle: project.title })) };
      }));
      setLibraryAssets(globalAssets);
      setLibraryProjects([{ id: "all", title: "全部素材", assets: globalAssets }, ...projectGroups]);
      setActiveAssetProjectId("all");
    } catch {
      setMessage("素材库暂时无法读取，请稍后重试");
    } finally {
      setLibraryLoading(false);
    }
  }

  function addLibraryAsset(asset: LibraryAsset, targetType: "image" | "video" | "audio" = "image") {
    if (promptAssetsDisabled) {
      setMessage("文生视频模式不能添加素材，已有素材会保留");
      return;
    }
    const type = assetType(asset);
    if (!allowedPickerTypes.includes(type)) {
      setMessage(`当前渠道不支持${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}参考素材`);
      return;
    }
    const effectiveType = targetType === "image" ? type : targetType;
    const limit = pickerAssetLimit(effectiveType);
    if (effectiveType !== type) {
      setMessage("请将素材拖到匹配的投放区域");
      return;
    }
    if (pickerAssetCount(type) >= limit) {
      setMessage(`当前渠道最多添加 ${limit} 个${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}素材`);
      return;
    }
    const role = pickerRoleFor(asset, type);
    setAssets((current) => {
      if (current[role].some((entry) => entry.assetId === asset.id)) return current;
      return {
        ...current,
        [role]: [...current[role], { assetId: asset.id, name: asset.name, url: asset.previewUrl, type: asset.mimeType, file: null, referenceIntent: assetConfig[role].referenceIntent }],
      };
    });
    setShowAssetPicker(false);
    setMessage(`已加入：${asset.name}`);
  }

  const durationSeconds = Number(duration.replace(/\D/g, ""));
  const imageProductSelected = product === "image_g";
  const currentCreditCost = ziyuProductSelected ? 0 : credits?.pricing.automatic[String(durationSeconds)] ?? 0;
  const ziyuCost = selectedZiyuModel ? duration ? selectedZiyuModel.durationCosts[String(durationSeconds)] ?? (selectedZiyuModel.costPerSecond ? selectedZiyuModel.costPerSecond * durationSeconds : selectedZiyuModel.cost) : selectedZiyuModel.cost : null;
  const customerZiyuCost = ziyuCost === null ? null : Math.ceil(ziyuCost * 1.5);
  const hasEnoughCredits = Boolean(credits && currentCreditCost > 0 && credits.balance >= currentCreditCost);
  const missingCredits = Math.max(0, currentCreditCost - (credits?.balance ?? 0));
  const validationMessage = imageProductSelected ? "全能图片 G 即将开放" : ziyuProductSelected && !selectedZiyuModel ? "正在读取可用渠道" : !prompt.trim() ? "请先填写视频描述" : !ziyuProductSelected && !credits ? "正在读取积分余额" : !ziyuProductSelected && currentCreditCost <= 0 ? "当前时长暂时不可用" : !ziyuProductSelected && !hasEnoughCredits ? `积分不足，还需要 ${missingCredits} 积分` : "";
  const canCreate = Boolean(!imageProductSelected && prompt.trim() && (ziyuProductSelected ? selectedZiyuModel : hasEnoughCredits) && !submitting);
  const selectedOutputTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId && task.outputReady && task.outputUrl) ?? null,
    [selectedTaskId, tasks],
  );

  function selectAsset(role: AssetRole, event: ChangeEvent<HTMLInputElement>) {
    if (promptAssetsDisabled) {
      setMessage("文生视频模式不能添加素材，已有素材会保留");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    const expectedType = role === "reference_video" ? file.type.startsWith("video/") : role === "reference_audio" ? file.type.startsWith("audio/") : file.type.startsWith("image/");
    if (!expectedType) {
      setMessage(role === "reference_video" ? "视频参考需要上传视频文件" : role === "reference_audio" ? "音频参考需要上传音频文件" : "人物、关键资产和场景需要上传图片文件");
      event.target.value = "";
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setMessage(`文件 ${file.name} 超过 100MB，请压缩后重试`);
      event.target.value = "";
      return;
    }

    const uploadedType = role === "reference_video" ? "video" : role === "reference_audio" ? "audio" : "image";
    if (selectedZiyuModel && !selectedZiyuModel.allowedAssetTypes.includes(uploadedType)) {
      setMessage(`当前渠道不支持${uploadedType === "video" ? "视频" : "图片"}参考素材`);
      event.target.value = "";
      return;
    }
    const typeLimit = selectedZiyuModel?.assetLimits[uploadedType] ?? (ziyuProductSelected ? 0 : 12);
    if (assetCountByType[uploadedType] >= typeLimit) {
      setMessage(`当前渠道最多添加 ${typeLimit} 个${uploadedType === "video" ? "视频" : uploadedType === "audio" ? "音频" : "图片"}素材`);
      event.target.value = "";
      return;
    }
    setAssets((current) => {
      const url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      return {
        ...current,
        [role]: [...current[role], { assetId: null, name: file.name, url, type: file.type, file, referenceIntent: assetConfig[role].referenceIntent }],
      };
    });
    setMessage("");
    event.target.value = "";
  }

  function removeAsset(role: AssetRole, index: number) {
    setAssets((current) => {
      const removed = current[role][index];
      if (removed?.url) {
        URL.revokeObjectURL(removed.url);
        objectUrls.current.delete(removed.url);
      }
      return { ...current, [role]: current[role].filter((_, entryIndex) => entryIndex !== index) };
    });
  }

  async function reuseZiyuJob(job: ZiyuJobState) {
    setPrompt(job.prompt ?? "");
    setProduct(job.modelId && ziyuModels.some((model) => model.id === job.modelId) ? `ziyu:${job.modelId}` as StudioProduct : product);
    if (job.mode) setZiyuMode(job.mode);
    setAspectRatio(job.ratio ?? "9:16");
    setDuration("15 秒");
    if (job.assets) {
      const nextAssets: Record<AssetRole, PendingAsset[]> = { character: [], product: [], scene: [], reference_video: [], reference_audio: [] };
      const images = job.assets.image ?? [];
      const audio = job.assets.audio ?? [];
      nextAssets.scene = images.map((asset, index) => ({ assetId: null, name: `复用图片${index + 1}`, url: asset.url, type: asset.type ?? "image/*", file: null, referenceIntent: assetConfig.scene.referenceIntent }));
      nextAssets.reference_audio = audio.map((asset, index) => ({ assetId: null, name: `复用音频${index + 1}`, url: asset.url, type: asset.type ?? "audio/*", file: null, referenceIntent: assetConfig.reference_audio.referenceIntent }));
      setAssets(nextAssets);
    }
    setMessage("已复用历史任务的提示词和参考素材，可直接调整后提交。");
  }

  async function reuseVideoTask(task: VideoTask) {
    setProduct(ziyuModels[0] ? `ziyu:${ziyuModels[0].id}` : "");
    setPrompt(task.prompt);
    setAspectRatio(task.aspectRatio || "9:16");
    setDuration("15 秒");
    if (task.assetIds?.length) {
      const response = await fetch("/library/assets", { cache: "no-store" });
      const payload = await response.json().catch(() => ({ assets: [] }));
      const available = Array.isArray(payload.assets) ? payload.assets as LibraryAsset[] : [];
      const nextAssets: Record<AssetRole, PendingAsset[]> = { character: [], product: [], scene: [], reference_video: [], reference_audio: [] };
      for (const asset of available.filter((entry) => task.assetIds.includes(entry.id))) {
        const role = asset.role in assetConfig ? asset.role as AssetRole : "reference_video";
        nextAssets[role].push({ assetId: asset.id, name: asset.name, url: asset.previewUrl, type: asset.mimeType, file: null, referenceIntent: assetConfig[role].referenceIntent });
      }
      setAssets(nextAssets);
      if (nextAssets.character.length + nextAssets.product.length + nextAssets.scene.length < task.assetIds.length) setMessage("提示词已复用，部分历史素材已不在素材库中。");
      else setMessage("已复用历史任务的提示词和参考素材，可直接调整后提交。");
    } else {
      setAssets(emptyAssets);
      setMessage("已复用历史任务的提示词，可直接调整后提交。");
    }
  }

  async function assetData(asset: PendingAsset) {
    if (asset.file) return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("ASSET_READ_FAILED"));
      reader.readAsDataURL(asset.file as File);
    });
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error("ASSET_READ_FAILED");
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("ASSET_READ_FAILED"));
      reader.readAsDataURL(blob);
    });
  }

  async function createZiyuTask() {
    if (!selectedZiyuModel) throw new Error("ZIYU_MODEL_UNAVAILABLE");
    const sourceAssets: Array<{ type: "image" | "video" | "audio"; name: string; data: string }> = [];
    if (ziyuMode !== "t2v") {
      for (const references of Object.values(assets)) {
        for (const asset of references) {
          const type = asset.type.startsWith("video/") ? "video" : asset.type.startsWith("audio/") ? "audio" : "image";
          if (!selectedZiyuModel.allowedAssetTypes.includes(type)) throw new Error(`当前渠道不支持${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}参考素材`);
          sourceAssets.push({ type, name: asset.name, data: await assetData(asset) });
        }
      }
    }
    for (const type of selectedZiyuModel.allowedAssetTypes) {
      const limit = selectedZiyuModel.assetLimits[type] ?? 10;
      if (sourceAssets.filter((asset) => asset.type === type).length > limit) throw new Error(`${type} 参考素材最多 ${limit} 个`);
    }
    if (ziyuMode === "i2v" && selectedZiyuModel.allowedAssetTypes.length > 0 && sourceAssets.length === 0) throw new Error("图生视频模式需要先添加参考素材");
    const uploaded: Record<"image" | "video" | "audio", Array<{ url: string }>> = { image: [], video: [], audio: [] };
    if (sourceAssets.length) {
      const uploadResponse = await fetch("/api/ziyu/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: sourceAssets }) });
      const uploadPayload = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) throw new Error(uploadPayload.error || "ZIYU_UPLOAD_FAILED");
      (uploadPayload.assets ?? []).forEach((asset: { url?: string }, index: number) => { if (asset.url && sourceAssets[index]) uploaded[sourceAssets[index].type].push({ url: asset.url }); });
    }
    const response = await fetch("/api/ziyu/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: selectedZiyuModel.id, mode: ziyuMode, prompt: prompt.trim(), ratio: aspectRatio || undefined, duration: ziyuMode === "t2i" ? undefined : "15秒", assets: uploaded }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "ZIYU_JOB_CREATE_FAILED");
    if (payload.job?.id) {
      const nextJob = { id: payload.job.id, status: payload.job.status ?? "queued", previewUrl: payload.job.previewUrl ?? null, failureReason: null, message: null, prompt: prompt.trim(), model: selectedZiyuModel.name, modelId: selectedZiyuModel.id, mode: ziyuMode, ratio: aspectRatio, assets: uploaded, createdAt: new Date().toISOString() };
      setZiyuJob(nextJob);
      setZiyuHistory((current) => [nextJob, ...current.filter((item) => item.id !== nextJob.id)]);
    }
    setMessage(`任务已创建${payload.job?.id ? `：${payload.job.id}` : ""}，正在处理中。`);
    setAssets(emptyAssets);
  }

  async function createTask() {
    if (!prompt.trim()) {
      setMessage("请先填写视频描述");
      return;
    }
    if (imageProductSelected) {
      setMessage("全能图片 G 即将开放");
      return;
    }
    if (ziyuProductSelected) {
      setSubmitting(true);
      setMessage("正在上传素材并创建任务…");
      try { await createZiyuTask(); } catch (error) { setMessage(error instanceof Error ? `创建失败：${error.message}` : "创建失败，请稍后重试"); } finally { setSubmitting(false); }
      return;
    }
    if (!credits) {
      setMessage("积分状态正在加载，请稍后重试");
      return;
    }
    if (currentCreditCost <= 0) {
      setMessage("当前规格暂时没有可用报价，请调整时长后重试");
      return;
    }
    if (credits.balance < currentCreditCost) {
      router.push("/credits");
      setMessage(`积分不足：本次需要 ${currentCreditCost} 积分，当前余额 ${credits.balance} 积分。`);
      return;
    }

    setSubmitting(true);
    setMessage("正在上传素材并创建统一任务单…");

    try {
      const assetIds: string[] = [];
      for (const [role, references] of Object.entries(assets) as [AssetRole, PendingAsset[]][]) {
        for (const [index, asset] of references.entries()) {
          if (asset.assetId) { assetIds.push(asset.assetId); continue; }
          if (!asset.file) throw new Error("ASSET_FILE_MISSING");
          const form = new FormData();
          form.set("role", role);
          form.set("file", asset.file);
          form.set("referenceIntent", asset.referenceIntent);
          form.set("isPrimary", String(index === 0));
          form.set("sortOrder", String(index));
          const response = await fetch("/library/assets", { method: "POST", body: form });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "ASSET_UPLOAD_FAILED");
          assetIds.push(data.asset.id);
        }
      }

      const response = await fetch("/api/video-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          product,
          durationSeconds: Number(duration.replace(/\D/g, "")),
          aspectRatio,
          assetIds,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "VIDEO_TASK_CREATE_FAILED");
      setTasks((current) => [data.task, ...current]);
      await loadCredits();
      setMessage("视频任务已创建，可在任务状态区域查看处理进度和结果。");
      window.setTimeout(() => taskStatusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (error) {
      setMessage(error instanceof Error ? `创建任务失败：${error.message}` : "创建任务失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return <main className="generator-page generator-loading">正在进入念念AI视频工作台…</main>;
  }

  return (
    <main className="generator-page">
      <SiteHeader />

      <section className="generator-shell">
        <div className={`generator-grid generator-three-column${formFullscreen ? " is-form-fullscreen" : ""}`}>
          <section className="generator-card generator-form-card">
            <header>
              <div className="generator-workbench-brand" aria-label="念念 AI 视频生成">
                <small>NIANNIAN AI STUDIO</small>
                <h2>AI 视频生成</h2>
              </div>
              <div className="generator-card-actions">
                <button type="button" className="credit-balance generator-header-credit" onClick={() => router.push("/credits")}>
                  积分 {credits ? credits.balance : "..."}
                </button>
                <button
                  className="generator-icon-button generator-fullscreen-button"
                  type="button"
                  aria-label={formFullscreen ? "恢复三栏工作台" : "全屏制作区"}
                  title={formFullscreen ? "恢复三栏工作台" : "全屏制作区"}
                  onClick={() => setFormFullscreen((current) => !current)}
                >
                  <ExpandIcon />
                </button>
              </div>
            </header>
            <div className="generator-card-body">
              <div className="generator-field generator-prompt">
                <div className="generator-prompt-heading">
                  <label htmlFor="video-prompt">视频描述 <em>*</em></label>
                  <small>{prompt.length} / {selectedZiyuModel?.promptMaxLength || 2000}</small>
                </div>
                <div className="generator-prompt-editor">
                  <div className="generator-prompt-highlight" aria-hidden="true">{highlightedPrompt}</div>
                  <textarea
                    ref={promptRef}
                    id="video-prompt"
                    maxLength={selectedZiyuModel?.promptMaxLength || 2000}
                    value={prompt}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      setShowMentionPicker(!promptAssetsDisabled && event.target.value.slice(0, event.target.selectionStart).endsWith("@") && promptImages.length > 0);
                    }}
                    onKeyDown={(event) => { if (event.key === "Escape") setShowMentionPicker(false); }}
                    placeholder="描述主体、服装或商品、场景、镜头运动和动作节奏。"
                  />
                  {showMentionPicker ? <div className="generator-mention-picker" role="listbox" aria-label="选择引用素材">
                    {promptImages.map(({ asset }, index) => <button key={asset.assetId ?? asset.url} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => insertPromptMention(index)}><img src={asset.url} alt="" /><span>@图片{index + 1}</span><b>{asset.name}</b></button>)}
                  </div> : null}
                </div>
                <div className={`generator-prompt-assets${promptAssetsDisabled ? " is-disabled" : ""}`} aria-disabled={promptAssetsDisabled}>
                  <button className="generator-prompt-library-button" type="button" disabled={!canOpenAssetPicker} aria-label="从素材库添加素材" title={promptAssetsDisabled ? "文生视频模式不能添加素材" : !allowedPickerTypes.length ? "当前渠道无需素材" : !canOpenAssetPicker ? "当前渠道的素材已达到上限" : "从素材库添加素材"} onClick={() => { void openAssetPicker(); }}>
                    <PlusIcon />
                  </button>
                  {promptImages.map(({ role, asset, index }) => (
                    <span className="generator-prompt-asset" key={asset.assetId ?? asset.url} title={`插入 @图片${index + 1}：${asset.name}`} onClick={() => insertPromptMention(index)}>
                      <img src={asset.url} alt={asset.name} />
                      <button
                        type="button"
                        aria-label={`移除素材：${asset.name}`}
                        title="移除素材"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeAsset(role, index);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="generator-create-controls">
                <div className="generator-options" aria-label="产品">
                  <label><span>产品</span><select value={product} onChange={(event) => setProduct(event.target.value as StudioProduct)}>
                    {!product ? <option value="">正在读取可用渠道</option> : null}
                    {ziyuModels.length ? <optgroup label="智能渠道">{ziyuModels.map((model) => <option key={model.id} value={`ziyu:${model.id}`}>{model.name}</option>)}</optgroup> : null}
                  </select></label>
                  {ziyuProductSelected && selectedZiyuModel ? <div className="generator-channel-contract" aria-label="渠道规格">
                    <span>模式：{selectedZiyuModel.modes.map((item) => item === "i2v" ? "图生视频" : item === "t2v" ? "文生视频" : "文生图").join("、")}</span>
                    <span>费用：{customerZiyuCost ?? "--"} 积分 / 次</span>
                    <span>参考：{selectedZiyuModel.allowedAssetTypes.length ? selectedZiyuModel.allowedAssetTypes.map((type) => `${type === "image" ? "图片" : type === "video" ? "视频" : "音频"} ${assetCountByType[type]}/${selectedZiyuModel.assetLimits[type] ?? "-"}个`).join("、") : "无需素材"}</span>
                  </div> : null}
                </div>
                <div className="generator-options">
                  {ziyuProductSelected && selectedZiyuModel ? <label><span>模式</span><select value={ziyuMode} onChange={(event) => setZiyuMode(event.target.value as ZiyuMode)}>{selectedZiyuModel.modes.map((item) => <option key={item} value={item}>{item === "i2v" ? "图生视频" : item === "t2v" ? "文生视频" : "文生图"}</option>)}</select></label> : <div className="generator-fixed-option"><span>模式</span><b>标准</b></div>}
                  <div className="generator-fixed-option"><span>分辨率</span><b>{resolution}</b></div>
                  <label>
                    <span>时长</span>
                    <select value={duration} disabled onChange={() => undefined}>
                      {durationOptions.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>比例</span>
                    <select value={aspectRatio} disabled={imageProductSelected} onChange={(event) => setAspectRatio(event.target.value)}>
                      {ratioOptions.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
                <div className="generator-production-policy" aria-label="任务计费">
                  <b>{imageProductSelected ? "即将开放" : ziyuProductSelected ? `${customerZiyuCost ?? "--"} 积分` : `${credits?.pricing.automatic[String(durationSeconds)] ?? "--"} 积分`}</b>
                </div>
                {message ? <div className="generator-message" role="status">{message}</div> : null}
                <div className="generator-submit">
                  {validationMessage ? <span><b>{validationMessage}</b></span> : null}
                  {!hasEnoughCredits && credits && currentCreditCost > 0 ? <button type="button" onClick={() => router.push("/credits")}>积分不足，前往充值</button> : <button type="button" disabled={!canCreate} onClick={createTask}>{submitting ? "正在上传并创建…" : <><SparkIcon />创建视频任务</>}</button>}
                </div>
              </div>

            </div>
          </section>

          <section className="generator-card generator-preview-card">
            <header>
              <div><h2>预览</h2></div>
              {selectedOutputTask ? <button type="button" onClick={() => setSelectedTaskId(null)}>素材预览</button> : null}
            </header>
            <div className="generator-preview">
              {selectedOutputTask ? (
                <video key={selectedOutputTask.id} className="generator-result-preview" autoPlay muted controls playsInline preload="auto" src={selectedOutputTask.outputUrl ?? undefined} />
              ) : ziyuJob?.previewUrl ? (
                <div className="generator-ziyu-result"><video key={ziyuJob.id} className="generator-result-preview" autoPlay muted controls playsInline preload="auto" src={`/api/ziyu/media?jobId=${encodeURIComponent(ziyuJob.id)}`} /><a href={`/api/ziyu/media?jobId=${encodeURIComponent(ziyuJob.id)}`} download>下载视频</a></div>
              ) : assets.character[0] || assets.scene[0] ? (
                <div className="preview-composition">
                  {assets.scene[0] ? <img className="preview-scene" src={assets.scene[0].url} alt="场景预览" /> : null}
                  {assets.character[0] ? <img className="preview-character" src={assets.character[0].url} alt="人物预览" /> : null}
                  <div className="preview-mask">
                    <span>素材预览</span>
                  </div>
                </div>
              ) : (
                <div className="generator-empty">
                  <UploadIcon />
                  <b>暂无预览</b>
                </div>
              )}
            </div>
            <footer>
              <span>{ziyuProductSelected ? (ziyuMode === "i2v" ? "图生视频" : ziyuMode === "t2v" ? "文生视频" : "文生图") : "标准模式"}</span>
              <span>{resolution}</span>
              <span>{duration}</span>
            </footer>
            {ziyuJob && !ziyuJob.previewUrl ? <div className="generator-preview-status">紫域任务：{ziyuJob.status === "queued" ? "排队中" : ziyuJob.status === "processing" ? "生成中" : ziyuJob.status === "failed" ? "失败" : ziyuJob.status}</div> : null}
          </section>

          <section className="generator-card generator-history-card" ref={taskStatusRef}>
            <header>
              <div><h2>历史记录</h2></div>
              <a href="/projects">查看全部</a>
            </header>
            {ziyuHistory.length || tasks.length ? (
              <div className="generator-task-list">
                {ziyuHistory.map((job) => <button type="button" key={`ziyu-${job.id}`} className={`generator-task-record ziyu-history-record${job.previewUrl ? " is-previewable" : ""}`} aria-label="复用智能渠道任务" title="复用此任务" onClick={() => { void reuseZiyuJob(job); }}>
                  <span className="generator-task-content"><span className="generator-task-head"><b>智能渠道任务</b><em>{job.status === "completed" ? "已完成" : job.status === "failed" ? "失败" : "处理中"}</em></span><span className="generator-task-prompt">{job.prompt || job.id}</span><small>{job.model || "智能渠道"} · {job.id}</small></span>
                </button>)}
                {tasks.map((task) => {
                  const canPreviewTask = Boolean(task.outputReady && task.outputUrl);
                  const isSelected = task.id === selectedOutputTask?.id;
                  return <button
                    type="button"
                    key={task.id}
                    className={`generator-task-record${canPreviewTask ? " is-previewable" : ""}${isSelected ? " is-selected" : ""}`}
                    aria-label="复用历史任务"
                    title="复用此任务"
                    onClick={() => { void reuseVideoTask(task); }}
                  >
                    {task.thumbnailUrl ? <img className="generator-task-thumbnail" src={task.thumbnailUrl} alt="任务素材" /> : null}
                    <span className="generator-task-content">
                      <span className="generator-task-head"><b>制作任务</b><em>{taskStatusLabel(task.status)}</em></span>
                      <span className="generator-task-prompt">{task.prompt}</span>
                      <small>{formatDateTime(task.createdAt)} · {task.durationSeconds} 秒 · {task.creditCost} 积分</small>
                    </span>
                  </button>
                })}
              </div>
            ) : (
              <div className="generator-history-empty">
                <ClockIcon />
                <b>还没有生成任务</b>
              </div>
            )}
          </section>
          {formFullscreen ? (
            <button className="generator-restore-rail" type="button" aria-label="恢复三栏工作台" title="恢复三栏工作台" onClick={() => setFormFullscreen(false)}>
              <ChevronLeftIcon />
            </button>
          ) : null}
        </div>
      </section>

      {showAssetPicker ? <div className="asset-picker-backdrop" role="presentation" onMouseDown={() => setShowAssetPicker(false)}>
        <section className="asset-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><h2 id="asset-picker-title">素材库</h2><span className="asset-picker-subtitle">按项目整理素材，拖到下方对应投放区</span></div><button type="button" aria-label="关闭素材库" onClick={() => setShowAssetPicker(false)}><CloseIcon /></button></header>
          {libraryLoading ? <div className="asset-picker-empty">正在读取素材库…</div> : <div className="asset-picker-layout">
            <nav className="asset-project-list" aria-label="项目分组">
              {libraryProjects.map((group) => <button type="button" key={group.id} className={activeAssetProjectId === group.id ? "active" : ""} onClick={() => setActiveAssetProjectId(group.id)}><span>{group.title}</span><b>{group.assets.length}</b></button>)}
              {!libraryProjects.length ? <span className="asset-project-empty">暂无项目分组</span> : null}
            </nav>
            <div className="asset-picker-content">
              <div className="asset-drop-zones" aria-label="渠道素材投放区">
                {(allowedPickerTypes.length ? allowedPickerTypes : ["image"]).map((type) => {
                  const typed = type as "image" | "video" | "audio";
                  const limit = pickerAssetLimit(typed);
                  const count = pickerAssetCount(typed);
                  const label = typed === "image" ? "图片参考" : typed === "video" ? "视频参考" : "音频参考";
                  const uploadRole = typed === "video" ? "reference_video" : typed === "audio" ? "reference_audio" : "scene";
                  return <div className={`asset-drop-zone${count >= limit ? " is-full" : ""}`} key={typed} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const asset = pickerAssets.find((entry) => entry.id === event.dataTransfer.getData("text/plain")); if (asset) addLibraryAsset(asset, typed); }}><span>{label}</span><b>{count} / {limit}</b><small>{count >= limit ? "已达到渠道上限" : `将${label}拖到这里`}</small><label className="asset-drop-zone-upload">添加{typed === "video" ? "视频" : typed === "audio" ? "音频" : "图片"}<input type="file" accept={typed === "video" ? "video/*" : typed === "audio" ? "audio/*" : "image/*"} disabled={count >= limit} onChange={(event) => selectAsset(uploadRole, event)} /></label></div>;
                })}
              </div>
              {pickerAssets.length ? <div className="asset-picker-grid">
                {pickerAssets.map((asset) => {
                  const type = assetType(asset);
                  const role = pickerRoleFor(asset, type);
                  const selected = role ? assets[role].some((entry) => entry.assetId === asset.id) : false;
                  return <button className={`asset-picker-item${selected ? " is-selected" : ""}${promptAssetsDisabled || !allowedPickerTypes.includes(type) ? " is-disabled" : ""}`} disabled={promptAssetsDisabled || !allowedPickerTypes.includes(type)} draggable type="button" key={asset.id} onDragStart={(event) => event.dataTransfer.setData("text/plain", asset.id)} onClick={() => addLibraryAsset(asset, type)}>
                    <img src={asset.previewUrl} alt="" />
                    <span>{type === "image" ? assetRoleNames[asset.role as keyof typeof assetRoleNames] ?? "图片素材" : type === "video" ? "视频素材" : "音频素材"}</span>
                    <b title={asset.name}>{asset.name}</b>
                    {asset.projectTitle ? <small>{asset.projectTitle}</small> : null}
                  </button>;
                })}
              </div> : <div className="asset-picker-empty">当前分组还没有可用素材</div>}
            </div>
          </div>}
        </section>
      </div> : null}

    </main>
  );
}
