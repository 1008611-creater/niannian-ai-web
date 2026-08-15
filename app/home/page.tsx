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
type LibraryAsset = { id: string; role: "character" | "product" | "scene"; name: string; mimeType: string; hidden: boolean; previewUrl: string };

type VideoTask = {
  id: string;
  prompt: string;
  channel: string;
  status: string;
  outputReady: boolean;
  outputUrl: string | null;
  executionNotice: string | null;
  durationSeconds: number;
  creditCost: number;
  thumbnailUrl: string | null;
  createdAt: string;
};

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
type StudioProduct = "video_s" | "video_smini" | "image_g";

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
};
const assetRoleNames: Record<LibraryAsset["role"], string> = { character: "人物图", product: "关键资产图", scene: "场景图" };

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

export default function HomePage() {
  const router = useRouter();
  const objectUrls = useRef(new Set<string>());
  const draftHydrated = useRef(false);
  const [user, setUser] = useState<SessionUser | null>();
  const [prompt, setPrompt] = useState("");
  const resolution = "720P";
  const [duration, setDuration] = useState("5 秒");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [product, setProduct] = useState<StudioProduct>("video_s");
  const [assets, setAssets] = useState<Record<AssetRole, PendingAsset[]>>(emptyAssets);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
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
        setDuration(draft.duration ?? "5 秒");
        setAspectRatio(draft.aspectRatio ?? "9:16");
        setProduct(draft.product ?? "video_s");
      } catch {
        window.localStorage.removeItem("niannian-generator-draft");
      }
    }
    draftHydrated.current = true;
  }, [loadCredits, loadTasks, router]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("niannian-generator-draft", JSON.stringify({ prompt, duration, aspectRatio, product }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [aspectRatio, duration, product, prompt]);

  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => { loadTasks().catch(() => undefined); loadCredits().catch(() => undefined); }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadCredits, loadTasks, user]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const readyAssetCount = useMemo(
    () => Object.values(assets).reduce((total, entries) => total + entries.length, 0),
    [assets],
  );

  async function openAssetPicker() {
    setShowAssetPicker(true);
    setLibraryLoading(true);
    try {
      const response = await fetch("/library/assets", { cache: "no-store" });
      const payload = await response.json().catch(() => ({ assets: [] }));
      if (!response.ok) throw new Error("ASSET_LIBRARY_UNAVAILABLE");
      setLibraryAssets(Array.isArray(payload.assets) ? payload.assets : []);
    } catch {
      setMessage("素材库暂时无法读取，请稍后重试");
    } finally {
      setLibraryLoading(false);
    }
  }

  function addLibraryAsset(asset: LibraryAsset) {
    if (readyAssetCount >= 12) {
      setMessage("一次任务最多添加 12 份参考素材，请先移除不需要的素材");
      return;
    }
    setAssets((current) => {
      if (current[asset.role].some((entry) => entry.assetId === asset.id)) return current;
      return {
        ...current,
        [asset.role]: [...current[asset.role], { assetId: asset.id, name: asset.name, url: asset.previewUrl, type: asset.mimeType, file: null, referenceIntent: assetConfig[asset.role].referenceIntent }],
      };
    });
    setShowAssetPicker(false);
    setMessage(`已加入：${asset.name}`);
  }

  const durationSeconds = Number(duration.replace(/\D/g, ""));
  const imageProductSelected = product === "image_g";
  const currentCreditCost = credits?.pricing.automatic[String(durationSeconds)] ?? 0;
  const hasEnoughCredits = Boolean(credits && currentCreditCost > 0 && credits.balance >= currentCreditCost);
  const missingCredits = Math.max(0, currentCreditCost - (credits?.balance ?? 0));
  const validationMessage = imageProductSelected ? "全能图片 G 即将开放" : !prompt.trim() ? "请先填写视频描述" : !credits ? "正在读取积分余额" : currentCreditCost <= 0 ? "当前时长暂时不可用" : !hasEnoughCredits ? `积分不足，还需要 ${missingCredits} 积分` : "";
  const canCreate = Boolean(!imageProductSelected && prompt.trim() && hasEnoughCredits && !submitting);
  const selectedOutputTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId && task.outputReady && task.outputUrl) ?? null,
    [selectedTaskId, tasks],
  );

  function selectAsset(role: AssetRole, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const expectedType = role === "reference_video" ? file.type.startsWith("video/") : file.type.startsWith("image/");
    if (!expectedType) {
      setMessage(role === "reference_video" ? "视频参考需要上传视频文件" : "人物、关键资产和场景需要上传图片文件");
      event.target.value = "";
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setMessage(`文件 ${file.name} 超过 100MB，请压缩后重试`);
      event.target.value = "";
      return;
    }

    if (readyAssetCount >= 12) {
      setMessage("一次任务最多添加 12 份参考素材，请移除不需要的补充参考后再上传");
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

  async function createTask() {
    if (!prompt.trim()) {
      setMessage("请先填写视频描述");
      return;
    }
    if (imageProductSelected) {
      setMessage("全能图片 G 即将开放");
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
                  <small>{prompt.length} / 2000</small>
                </div>
                <div className="generator-prompt-editor">
                  <div className="generator-prompt-highlight" aria-hidden="true">{highlightedPrompt}</div>
                  <textarea
                    ref={promptRef}
                    id="video-prompt"
                    maxLength={2000}
                    value={prompt}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      setShowMentionPicker(event.target.value.slice(0, event.target.selectionStart).endsWith("@") && promptImages.length > 0);
                    }}
                    onKeyDown={(event) => { if (event.key === "Escape") setShowMentionPicker(false); }}
                    placeholder="描述主体、服装或商品、场景、镜头运动和动作节奏。"
                  />
                  {showMentionPicker ? <div className="generator-mention-picker" role="listbox" aria-label="选择引用素材">
                    {promptImages.map(({ asset }, index) => <button key={asset.assetId ?? asset.url} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => insertPromptMention(index)}><img src={asset.url} alt="" /><span>@图片{index + 1}</span><b>{asset.name}</b></button>)}
                  </div> : null}
                </div>
                <div className="generator-prompt-assets">
                  <button className="generator-prompt-library-button" type="button" aria-label="从素材库添加图片素材" title="从素材库添加图片素材" onClick={() => { void openAssetPicker(); }}>
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
                    <option value="video_s">全能视频 S</option>
                    <option value="video_smini">全能视频 Smini</option>
                    <option value="image_g">全能图片 G</option>
                  </select></label>
                </div>
                <div className="generator-options">
                  <div className="generator-fixed-option"><span>模式</span><b>标准</b></div>
                  <div className="generator-fixed-option"><span>分辨率</span><b>{resolution}</b></div>
                  <label>
                    <span>时长</span>
                    <select value={duration} disabled={imageProductSelected} onChange={(event) => setDuration(event.target.value)}>
                      {Array.from({ length: 12 }, (_, index) => <option key={index + 4}>{index + 4} 秒</option>)}
                    </select>
                  </label>
                  <label>
                    <span>比例</span>
                    <select value={aspectRatio} disabled={imageProductSelected} onChange={(event) => setAspectRatio(event.target.value)}>
                      <option>9:16</option>
                      <option>16:9</option>
                      <option>1:1</option>
                    </select>
                  </label>
                </div>
                <div className="generator-production-policy" aria-label="任务计费">
                  <b>{imageProductSelected ? "即将开放" : `${credits?.pricing.automatic[String(durationSeconds)] ?? "--"} 积分`}</b>
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
              <span>标准模式</span>
              <span>{resolution}</span>
              <span>{duration}</span>
            </footer>
          </section>

          <section className="generator-card generator-history-card" ref={taskStatusRef}>
            <header>
              <div><h2>历史记录</h2></div>
              <a href="/projects">查看全部</a>
            </header>
            {tasks.length ? (
              <div className="generator-task-list">
                {tasks.map((task) => {
                  const canPreviewTask = Boolean(task.outputReady && task.outputUrl);
                  const isSelected = task.id === selectedOutputTask?.id;
                  return <button
                    type="button"
                    key={task.id}
                    className={`generator-task-record${canPreviewTask ? " is-previewable" : ""}${isSelected ? " is-selected" : ""}`}
                    disabled={!canPreviewTask}
                    aria-label={canPreviewTask ? "在预览区播放成片" : undefined}
                    onClick={() => setSelectedTaskId(task.id)}
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
          <header><h2 id="asset-picker-title">素材库</h2><button type="button" aria-label="关闭素材库" onClick={() => setShowAssetPicker(false)}><CloseIcon /></button></header>
          {libraryLoading ? <div className="asset-picker-empty">正在读取素材库…</div> : libraryAssets.filter((asset) => !asset.hidden).length ? <div className="asset-picker-grid">
            {libraryAssets.filter((asset) => !asset.hidden).map((asset) => {
              const selected = assets[asset.role].some((entry) => entry.assetId === asset.id);
              return <button className={`asset-picker-item${selected ? " is-selected" : ""}`} type="button" key={asset.id} onClick={() => addLibraryAsset(asset)}>
                <img src={asset.previewUrl} alt="" />
                <span>{assetRoleNames[asset.role]}</span>
                <b title={asset.name}>{asset.name}</b>
              </button>;
            })}
          </div> : <div className="asset-picker-empty">素材库还没有可用图片素材</div>}
        </section>
      </div> : null}

    </main>
  );
}
