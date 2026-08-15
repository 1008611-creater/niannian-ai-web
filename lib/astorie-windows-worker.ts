import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId, dbOne, dbRun, dbTransaction, timestamp } from "@/lib/auth";
import { probeVideoDuration } from "@/lib/video-output-gate.mjs";
import { uploadAndVerifyVideoDelivery, videoCosConfigured } from "@/lib/video-cos";
import type { VideoTaskRecord } from "@/lib/video-tasks";

const dataRoot = path.join(process.cwd(), "data");
const MAX_RESULT_BYTES = 500 * 1024 * 1024;
const MAX_LEDGER_BYTES = 1024 * 1024;
const resultExtensions = new Set([".mp4", ".mov", ".webm", ".mkv"]);

type TaskSpec = Record<string, unknown> & { references?: Array<Record<string, unknown>> };

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function workerId(value: unknown) {
  const id = cleanText(value, 80);
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(id)) throw new Error("ASTORIE_WINDOWS_WORKER_ID_INVALID");
  return id;
}

function configuredToken() {
  const token = process.env.ASTORIE_WINDOWS_AGENT_TOKEN?.trim();
  if (!token || token.length < 24) throw new Error("ASTORIE_WINDOWS_WORKER_NOT_CONFIGURED");
  return token;
}

export function authorizeAStorieWorker(header: string | null) {
  const expected = Buffer.from(configuredToken());
  const provided = Buffer.from(header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function outputPaths(taskId: string) {
  const root = path.join(dataRoot, "video-outputs", taskId);
  return { downloads: path.join(root, "downloads"), ledger: path.join(root, "ledger") };
}

async function atomicJson(target: string, value: unknown) {
  const temp = `${target}.${createId()}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function taskById(id: string) {
  return dbOne<VideoTaskRecord>("SELECT * FROM video_tasks WHERE id = ? LIMIT 1", [id]);
}

async function readSpec(task: VideoTaskRecord) {
  const root = path.resolve(dataRoot);
  const resolved = path.resolve(task.task_spec_path);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("TASK_SPEC_OUTSIDE_DATA_DIRECTORY");
  return JSON.parse(await readFile(resolved, "utf8")) as TaskSpec;
}

async function mutateSpec(task: VideoTaskRecord, mutate: (spec: TaskSpec) => void) {
  const spec = await readSpec(task);
  mutate(spec);
  await atomicJson(task.task_spec_path, spec);
}

async function addEvent(taskId: string, event: string, detail: Record<string, unknown>) {
  await dbRun("INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)", [createId(), taskId, event, JSON.stringify(detail), timestamp()]);
}

function validTask(task: VideoTaskRecord) {
  return task.execution_mode === "codex_skill"
    && task.channel === "astorie"
    && task.model.trim() === "Seedance 2.0 Mini"
    && task.resolution.toUpperCase() === "720P"
    && task.duration_seconds >= 4 && task.duration_seconds <= 15;
}

function taskPayload(task: VideoTaskRecord, id: string) {
  return readSpec(task).then((spec) => ({
    id: task.id,
    workerId: id,
    channel: "astorie",
    prompt: String(spec.prompt ?? task.prompt),
    promptSha256: String(spec.prompt_sha256 ?? ""),
    generationType: spec.generation_type === "image_to_video" ? "image_to_video" : "text_to_video",
    model: task.model,
    resolution: task.resolution,
    durationSeconds: task.duration_seconds,
    aspectRatio: task.aspect_ratio,
    providerTaskId: task.provider_task_id,
    allowedChannels: ["astorie"],
    allowed_channels: ["astorie"],
    skillRoute: ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "astorie-seedance2-channel"],
    skill_route: ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "astorie-seedance2-channel"],
    submitAllowed: task.submit_allowed === 1,
    submit_allowed: task.submit_allowed === 1,
    costGate: { authorized: task.cost_authorized === 1, maximum_cost: Number(spec.maximum_cost ?? (spec.cost_gate as Record<string, unknown> | undefined)?.maximum_cost ?? (spec.cost_gate as Record<string, unknown> | undefined)?.max_cost ?? 0) },
    channelReferencePlan: spec.channel_reference_plan ?? { astorie: { channel: "astorie", max_upload_references: 1, selected_reference_keys: [] } },
    channel_reference_plan: spec.channel_reference_plan ?? { astorie: { channel: "astorie", max_upload_references: 1, selected_reference_keys: [] } },
    references: Array.isArray(spec.references) ? spec.references.slice(0, 1) : [],
    outputContract: { reportPath: `/api/internal/windows-astorie/tasks/${task.id}/result` },
  }));
}

// Exactly one AStorie worker may move an authorized queued task to running.
// Once a receipt is present it can only be synchronized, never generated again.
export async function claimAStorieTask(workerIdInput: unknown) {
  const id = workerId(workerIdInput);
  const claimed = await dbTransaction(async (transaction) => {
    const candidates = await transaction.all<VideoTaskRecord>(
      `SELECT * FROM video_tasks WHERE execution_mode = ? AND channel = ? AND ((status = ? AND provider_task_id IS NOT NULL) OR status IN (?, ?))
       AND submit_allowed = 1 AND cost_authorized = 1 ORDER BY updated_at ASC LIMIT 20`,
      ["codex_skill", "astorie", "running", "queued_skill", "approved_for_execution"],
    );
    const task = candidates.find(validTask) ?? null;
    if (!task) return null;
    if (task.status === "running" && task.provider_task_id) return task;
    const changed = await transaction.run(
      `UPDATE video_tasks SET status = ?, blocker = NULL, updated_at = ?
       WHERE id = ? AND status = ? AND provider_task_id IS NULL AND submit_allowed = 1 AND cost_authorized = 1`,
      ["running", timestamp(), task.id, task.status],
    );
    if (changed !== 1) return null;
    await transaction.run("INSERT INTO video_task_events (id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)", [createId(), task.id, "astorie_windows_worker_claimed", JSON.stringify({ workerId: id }), timestamp()]);
    return { ...task, status: "running", blocker: null };
  });
  return claimed ? taskPayload(claimed, id) : null;
}

function providerIdentity(value: unknown) {
  const id = cleanText(value, 240);
  if (!/^(req_[A-Za-z0-9_-]+|astorie:[A-Za-z0-9._:/?&=%-]+)$/.test(id)) throw new Error("ASTORIE_PROVIDER_ID_INVALID");
  return id;
}

function receipt(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("ASTORIE_PROVIDER_RECEIPT_REQUIRED");
  const input = value as Record<string, unknown>;
  const projectUrl = cleanText(input.projectUrl, 1000);
  const nodeId = cleanText(input.nodeId, 240);
  const actualCost = input.actualCost === undefined || input.actualCost === null ? null : Number(input.actualCost);
  const width = Number(input.width);
  const height = Number(input.height);
  const durationSeconds = Number(input.durationSeconds);
  if (!/^https:\/\/astorie\.ai\//.test(projectUrl) || !nodeId || !Number.isFinite(width) || !Number.isFinite(height)
    || !Number.isFinite(durationSeconds) || durationSeconds < 4 || durationSeconds > 15
    || (actualCost !== null && (!Number.isFinite(actualCost) || actualCost < 0))) throw new Error("ASTORIE_PROVIDER_RECEIPT_INVALID");
  return { projectUrl, nodeId, actualCost, width, height, durationSeconds, observedAt: timestamp() };
}

export async function recordAStorieReceipt(input: { taskId: string; workerId: unknown; providerTaskId: unknown; receipt: unknown; summary?: unknown }) {
  const id = workerId(input.workerId);
  const providerTaskId = providerIdentity(input.providerTaskId);
  const observed = receipt(input.receipt);
  const task = await taskById(input.taskId);
  if (!task || !validTask(task) || task.status !== "running") throw new Error("ASTORIE_WINDOWS_TASK_NOT_ACTIVE");
  if (task.provider_task_id && task.provider_task_id !== providerTaskId) throw new Error("PROVIDER_TASK_ID_MISMATCH");
  await dbRun("UPDATE video_tasks SET provider_task_id = ?, submit_allowed = 1, updated_at = ? WHERE id = ? AND status = ?", [providerTaskId, timestamp(), task.id, "running"]);
  await mutateSpec(task, (spec) => {
    spec.provider_task_id = providerTaskId;
    spec.reconciliation_only = true;
    spec.provider_receipt = { provider_task_id: providerTaskId, worker_id: id, model: task.model, resolution: task.resolution, requested_duration_seconds: task.duration_seconds, requested_aspect_ratio: task.aspect_ratio, ...observed };
  });
  await addEvent(task.id, "astorie_provider_receipt_observed", { providerTaskId, workerId: id, ...observed, summary: cleanText(input.summary, 1000) || null });
  return { status: "running", providerTaskId };
}

function resultStatus(value: unknown) {
  if (value === "running" || value === "completed" || value === "blocked") return value;
  throw new Error("ASTORIE_WINDOWS_RESULT_STATUS_INVALID");
}

export async function acceptAStorieTaskResult(input: { taskId: string; workerId: unknown; status: unknown; providerTaskId: unknown; summary?: unknown; blocker?: unknown; mediaSpec?: unknown; receipt?: unknown; output?: File | null; ledger?: File | null }) {
  const id = workerId(input.workerId);
  const status = resultStatus(input.status);
  let task = await taskById(input.taskId);
  if (!task || !validTask(task) || task.status !== "running") throw new Error("ASTORIE_WINDOWS_TASK_NOT_ACTIVE");
  if (status === "blocked" && !task.provider_task_id) {
    const blocker = cleanText(input.blocker, 240) || "astorie_worker_blocked_before_receipt";
    await dbRun("UPDATE video_tasks SET status = ?, blocker = ?, submit_allowed = 1, updated_at = ? WHERE id = ?", ["blocked", blocker, timestamp(), task.id]);
    await addEvent(task.id, "astorie_worker_blocked_before_receipt", { workerId: id, blocker });
    return { status: "blocked", blocker };
  }
  const providerTaskId = providerIdentity(input.providerTaskId);
  if (!task.provider_task_id && input.receipt) await recordAStorieReceipt({ taskId: task.id, workerId: id, providerTaskId, receipt: input.receipt, summary: input.summary });
  task = await taskById(input.taskId);
  if (!task || task.provider_task_id !== providerTaskId) throw new Error("PROVIDER_TASK_ID_MISMATCH");
  if (status === "running") return { status: "running", providerTaskId };
  if (status === "blocked") {
    const blocker = cleanText(input.blocker, 240) || "astorie_worker_blocked";
    await dbRun("UPDATE video_tasks SET status = ?, blocker = ?, submit_allowed = 1, updated_at = ? WHERE id = ?", ["blocked", blocker, timestamp(), task.id]);
    await addEvent(task.id, "astorie_worker_blocked_after_receipt", { providerTaskId, workerId: id, blocker });
    return { status: "blocked", blocker };
  }
  if (!(input.output instanceof File) || input.output.size < 1 || input.output.size > MAX_RESULT_BYTES) throw new Error("ASTORIE_WINDOWS_RESULT_FILE_INVALID");
  if (!(input.ledger instanceof File) || input.ledger.size < 2 || input.ledger.size > MAX_LEDGER_BYTES) throw new Error("ASTORIE_WINDOWS_LEDGER_FILE_INVALID");
  if (!resultExtensions.has(path.extname(input.output.name).toLowerCase())) throw new Error("ASTORIE_WINDOWS_RESULT_FORMAT_INVALID");
  let ledger: Record<string, unknown>;
  const ledgerText = await input.ledger.text();
  try { ledger = JSON.parse(ledgerText) as Record<string, unknown>; } catch { throw new Error("ASTORIE_WINDOWS_LEDGER_JSON_INVALID"); }
  const outputs = outputPaths(task.id);
  const outputPath = path.join(outputs.downloads, `astorie-windows-${Date.now()}${path.extname(input.output.name).toLowerCase()}`);
  const ledgerPath = path.join(outputs.ledger, "astorie-windows-ledger.json");
  await mkdir(outputs.downloads, { recursive: true });
  await mkdir(outputs.ledger, { recursive: true });
  await writeFile(outputPath, Buffer.from(await input.output.arrayBuffer()));
  await writeFile(ledgerPath, ledgerText, "utf8");
  let probedDuration: number;
  try { probedDuration = await probeVideoDuration(outputPath); } catch (error) { await rm(outputPath, { force: true }); await rm(ledgerPath, { force: true }); throw error; }
  const outputSha256 = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  const supplied = input.mediaSpec && typeof input.mediaSpec === "object" ? input.mediaSpec as Record<string, unknown> : {};
  const actual = { durationSeconds: Number(supplied.durationSeconds) || probedDuration, width: Number(supplied.width) || null, height: Number(supplied.height) || null, audio: cleanText(supplied.audio, 80) || null };
  const mismatch = Math.abs(probedDuration - task.duration_seconds) > Math.max(1, task.duration_seconds * 0.2)
    || (actual.width !== null && actual.height !== null && `${actual.width}:${actual.height}` !== task.aspect_ratio);
  const cos = videoCosConfigured() ? await uploadAndVerifyVideoDelivery({ userId: task.user_id, taskId: task.id, outputPath }) : null;
  await dbRun("UPDATE video_tasks SET status = ?, blocker = NULL, output_path = ?, submit_allowed = 0, updated_at = ? WHERE id = ?", ["completed", outputPath, timestamp(), task.id]);
  await mutateSpec(task, (spec) => {
    spec.status = "completed"; spec.output_path = outputPath; spec.provider_ledger_path = ledgerPath;
    spec.actual_media_spec = actual; spec.spec_mismatch = mismatch || undefined;
    spec.completion_evidence = { media_probe_passed: true, ledger_path: ledgerPath, probed_duration_seconds: probedDuration, ...(cos ? { cos } : { local: { output_path: outputPath, sha256: outputSha256, byte_size: input.output!.size } }) };
  });
  await addEvent(task.id, mismatch ? "astorie_spec_mismatch_observed" : "astorie_spec_matched", { providerTaskId, requested: { durationSeconds: task.duration_seconds, aspectRatio: task.aspect_ratio }, actual, probedDuration });
  await addEvent(task.id, "astorie_worker_output_auto_delivered", { providerTaskId, outputPath, ledgerPath, outputSha256, probedDuration, deliveryProvider: cos ? "tencent_cos" : "local_private", ledgerKeys: Object.keys(ledger) });
  return { status: "completed", outputPath, ledgerPath, probedDuration, specMismatch: mismatch };
}
