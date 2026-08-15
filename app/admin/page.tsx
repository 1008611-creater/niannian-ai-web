"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type AdminTask = {
  id: string; userEmail: string; executionMode: string; channel: string; prompt: string; model: string;
  resolution: string; durationSeconds: number; aspectRatio: string; assets: { id: string; role: string; name: string }[];
  status: string; blocker: string | null; providerTaskId: string | null; outputPath: string | null;
  submitAllowed: boolean; costAuthorized: boolean; createdAt: string; updatedAt: string;
  operation: { ageMinutes: number; priority: "critical" | "warning" | "normal" | "done"; overdue: boolean; attention: boolean; nextAction: string; slaMinutes: number };
};
type ProductRouting = { video_s: string | null; video_smini: string | null; image_g: string | null };
type Overview = {
  stats: { users: number; projects: number; tasks: number; pending: number; blocked: number; completed: number };
  users: { id: string; email: string; createdAt: string; projectCount: number; taskCount: number; isAdmin: boolean }[];
  tasks: AdminTask[];
  operations: { critical: number; warning: number; overdue: number; awaitingManual: number; awaitingQa: number; recentUsers: number; recentRedemptions: number };
  events: { id: string; taskId: string; event: string; detail: string | null; createdAt: string; userEmail: string }[];
  worker: {
    online: boolean; status: string; pid: number | null; startedAt: string | null; heartbeatAt: string | null;
    modes: string[]; codexAvailable: boolean; mimoDirectConfigured: boolean; serverConfigured: boolean; lastTaskId: string | null;
    lastResult: string | null; lastError: string | null;
  };
  macWorker: {
    configured: boolean; online: boolean; productionReady: boolean; status: string; workerId: string | null; heartbeatAt: string | null;
    activeTaskId: string | null; summary: string | null; version: string | null;
    readiness: null | {
      checkedAt: string; readyToClaim: boolean; blocker: string | null;
      computer: { hostname: string; platform: string; arch: string; workspaceWritable: boolean; ffprobeAvailable: boolean };
      skills: { state: "ready" | "blocked"; bundleName: string | null; bundleVersion: string | null; skills: number | null; blocker: string | null };
      channel: { id: "mimo"; state: string; checkedAt: string; reachable: boolean | null; authenticated: boolean | null; credits: string | null; model: string; blocker: string | null };
    };
  };
  mimoWindowsWorker: {
    configured: boolean; online: boolean; readyToClaim: boolean; status: string; workerId: string | null; heartbeatAt: string | null;
    activeTaskId: string | null; summary: string | null; version: string | null;
    readiness: null | {
      checkedAt: string; readyToClaim: boolean; blocker: string | null;
      computer: { hostname: string; platform: string; arch: string; workspaceWritable: boolean; ffprobeAvailable: boolean };
      skills: { state: "ready" | "blocked"; bundleName: string | null; bundleVersion: string | null; skills: number | null; blocker: string | null };
      channel: { id: "mimo"; state: string; checkedAt: string; reachable: boolean | null; authenticated: boolean | null; credits: string | null; model: string; blocker: string | null };
    };
  };
  channels: { id: string; label: string; configured: boolean; status: string; modes: string[] }[];
  mimoReadiness: {
    checkedAt: string | null; configured: boolean; reachable: boolean | null; authenticated: boolean | null;
    credits: string | null; state: "not_checked" | "configuration_missing" | "ready" | "unreachable" | "authentication_failed" | "unknown_error";
  };
  dolaReadiness: {
    checkedAt: string; configured: boolean; reachable: boolean; authenticated: boolean; proxyConfigured: boolean;
    cdpAvailable: boolean; extensionCount: number; state: "not_checked" | "ready" | "bridge_unreachable" | "interactive_login_required" | "region_restricted" | "capability_invalid";
    blocker: string | null; novncUrl: string | null; allowedActions: string[]; providerSubmitEnabled: false; spendEnabled: false;
  };
  mioraReadiness: {
    checkedAt: string | null; configured: boolean; reachable: boolean | null; authenticated: boolean | null;
    credits: string | null; modelAvailable: boolean | null; model: string; entryUrl: string;
    state: "not_checked" | "configuration_missing" | "ready" | "browser_session_visible" | "unreachable" | "authentication_failed" | "unknown_error";
    blocker: string | null;
  };
  mioraSession: null | {
    channel: "miora"; state: string; visibleProjectUrl: string | null; creditReadback: string | null;
    modelReadback: string | null; lastPreflightAt: string | null; lastSuccessAt: string | null;
    lastBlocker: string | null; updatedAt: string;
  };
  mioraHandoffs: {
    id: string; taskId: string; channel: "miora"; action: "login" | "email_otp" | "phone_otp" | "captcha" | "terms" | "cost_authorization";
    state: "awaiting_user" | "acknowledged" | "resolved" | "expired"; instructions: string; browserUrl: string | null;
    resumeFrom: string; createdAt: string; resolvedAt: string | null;
  }[];
  mioraLearning: {
    evidenceRule: "only_real_receipts"; receiptCount: number; providerTaskCount: number; downloadedAndProbedCount: number;
    qaPassedCount: number; consecutiveVerifiedCount: number; qaPassRate: number | null; activeHumanHandoffCount: number; handoffCounts: Record<string, number>;
    stableConcurrencyLimit: 1 | 3 | 10; concurrencyReason: string; latestVerifiedAt: string | null;
    costBaseline: { state: "not_observed" | "maximum_authorized_only"; note: string };
    templates: { sourceTaskId: string; prompt: string; referenceRoles: string[]; model: string; resolution: string; durationSeconds: number; aspectRatio: string; completedAt: string; source: "real_qa_passed_receipt" }[];
  };
  credits: {
    wallets: { userId: string; userEmail: string; balance: number }[];
    rechargeRequests: { id: string; userId: string; userEmail: string | null; requestedCredits: number; note: string | null; status: string; processedAt: string | null; createdAt: string }[];
  };
};

const modeNames: Record<string, string> = { manual_assist: "人工兜底", mac_codex: "Mac 自动制作", codex_skill: "Windows Skill 自动", server_auto: "服务器自动" };
const channelNames: Record<string, string> = { mimo: "渠道 M", dola: "Dola", miora: "Miora 方法13", auto: "渠道 M（历史任务）" };
const statusNames: Record<string, string> = {
  awaiting_manual_operator: "等待人工接单", manual_in_progress: "人工处理中", queued_skill: "Skill 队列",
  awaiting_human_login: "等待本人登录", awaiting_human_verification: "等待真人验证",
  queued_mac: "等待 Mac 授权", queued_server: "服务器队列", approved_for_execution: "已授权待领取", running_on_mac: "Mac 员工执行中",
  dispatching_skill: "Skill 提交中", syncing_skill: "Skill 同步中",
  dispatching_server: "服务器提交中", syncing_server: "服务器同步中",
  running: "生成中", blocked: "已阻塞", completed: "已完成",
};
const eventNames: Record<string, string> = {
  task_prepared: "任务已创建", admin_claim_manual: "管理员接单", admin_approve_cost: "管理员授权成本",
  admin_retry_automatic: "重新交给自动执行",
  admin_route_channel: "切换视频渠道",
  admin_mark_running: "登记渠道任务", admin_block: "管理员阻塞", admin_retry: "管理员重试", admin_complete: "管理员完成",
  admin_reconcile_official_frontend: "关联官方成片",
  admin_automatic_test_created: "创建自动测试任务",
  worker_claimed: "执行器领取任务", worker_result: "执行器回写结果",
  worker_failed: "执行器阻塞任务", worker_recovered_stale_claim: "执行器恢复中断任务",
  mac_worker_claimed: "Mac 员工领取任务", mac_worker_provider_running: "Mac 员工已提交渠道",
  mac_worker_output_received: "Mac 成片已回传待验收", mac_worker_blocked: "Mac 员工报告阻塞",
  mac_worker_lease_expired: "Mac 任务租约到期重排",
  automatic_fallback_manual: "自动失败转人工兜底", admin_fallback_manual: "管理员转人工兜底",
  admin_review_output: "管理员验收渠道成片",
  miora_human_handoff_requested: "Miora 请求本人接管",
};
const mimoReadinessNames = {
  not_checked: "尚未检查", configuration_missing: "未配置安全凭据", ready: "可执行",
  unreachable: "服务不可达", authentication_failed: "凭据验证失败", unknown_error: "配置异常",
} as const;
const mioraReadinessNames = {
  not_checked: "尚未检查", configuration_missing: "未配置 CDP/Cookie", ready: "可执行",
  browser_session_visible: "浏览器会话可见", unreachable: "服务不可达",
  authentication_failed: "会话验证失败", unknown_error: "配置异常",
} as const;
const mimoChannelStateNames: Record<string, string> = {
  ready: "已登录，可执行", credentials_missing: "Mac 未配置凭据", configuration_invalid: "渠道配置异常",
  authentication_failed: "登录已失效", unreachable: "渠道不可达",
};

function taskAge(minutes: number) {
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟未更新`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时未更新`;
  return `${Math.floor(minutes / (24 * 60))} 天未更新`;
}

export default function AdminPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"tasks" | "users" | "credits" | "channels" | "audit">("tasks");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [focus, setFocus] = useState<"all" | "attention" | "overdue" | "manual" | "qa">("attention");
  const [error, setError] = useState("");
  const [busyTask, setBusyTask] = useState("");
  const [checkingMimo, setCheckingMimo] = useState(false);
  const [checkingDola, setCheckingDola] = useState(false);
  const [checkingMiora, setCheckingMiora] = useState(false);
  const [costAuthorization, setCostAuthorization] = useState<AdminTask | null>(null);
  const [costReadback, setCostReadback] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [automaticRetry, setAutomaticRetry] = useState<AdminTask | null>(null);
  const [officialReconciliation, setOfficialReconciliation] = useState<AdminTask | null>(null);
  const [officialProviderTaskId, setOfficialProviderTaskId] = useState("");
  const [outputReview, setOutputReview] = useState<AdminTask | null>(null);
  const [productRouting, setProductRouting] = useState<ProductRouting | null>(null);
  const [savingProductRoute, setSavingProductRoute] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 403) {
      const session = await fetch("/api/auth/session", { cache: "no-store" }).then((item) => item.json()).catch(() => ({ user: null }));
      router.replace(session.user ? "/home" : "/login?next=/admin");
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "ADMIN_OVERVIEW_UNAVAILABLE");
    setOverview(data);
  }, [router]);

  const loadProductRouting = useCallback(async () => {
    const response = await fetch("/api/admin/product-routing", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "PRODUCT_ROUTING_UNAVAILABLE");
    setProductRouting(data.routing);
  }, []);

  useEffect(() => {
    Promise.all([load(), loadProductRouting()]).catch(() => setError("管理员数据加载失败，请刷新重试"));
    const timer = window.setInterval(() => { load().catch(() => undefined); loadProductRouting().catch(() => undefined); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, loadProductRouting]);

  async function saveProductRoute(product: keyof ProductRouting, channel: string | null) {
    setSavingProductRoute(product);
    setError("");
    try {
      const response = await fetch("/api/admin/product-routing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, channel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PRODUCT_ROUTE_UPDATE_FAILED");
      setProductRouting(data.routing);
    } catch (actionError) {
      setError(actionError instanceof Error ? `产品路由更新失败：${actionError.message}` : "产品路由更新失败");
    } finally {
      setSavingProductRoute("");
    }
  }

  const tasks = useMemo(() => (overview?.tasks ?? []).filter((task) => {
    const term = query.trim().toLowerCase();
    const matches = !term || task.prompt.toLowerCase().includes(term) || task.userEmail.toLowerCase().includes(term) || task.id.toLowerCase().includes(term);
    const focusMatches = focus === "all"
      || (focus === "attention" && task.operation.attention)
      || (focus === "overdue" && task.operation.overdue)
      || (focus === "manual" && ["awaiting_manual_operator", "manual_in_progress", "awaiting_human_login", "awaiting_human_verification"].includes(task.status))
      || (focus === "qa" && task.status === "blocked" && task.blocker === "awaiting_content_qa");
    return matches && focusMatches && (status === "all" || task.status === status);
  }), [overview, query, status, focus]);

  function openTaskFocus(nextFocus: typeof focus) {
    setTab("tasks");
    setFocus(nextFocus);
    setStatus("all");
  }

  function beginCostAuthorization(task: AdminTask) {
    setCostAuthorization(task);
    setCostReadback("");
    setMaxCost("");
  }

  async function submitCostAuthorization() {
    if (!costAuthorization || !costReadback.trim() || !maxCost.trim()) return;
    const task = costAuthorization;
    setBusyTask(task.id);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, action: "approve_cost", costReadback: costReadback.trim(), maxCost: maxCost.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ADMIN_ACTION_FAILED");
      setCostAuthorization(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally {
      setBusyTask("");
    }
  }

  async function submitAutomaticRetry() {
    if (!automaticRetry) return;
    const task = automaticRetry;
    setBusyTask(task.id);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, action: "retry_automatic" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AUTOMATIC_RETRY_FAILED");
      setAutomaticRetry(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally {
      setBusyTask("");
    }
  }

  async function submitOfficialReconciliation() {
    if (!officialReconciliation || !officialProviderTaskId.trim()) return;
    const task = officialReconciliation;
    setBusyTask(task.id); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, action: "reconcile_official_frontend", providerTaskId: officialProviderTaskId.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "OFFICIAL_FRONTEND_RECONCILIATION_FAILED");
      setOfficialReconciliation(null); setOfficialProviderTaskId(""); await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally { setBusyTask(""); }
  }

  async function submitOutputReview() {
    if (!outputReview) return;
    const task = outputReview;
    setBusyTask(task.id); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, action: "review_output", contentQaPassed: true }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "OUTPUT_REVIEW_FAILED");
      setOutputReview(null); await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally { setBusyTask(""); }
  }

  async function runAction(task: AdminTask, action: string) {
    const payload: Record<string, string | boolean> = { taskId: task.id, action };
    if (action === "route_dola" || action === "route_mimo" || action === "route_miora") {
      const channel = action === "route_dola" ? "dola" : action === "route_miora" ? "miora" : "mimo";
      const label = channel === "dola" ? " Dola" : channel === "miora" ? " Miora 方法13" : "渠道 M";
      if (!window.confirm(`确认把这条未授权任务切换到${label}吗？切换不会提交或产生渠道费用。`)) return;
      payload.action = "route_channel";
      payload.channel = channel;
    } else if (action === "approve_cost") {
      beginCostAuthorization(task);
      return;
    } else if (action === "retry_automatic") {
      setAutomaticRetry(task);
      return;
    } else if (action === "block") {
      const note = window.prompt("请输入阻塞原因", task.blocker ?? "渠道暂不可用");
      if (!note) return; payload.note = note;
    } else if (action === "mark_running") {
      const providerTaskId = window.prompt("请输入渠道返回的任务 ID");
      if (!providerTaskId) return; payload.providerTaskId = providerTaskId;
    } else if (action === "reconcile_official_frontend") {
      setOfficialReconciliation(task); setOfficialProviderTaskId(""); return;
    } else if (action === "create_automatic_test") {
      // The user explicitly authorized one controlled, billable test.
    } else if (action === "complete") {
      const outputPath = window.prompt("请输入任务 downloads 目录内的已下载视频绝对路径", task.outputPath ?? "");
      if (!outputPath) return; payload.outputPath = outputPath;
      const ledgerPath = window.prompt("请输入任务 ledger 目录内的账本文件绝对路径");
      if (!ledgerPath) return; payload.ledgerPath = ledgerPath;
      if (!window.confirm("请确认已人工检查成片内容、人物/商品/场景/动作均符合任务要求。服务器还会执行 ffprobe 与时长校验。")) return;
      payload.contentQaPassed = true;
    } else if (action === "review_output") {
      setOutputReview(task); return;
    } else if (action === "miora_handoff_completed") {
      // The only assertion is that the person finished the platform-required
      // step in the visible browser. No password, OTP, cookie or CAPTCHA data
      // is ever sent back to this application.
    } else if (!window.confirm("确定执行该操作吗？")) return;

    setBusyTask(task.id); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ADMIN_ACTION_FAILED");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally { setBusyTask(""); }
  }

  async function checkMimoReadiness() {
    setCheckingMimo(true); setError("");
    try {
      const response = await fetch("/api/admin/mimo-preflight", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "MIMO_PREFLIGHT_UNAVAILABLE");
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? `渠道检查失败：${checkError.message}` : "渠道检查失败");
    } finally { setCheckingMimo(false); }
  }

  async function checkDolaReadiness() {
    setCheckingDola(true); setError("");
    try {
      const response = await fetch("/api/admin/dola-preflight", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.readiness?.blocker || data.error || "DOLA_PREFLIGHT_UNAVAILABLE");
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? `Dola 检查失败：${checkError.message}` : "Dola 检查失败");
      await load().catch(() => undefined);
    } finally { setCheckingDola(false); }
  }

  async function checkMioraReadiness() {
    setCheckingMiora(true); setError("");
    try {
      const response = await fetch("/api/admin/miora-preflight", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.blocker || data.error || "MIORA_PREFLIGHT_UNAVAILABLE");
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? `Miora 检查失败：${checkError.message}` : "Miora 检查失败");
      await load().catch(() => undefined);
    } finally { setCheckingMiora(false); }
  }

  function openMioraSession(url: string | null | undefined) {
    const target = url || overview?.mioraSession?.visibleProjectUrl || overview?.mioraReadiness.entryUrl;
    if (!target) { setError("Miora 会话入口不可用，请先执行只读预检"); return; }
    window.open(target, "_blank", "noopener,noreferrer");
  }

  async function processRecharge(requestId: string, action: "approve_recharge" | "reject_recharge") {
    const approval = action === "approve_recharge";
    if (!window.confirm(approval ? "确认已收到付款并为该用户入账积分吗？" : "确认驳回该充值申请吗？")) return;
    setBusyTask(requestId); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, rechargeRequestId: requestId }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "RECHARGE_ACTION_FAILED");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `充值处理失败：${actionError.message}` : "充值处理失败");
    } finally { setBusyTask(""); }
  }

  if (!overview) return <main className="app-page"><SiteHeader /><div className="admin-loading">{error || "正在加载管理员后台…"}</div></main>;

  return (
    <main className="app-page admin-page">
      <SiteHeader />
      <section className="admin-shell">
        <header className="admin-heading"><div><p>NIANNIAN CONTROL CENTER</p><h1>管理员控制台</h1><span>用户、任务、渠道、成本授权与异常审计</span></div><button onClick={() => load().catch(() => setError("刷新失败"))}>刷新数据</button></header>
        {error ? <div className="admin-alert">{error}</div> : null}
        <div className="admin-stats">
          {[['用户', overview.stats.users], ['项目', overview.stats.projects], ['全部任务', overview.stats.tasks], ['待处理', overview.stats.pending], ['阻塞', overview.stats.blocked], ['已完成', overview.stats.completed]].map(([label, value], index) => <article key={String(label)} className={index === 4 ? "danger" : index === 5 ? "success" : ""}><span>{label}</span><b>{value}</b></article>)}
        </div>
        <section className="admin-operations" aria-label="运营待办">
          <header><div><p>OPERATIONS QUEUE</p><h2>今日运营待办</h2></div><span>每 30 秒自动刷新 · 按最后更新时间计算</span></header>
          <div className="admin-operation-grid">
            <button className={overview.operations.critical ? "critical" : ""} onClick={() => openTaskFocus("attention")}><span>紧急处理</span><b>{overview.operations.critical}</b><small>阻塞、待接单或严重超时</small></button>
            <button className={overview.operations.overdue ? "critical" : ""} onClick={() => openTaskFocus("overdue")}><span>已经超时</span><b>{overview.operations.overdue}</b><small>超过当前阶段服务时限</small></button>
            <button className={overview.operations.awaitingManual ? "warning" : ""} onClick={() => openTaskFocus("manual")}><span>人工兜底</span><b>{overview.operations.awaitingManual}</b><small>等待接单或正在处理</small></button>
            <button onClick={() => openTaskFocus("qa")}><span>待质检交付</span><b>{overview.operations.awaitingQa}</b><small>成片已回传，等待管理员验收</small></button>
            <article><span>24h 新用户</span><b>{overview.operations.recentUsers}</b><small>关注首次任务与使用阻塞</small></article>
            <article><span>24h 兑换</span><b>{overview.operations.recentRedemptions}</b><small>LDXP 兑换成功次数</small></article>
          </div>
        </section>
        <nav className="admin-tabs">
          <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务中心</button>
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>用户管理</button>
          <button className={tab === "credits" ? "active" : ""} onClick={() => setTab("credits")}>积分与充值</button>
          <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>渠道状态</button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>审计记录</button>
        </nav>

        {tab === "tasks" ? <section className="admin-panel">
          <div className="admin-focus-tabs">{([['attention','需要处理'],['overdue','已经超时'],['manual','人工兜底'],['qa','待质检'],['all','全部任务']] as const).map(([value,label]) => <button key={value} className={focus === value ? "active" : ""} onClick={() => setFocus(value)}>{label}</button>)}</div>
          <div className="admin-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱、任务 ID 或提示词" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="admin-task-list">{tasks.length ? tasks.map((task) => <article className={`admin-task priority-${task.operation.priority}`} key={task.id}>
            <div className="admin-task-top"><div><span className={`admin-mode mode-${task.executionMode}`}>{modeNames[task.executionMode] ?? task.executionMode}</span><b>{task.userEmail}</b></div><span className={`admin-status status-${task.status}`}>{statusNames[task.status] ?? task.status}</span></div>
            <p>{task.prompt}</p>
            <div className="admin-task-meta"><span>{channelNames[task.channel] ?? task.channel}</span><span>{task.model}</span><span>{task.resolution}</span><span>{task.durationSeconds}s</span><span>{task.aspectRatio}</span><span>{task.assets.length} 项素材</span></div>
            <div className={`admin-next-action ${task.operation.priority}`}><div><b>{task.operation.nextAction}</b><span>{taskAge(task.operation.ageMinutes)}{task.operation.overdue ? " · 已超过服务时限" : ""}</span></div><em>{task.operation.overdue ? "超时" : task.operation.priority === "critical" ? "紧急" : task.operation.priority === "warning" ? "关注" : "正常"}</em></div>
            {task.blocker ? <div className="admin-blocker">阻塞：{task.blocker}</div> : null}
            <div className="admin-task-foot"><small>{task.id}<br />{new Date(task.createdAt).toLocaleString("zh-CN")}</small><div className="admin-actions">
              {task.status === "awaiting_manual_operator" ? <button onClick={() => runAction(task, "claim_manual")}>接单</button> : null}
              {task.executionMode === "manual_assist" && task.status === "awaiting_manual_operator" && !task.providerTaskId ? <button className="success" onClick={() => runAction(task, "reconcile_official_frontend")}>关联官方成片</button> : null}
              {task.executionMode === "manual_assist" && task.blocker === "automatic_generation_failed_manual_fallback" ? <button onClick={() => runAction(task, "retry_automatic")}>重试自动执行</button> : null}
              {["awaiting_human_login", "awaiting_human_verification"].includes(task.status) && task.channel === "miora" ? <>
                <button onClick={() => openMioraSession(overview.mioraHandoffs.find((handoff) => handoff.taskId === task.id)?.browserUrl)}>打开 Miora 会话</button>
                <button className="success" onClick={() => runAction(task, "miora_handoff_completed")}>我已完成，继续任务</button>
              </> : null}
              {task.providerTaskId && ((["mac_codex", "codex_skill", "server_auto"].includes(task.executionMode) && ["blocked", "running_on_mac", "running"].includes(task.status)) || (task.executionMode === "manual_assist" && task.status === "awaiting_manual_operator" && task.blocker === "automatic_generation_failed_manual_fallback")) ? <button className="success" onClick={() => runAction(task, "resume_provider_sync")}>恢复渠道同步</button> : null}
              {["mac_codex", "codex_skill", "server_auto"].includes(task.executionMode) && task.status !== "completed" && task.blocker !== "awaiting_content_qa" ? <button onClick={() => runAction(task, "fallback_manual")}>转人工兜底</button> : null}
              {!task.costAuthorized && !task.submitAllowed && !task.providerTaskId && ["queued_mac", "queued_skill", "queued_server"].includes(task.status) ? <>
                {task.channel !== "mimo" ? <button onClick={() => runAction(task, "route_mimo")}>改用渠道 M</button> : null}
                {task.channel !== "dola" ? <button onClick={() => runAction(task, "route_dola")}>改用 Dola</button> : null}
                {task.channel !== "miora" ? <button onClick={() => runAction(task, "route_miora")}>改用 Miora</button> : null}
              </> : null}
              {!task.costAuthorized && (task.executionMode !== "manual_assist" || task.status === "manual_in_progress") ? <button className="primary" onClick={() => runAction(task, "approve_cost")}>成本授权</button> : null}
              {!["mac_codex", "codex_skill", "server_auto"].includes(task.executionMode) && task.submitAllowed && !task.providerTaskId && task.status !== "running" ? <button onClick={() => runAction(task, "mark_running")}>登记渠道任务</button> : null}
              {task.status !== "completed" && task.status !== "blocked" ? <button className="danger" onClick={() => runAction(task, "block")}>暂停</button> : null}
              {task.status === "blocked" && task.blocker === "awaiting_content_qa" && task.providerTaskId && task.outputPath ? <button className="success" onClick={() => runAction(task, "review_output")}>验收并交付</button> : null}
              {task.status === "completed" ? <button onClick={() => runAction(task, "create_automatic_test")}>创建自动测试</button> : null}
              {task.status === "blocked" && task.blocker !== "awaiting_content_qa" ? <button onClick={() => runAction(task, "retry")}>重新入队</button> : null}
              {task.executionMode === "manual_assist" && task.status === "manual_in_progress" ? <button className="success" onClick={() => runAction(task, "complete")}>验收并完成</button> : null}
              {busyTask === task.id ? <span>处理中…</span> : null}
            </div></div>
          </article>) : <div className="admin-empty">当前筛选条件下没有任务</div>}</div>
        </section> : null}

        {tab === "users" ? <section className="admin-panel"><div className="admin-table"><div className="admin-table-row head"><span>用户邮箱</span><span>身份</span><span>项目</span><span>任务</span><span>注册时间</span></div>{overview.users.map((user) => <div className="admin-table-row" key={user.id}><b>{user.email}</b><span>{user.isAdmin ? "管理员" : "普通用户"}</span><span>{user.projectCount}</span><span>{user.taskCount}</span><span>{new Date(user.createdAt).toLocaleString("zh-CN")}</span></div>)}</div></section> : null}

        {tab === "credits" ? <section className="admin-panel credits-admin-panel">
          <div className="credits-admin-summary"><b>用户积分余额</b><span>{overview.credits.wallets.reduce((total, wallet) => total + wallet.balance, 0)} 积分</span></div>
          <div className="admin-table"><div className="admin-table-row head"><span>用户邮箱</span><span>余额</span><span>待处理充值</span></div>{overview.credits.wallets.map((wallet) => <div className="admin-table-row" key={wallet.userId}><b>{wallet.userEmail}</b><span>{wallet.balance} 积分</span><span>{overview.credits.rechargeRequests.filter((request) => request.userId === wallet.userId && request.status === "pending").length} 笔</span></div>)}</div>
          <div className="recharge-request-list">{overview.credits.rechargeRequests.length ? overview.credits.rechargeRequests.map((request) => <article key={request.id}><div><b>{request.userEmail ?? "未知用户"}</b><span>申请 {request.requestedCredits} 积分 · {new Date(request.createdAt).toLocaleString("zh-CN")}</span>{request.note ? <p>{request.note}</p> : null}</div><div><em className={`recharge-status ${request.status}`}>{request.status === "pending" ? "待确认付款" : request.status === "approved" ? "已入账" : "已驳回"}</em>{request.status === "pending" ? <div className="admin-actions"><button className="success" disabled={busyTask === request.id} onClick={() => processRecharge(request.id, "approve_recharge")}>确认入账</button><button className="danger" disabled={busyTask === request.id} onClick={() => processRecharge(request.id, "reject_recharge")}>驳回</button></div> : null}</div></article>) : <div className="admin-empty">暂无充值申请</div>}</div>
        </section> : null}

        {tab === "channels" ? <section className="admin-panel">
          <div className="admin-table">
            <div className="admin-table-row head"><span>用户产品</span><span>内部执行渠道</span><span>状态</span></div>
            {(["video_s", "video_smini", "image_g"] as const).map((product) => <div className="admin-table-row" key={product}>
              <b>{product === "video_s" ? "全能视频 S" : product === "video_smini" ? "全能视频 Smini" : "全能图片 G"}</b>
              {product === "image_g" ? <span>暂未接入</span> : <select value={productRouting?.[product] ?? ""} disabled={!productRouting || savingProductRoute === product} onChange={(event) => { void saveProductRoute(product, event.target.value); }}>
                <option value="mimo">Mimo</option>
                <option value="astorie">AStorie</option>
                <option value="higgsfield">Higgsfield</option>
                <option value="miora">Miora</option>
                <option value="dola">Dola</option>
              </select>}
              <span>{savingProductRoute === product ? "保存中" : product === "image_g" ? "待接入图片执行器" : "已生效"}</span>
            </div>)}
          </div>
          <article className={`admin-worker-card ${overview.mimoWindowsWorker.readyToClaim ? "online" : "offline"}`}>
            <header><i /><div><b>Windows Mimo CDP 执行器</b><span>{overview.mimoWindowsWorker.readyToClaim ? "生产预检通过，可领取已授权的渠道 M 任务" : overview.mimoWindowsWorker.online ? "节点在线，但生产预检未通过" : overview.mimoWindowsWorker.configured ? "已配置但当前离线" : "服务密钥尚未配置"}</span></div></header>
            <div className="admin-worker-details">
              <span>节点：{overview.mimoWindowsWorker.workerId ?? "未登记"}</span>
              <span>状态：{overview.mimoWindowsWorker.status}</span>
              <span>当前任务：{overview.mimoWindowsWorker.activeTaskId ?? "无"}</span>
              <span>版本：{overview.mimoWindowsWorker.version ?? "未知"}</span>
              <span>心跳：{overview.mimoWindowsWorker.heartbeatAt ? new Date(overview.mimoWindowsWorker.heartbeatAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.mimoWindowsWorker.readiness ? <div className="admin-production-readiness">
              <article className={overview.mimoWindowsWorker.readiness.computer.workspaceWritable && overview.mimoWindowsWorker.readiness.computer.ffprobeAvailable ? "ready" : "blocked"}><b>Windows 环境</b><span>工作目录：{overview.mimoWindowsWorker.readiness.computer.workspaceWritable ? "可写" : "不可写"}</span><span>媒体探测：{overview.mimoWindowsWorker.readiness.computer.ffprobeAvailable ? "可用" : "缺少 ffprobe"}</span><small>{overview.mimoWindowsWorker.readiness.computer.arch} · {overview.mimoWindowsWorker.readiness.computer.hostname}</small></article>
              <article className={overview.mimoWindowsWorker.readiness.skills.state === "ready" ? "ready" : "blocked"}><b>执行包</b><span>{overview.mimoWindowsWorker.readiness.skills.state === "ready" ? `${overview.mimoWindowsWorker.readiness.skills.skills ?? 0} 项正常` : "校验失败"}</span><span>版本：{overview.mimoWindowsWorker.readiness.skills.bundleVersion ?? "未知"}</span><small>{overview.mimoWindowsWorker.readiness.skills.blocker ?? "候选包与技能路径已验证"}</small></article>
              <article className={overview.mimoWindowsWorker.readiness.channel.state === "ready" ? "ready" : "blocked"}><b>可见 Mimo 前端</b><span>{mimoChannelStateNames[overview.mimoWindowsWorker.readiness.channel.state] ?? overview.mimoWindowsWorker.readiness.channel.state}</span><span>额度：{overview.mimoWindowsWorker.readiness.channel.credits ?? "未读回"}</span><small>{overview.mimoWindowsWorker.readiness.channel.blocker ?? `${overview.mimoWindowsWorker.readiness.channel.model} · 无消费检查`}</small></article>
            </div> : null}
            {overview.mimoWindowsWorker.readiness && !overview.mimoWindowsWorker.readyToClaim ? <div className="admin-readiness-blocker">暂停接单：{overview.mimoWindowsWorker.readiness.blocker ?? "生产检查已过期，请等待 Windows 下一轮检查"}</div> : null}
            {overview.mimoWindowsWorker.summary ? <p>{overview.mimoWindowsWorker.summary}</p> : <p>新建渠道 M 任务只会由该 Windows Worker 领取；历史 Mac 任务保持原记录，不会自动迁移。</p>}
          </article>
          <article className={`admin-worker-card ${overview.macWorker.productionReady ? "online" : "offline"}`}>
            <header><i /><div><b>Mac Codex 历史兼容执行器</b><span>{overview.macWorker.productionReady ? "仅可继续已存在的 Mac 任务" : overview.macWorker.online ? "历史节点在线，但生产预检未通过" : overview.macWorker.configured ? "历史节点已配置但当前离线" : "历史节点未配置"}</span></div></header>
            <div className="admin-worker-details">
              <span>节点：{overview.macWorker.workerId ?? "未登记"}</span>
              <span>状态：{overview.macWorker.status}</span>
              <span>当前任务：{overview.macWorker.activeTaskId ?? "无"}</span>
              <span>版本：{overview.macWorker.version ?? "未知"}</span>
              <span>心跳：{overview.macWorker.heartbeatAt ? new Date(overview.macWorker.heartbeatAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.macWorker.readiness ? <div className="admin-production-readiness">
              <article className={overview.macWorker.readiness.computer.workspaceWritable && overview.macWorker.readiness.computer.ffprobeAvailable ? "ready" : "blocked"}><b>电脑环境</b><span>工作目录：{overview.macWorker.readiness.computer.workspaceWritable ? "可写" : "不可写"}</span><span>媒体探测：{overview.macWorker.readiness.computer.ffprobeAvailable ? "可用" : "缺少 ffprobe"}</span><small>{overview.macWorker.readiness.computer.arch} · {overview.macWorker.readiness.computer.hostname}</small></article>
              <article className={overview.macWorker.readiness.skills.state === "ready" ? "ready" : "blocked"}><b>生产技能</b><span>{overview.macWorker.readiness.skills.state === "ready" ? `${overview.macWorker.readiness.skills.skills ?? 0}/6 正常` : "校验失败"}</span><span>版本：{overview.macWorker.readiness.skills.bundleVersion ?? "未知"}</span><small>{overview.macWorker.readiness.skills.blocker ?? "文件哈希与渠道映射已验证"}</small></article>
              <article className={overview.macWorker.readiness.channel.state === "ready" ? "ready" : "blocked"}><b>Mac 上的 Mimo</b><span>{mimoChannelStateNames[overview.macWorker.readiness.channel.state] ?? overview.macWorker.readiness.channel.state}</span><span>额度：{overview.macWorker.readiness.channel.credits ?? "未读回"}</span><small>{overview.macWorker.readiness.channel.blocker ?? `${overview.macWorker.readiness.channel.model} · 无消费检查`}</small></article>
            </div> : null}
            {overview.macWorker.readiness && !overview.macWorker.productionReady ? <div className="admin-readiness-blocker">暂停接单：{overview.macWorker.readiness.blocker ?? "生产检查已过期，请等待 Mac 下一轮检查"}</div> : null}
            {overview.macWorker.summary ? <p>{overview.macWorker.summary}</p> : <p>仅用于保留和恢复历史 mac_codex 任务；新建渠道 M 任务不会由该节点领取。</p>}
          </article>
          <article className={`admin-worker-card ${overview.worker.online ? "online" : "offline"}`}>
            <header><i /><div><b>服务器辅助执行器</b><span>{overview.worker.online ? "在线，仅处理明确分配的服务器任务" : "当前未在线"}</span></div></header>
            <div className="admin-worker-details">
              <span>Skill：{overview.worker.codexAvailable ? "可用" : "不可用"}</span>
              <span>渠道 M 直连：{overview.worker.mimoDirectConfigured ? "已配置" : "待配置"}</span>
              <span>服务器：{overview.worker.serverConfigured ? "已配置" : "待配置"}</span>
              <span>模式：{overview.worker.modes.length ? overview.worker.modes.map((mode) => modeNames[mode] ?? mode).join(" + ") : "未启动"}</span>
              <span>心跳：{overview.worker.heartbeatAt ? new Date(overview.worker.heartbeatAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.worker.lastError ? <p>最近阻塞：{overview.worker.lastError}</p> : overview.worker.lastResult ? <p>最近结果：{overview.worker.lastResult}</p> : null}
          </article>
          <article className={`admin-worker-card ${overview.mioraSession?.state === "ready" ? "online" : "offline"}`}>
            <header><i /><div><b>Miora / S2 Video 会话中心</b><span>{overview.mioraSession?.state === "ready" ? "会话、积分与模型已读回" : "仅在需要本人操作时接管；不会保存平台凭据"}</span></div></header>
            <div className="admin-worker-details">
              <span>会话：{mioraReadinessNames[overview.mioraReadiness.state]}</span>
              <span>积分：{overview.mioraSession?.creditReadback ?? overview.mioraReadiness.credits ?? "未读回"}</span>
              <span>模型：{overview.mioraSession?.modelReadback ?? overview.mioraReadiness.model ?? "未读回"}</span>
              <span>最近预检：{overview.mioraSession?.lastPreflightAt ? new Date(overview.mioraSession.lastPreflightAt).toLocaleString("zh-CN") : "暂无"}</span>
              <span>最近成功：{overview.mioraSession?.lastSuccessAt ? new Date(overview.mioraSession.lastSuccessAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.mioraSession?.lastBlocker ? <p>最近阻塞：{overview.mioraSession.lastBlocker}</p> : <p>自动部分会固定走画布视频容器、S2 Video、参考图上传、参数读回、task-id 同步与媒体验收。</p>}
            <div className="admin-actions"><button onClick={() => openMioraSession(overview.mioraSession?.visibleProjectUrl)}>打开 Miora 会话</button><button className="admin-readiness-button" onClick={checkMioraReadiness} disabled={checkingMiora}>{checkingMiora ? "检查中…" : "我已登录，重新检查"}</button></div>
          </article>
          {overview.mioraHandoffs.length ? <section className="admin-channel-grid" aria-label="Miora 人工接管">
            {overview.mioraHandoffs.map((handoff) => <article key={handoff.id}><header><i className="standby" /><div><b>需要你操作：{handoff.action === "captcha" ? "真人验证" : handoff.action === "email_otp" ? "邮箱验证码" : handoff.action === "phone_otp" ? "手机验证码" : handoff.action === "terms" ? "确认平台条款" : "登录 Miora"}</b><span>任务 {handoff.taskId.slice(0, 10)} · 完成后任务会从原恢复点继续</span></div></header><p>{handoff.instructions}</p><div className="admin-actions"><button onClick={() => openMioraSession(handoff.browserUrl)}>打开对应会话</button><button className="success" onClick={() => { const task = overview.tasks.find((item) => item.id === handoff.taskId); if (task) void runAction(task, "miora_handoff_completed"); }}>我已完成，继续任务</button></div></article>)}
          </section> : null}
          <section className="admin-channel-grid" aria-label="Miora 渠道画像与真实模板">
            <article><header><i className={overview.mioraLearning.qaPassedCount ? "online" : "standby"} /><div><b>Miora · 渠道复利画像</b><span>只统计真实执行回执，不把教程、截图或 dry-run 当成功</span></div></header><div className="admin-channel-readiness"><span>回执：{overview.mioraLearning.receiptCount}</span><span>已获 task id：{overview.mioraLearning.providerTaskCount}</span><span>下载并探测：{overview.mioraLearning.downloadedAndProbedCount}</span><span>QA 通过：{overview.mioraLearning.qaPassedCount}</span><span>连续闭环：{overview.mioraLearning.consecutiveVerifiedCount}</span><span>QA 通过率：{overview.mioraLearning.qaPassRate === null ? "暂无" : `${Math.round(overview.mioraLearning.qaPassRate * 100)}%`}</span><span>当前并发上限：{overview.mioraLearning.stableConcurrencyLimit}</span><span>待本人接管：{overview.mioraLearning.activeHumanHandoffCount}</span></div><p>{overview.mioraLearning.concurrencyReason}</p><small>{overview.mioraLearning.costBaseline.note}</small></article>
            <article><header><i className={overview.mioraLearning.templates.length ? "online" : "standby"} /><div><b>Miora · 已验证模板库</b><span>仅来自同任务 ID 的 MP4、媒体探测与内容 QA 都通过的成片</span></div></header>{overview.mioraLearning.templates.length ? <div className="admin-audit-list">{overview.mioraLearning.templates.slice(0, 3).map((template) => <article key={template.sourceTaskId}><div><b>{template.model} · {template.resolution} · {template.durationSeconds}s · {template.aspectRatio}</b><span>素材职责：{template.referenceRoles.join(" / ") || "未记录"}</span><p>{template.prompt}</p></div><time>{new Date(template.completedAt).toLocaleString("zh-CN")}</time></article>)}</div> : <p>暂无可复用模板；先完成真实任务的下载、探测和内容 QA。</p>}</article>
          </section>
          <div className="admin-channel-grid">
            <article><header><i className={overview.mimoReadiness.state === "ready" ? "online" : "standby"} /><div><b>渠道 M · 服务器诊断</b><span>{mimoReadinessNames[overview.mimoReadiness.state]}</span></div></header><p>该检查仅用于排查服务器配置；客户是否能接单以上方 Windows Mimo CDP 执行器的生产预检为准。</p><div className="admin-channel-readiness"><span>网络：{overview.mimoReadiness.reachable === null ? "未检查" : overview.mimoReadiness.reachable ? "可达" : "不可达"}</span><span>会话：{overview.mimoReadiness.authenticated === null ? "未检查" : overview.mimoReadiness.authenticated ? "有效" : "无效"}</span>{overview.mimoReadiness.credits ? <span>额度读回：{overview.mimoReadiness.credits}</span> : null}<span>最后检查：{overview.mimoReadiness.checkedAt ? new Date(overview.mimoReadiness.checkedAt).toLocaleString("zh-CN") : "暂无"}</span></div><button className="admin-readiness-button" onClick={checkMimoReadiness} disabled={checkingMimo}>{checkingMimo ? "检查中…" : "检查服务器渠道 M"}</button><small>只验证连通性、会话与额度读回；不会上传素材或提交生成。</small></article>
            <article><header><i className={overview.dolaReadiness.state === "ready" ? "online" : "standby"} /><div><b>Dola · Windows Skill</b><span>{overview.dolaReadiness.state === "ready" ? "已登录，可路由" : overview.dolaReadiness.state === "interactive_login_required" ? "需要在 noVNC 登录" : overview.dolaReadiness.state === "region_restricted" ? "代理地区受限" : overview.dolaReadiness.state === "bridge_unreachable" ? "Dola2API 不可达" : "预检未通过"}</span></div></header><p>通过固定 Skill 路由连接本机 Dola2API；成本授权前必须再次通过实时预检。</p><div className="admin-channel-readiness"><span>代理：{overview.dolaReadiness.proxyConfigured ? "已配置" : "未就绪"}</span><span>CDP：{overview.dolaReadiness.cdpAvailable ? "可用" : "不可用"}</span><span>会话：{overview.dolaReadiness.authenticated ? "有效" : "需要登录"}</span><span>扩展：{overview.dolaReadiness.extensionCount}/2</span><span>最后检查：{new Date(overview.dolaReadiness.checkedAt).toLocaleString("zh-CN")}</span></div><button className="admin-readiness-button" onClick={checkDolaReadiness} disabled={checkingDola}>{checkingDola ? "检查中…" : "检查 Dola"}</button><small>此处只做登录、代理、CDP 和扩展预检；不会上传、提交或扣点。</small></article>
            <article><header><i className={overview.mioraReadiness.state === "ready" ? "online" : "standby"} /><div><b>Miora · 方法13</b><span>{mioraReadinessNames[overview.mioraReadiness.state]}</span></div></header><p>通过已登录的本机 Chrome CDP 执行；成本授权前必须读回会话、积分和 Seedance2 可见性。</p><div className="admin-channel-readiness"><span>网络：{overview.mioraReadiness.reachable === null ? "未检查" : overview.mioraReadiness.reachable ? "可达" : "不可达"}</span><span>会话：{overview.mioraReadiness.authenticated === null ? "未检查" : overview.mioraReadiness.authenticated ? "有效" : "无效"}</span><span>Seedance2：{overview.mioraReadiness.modelAvailable === null ? "未读回" : overview.mioraReadiness.modelAvailable ? "可见" : "未见"}</span><span>积分：{overview.mioraReadiness.credits ?? "未读回"}</span><span>最后检查：{overview.mioraReadiness.checkedAt ? new Date(overview.mioraReadiness.checkedAt).toLocaleString("zh-CN") : "暂无"}</span></div><button className="admin-readiness-button" onClick={checkMioraReadiness} disabled={checkingMiora}>{checkingMiora ? "检查中…" : "检查 Miora"}</button><small>{overview.mioraReadiness.blocker ?? "只读预检，不会上传素材、提交生成或扣点。"}</small></article>
          </div>
        </section> : null}

        {tab === "audit" ? <section className="admin-panel"><div className="admin-audit-list">{overview.events.length ? overview.events.map((event) => <article key={event.id}><i /><div><b>{eventNames[event.event] ?? event.event}</b><span>{event.userEmail} · 任务 {event.taskId.slice(0, 10)}</span><p>{event.detail || "无附加说明"}</p></div><time>{new Date(event.createdAt).toLocaleString("zh-CN")}</time></article>) : <div className="admin-empty">暂无审计事件</div>}</div></section> : null}
      </section>
      {costAuthorization ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setCostAuthorization(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="cost-authorization-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>CHANNEL COST AUTHORIZATION</p><h2 id="cost-authorization-title">授权自动制作</h2></div><button type="button" className="icon-close" onClick={() => setCostAuthorization(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          <p>任务 <b>{costAuthorization.id.slice(0, 10)}</b> 会在授权后由{costAuthorization.channel === "dola" ? "本机 Dola Skill 执行器" : costAuthorization.channel === "miora" ? "本机 Miora CDP 执行器" : "Windows Mimo CDP 执行器"}领取。系统只会提交这一次任务。</p>
          <label><span>渠道状态读回</span><input autoFocus value={costReadback} onChange={(event) => setCostReadback(event.target.value)} placeholder={costAuthorization.channel === "dola" ? "例如：Dola 已登录，当前点数可用" : costAuthorization.channel === "miora" ? "例如：Miora 已登录，1000 积分，Seedance2 可见" : "例如：Mimo 已登录，额度可用"} /></label>
          <label><span>本次最高允许成本</span><input value={maxCost} onChange={(event) => setMaxCost(event.target.value)} placeholder={costAuthorization.channel === "miora" ? "例如：最高 84 Miora 积分" : "例如：最高 5 Mimo 额度"} /></label>
          <small>确认后会进入对应自动队列；未确认不会提交{costAuthorization.channel === "dola" ? " Dola" : costAuthorization.channel === "miora" ? " Miora" : " Mimo"}。</small>
          <footer><button type="button" onClick={() => setCostAuthorization(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={!costReadback.trim() || !maxCost.trim() || Boolean(busyTask)} onClick={() => { void submitCostAuthorization(); }}>{busyTask ? "授权中…" : "确认并授权"}</button></footer>
        </section>
      </div> : null}
      {automaticRetry ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setAutomaticRetry(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="automatic-retry-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>AUTOMATIC RETRY</p><h2 id="automatic-retry-title">重新交给自动执行</h2></div><button type="button" className="icon-close" onClick={() => setAutomaticRetry(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          {automaticRetry.blocker === "automatic_generation_failed_manual_fallback" && automaticRetry.costAuthorized && !automaticRetry.providerTaskId ? <>
            <p>任务 <b>{automaticRetry.id.slice(0, 10)}</b> 在获得渠道任务编号前失败。将复用本任务现有授权，只重试一次自动提交；不会创建新任务或再次扣除网站积分。</p>
            <small>仅限没有渠道任务编号、没有成片的前置提交失败。Mac 领取后仍会遵守当前授权上限。</small>
          </> : <>
            <p>任务 <b>{automaticRetry.id.slice(0, 10)}</b> 会恢复为等待成本授权状态。本操作不会立即提交 Mimo，也不会扣除积分。</p>
            <small>确认后请重新填写渠道状态读回和本次最高允许成本，Mac 才会自动领取这一条任务。</small>
          </>}
          <footer><button type="button" onClick={() => setAutomaticRetry(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={Boolean(busyTask)} onClick={() => { void submitAutomaticRetry(); }}>{busyTask ? "恢复中…" : "确认恢复自动执行"}</button></footer>
        </section>
      </div> : null}
      {officialReconciliation ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setOfficialReconciliation(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="official-reconciliation-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>OFFICIAL RESULT RECONCILIATION</p><h2 id="official-reconciliation-title">关联已完成成片</h2></div><button type="button" className="icon-close" onClick={() => setOfficialReconciliation(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          <p>系统只会同步、下载、媒体探测并等待内容验收，不会重新生成或扣除积分。</p>
          <label><span>官方渠道任务 ID</span><input autoFocus value={officialProviderTaskId} onChange={(event) => setOfficialProviderTaskId(event.target.value)} placeholder="粘贴已完成任务 ID" /></label>
          <footer><button type="button" onClick={() => setOfficialReconciliation(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={!officialProviderTaskId.trim() || Boolean(busyTask)} onClick={() => { void submitOfficialReconciliation(); }}>{busyTask ? "关联中…" : "关联并回传"}</button></footer>
        </section>
      </div> : null}
      {outputReview ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setOutputReview(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="output-review-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>CONTENT QA</p><h2 id="output-review-title">验收并交付</h2></div><button type="button" className="icon-close" onClick={() => setOutputReview(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          <p>已回传的成片会再次通过媒体与时长校验，然后向客户开放播放和下载。</p>
          <footer><button type="button" onClick={() => setOutputReview(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={Boolean(busyTask)} onClick={() => { void submitOutputReview(); }}>{busyTask ? "验收中…" : "确认验收并交付"}</button></footer>
        </section>
      </div> : null}
    </main>
  );
}
