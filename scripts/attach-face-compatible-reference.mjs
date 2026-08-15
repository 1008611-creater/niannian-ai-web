import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function required(name) {
  const result = value(name);
  if (!result) throw new Error(`${name.toUpperCase().replaceAll("-", "_")}_REQUIRED`);
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validHash(value) {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validId(value) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(value);
}

function newId() {
  return randomBytes(18).toString("base64url");
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const taskId = required("--task-id");
const sourceAssetId = required("--source-asset-id");
const sourceHash = required("--source-sha256").toLowerCase();
const derivedPath = path.resolve(required("--derived-path"));
const derivedHash = required("--derived-sha256").toLowerCase();
const manifestPath = path.resolve(required("--manifest"));
const dryRun = process.argv.includes("--dry-run");

if (!validId(taskId) || !validId(sourceAssetId)) throw new Error("TASK_OR_ASSET_ID_INVALID");
if (!validHash(sourceHash) || !validHash(derivedHash)) throw new Error("ASSET_HASH_INVALID");
if (path.extname(derivedPath).toLowerCase() !== ".jpg") throw new Error("DERIVED_REFERENCE_MUST_BE_JPG");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest?.taskId !== taskId || manifest?.submissionStatus !== "not_submitted") throw new Error("FACE_MANIFEST_TASK_OR_STATE_INVALID");
if (String(manifest?.source?.sha256 || "").toLowerCase() !== sourceHash || String(manifest?.derived?.sha256 || "").toLowerCase() !== derivedHash) {
  throw new Error("FACE_MANIFEST_HASH_MISMATCH");
}
if (manifest?.processor?.url !== "http://127.0.0.1:9093/face" || manifest?.processor?.lineColor !== "white" || manifest?.processor?.lineThickness !== 2) {
  throw new Error("FACE_MANIFEST_PROCESSOR_CONTRACT_INVALID");
}

const derivedBytes = await readFile(derivedPath);
if (sha256(derivedBytes) !== derivedHash || derivedBytes.length < 1 || derivedBytes.length > 100 * 1024 * 1024) throw new Error("DERIVED_REFERENCE_FILE_INVALID");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const taskResult = await client.query(
    "SELECT id,user_id,execution_mode,status,blocker,provider_task_id,asset_manifest,task_spec_path FROM video_tasks WHERE id=$1 FOR UPDATE",
    [taskId],
  );
  const task = taskResult.rows[0];
  if (!task) throw new Error("TASK_NOT_FOUND");
  if (task.execution_mode !== "manual_assist" || task.status !== "awaiting_manual_operator" || task.provider_task_id) {
    throw new Error("TASK_NOT_SAFE_FOR_DERIVED_REFERENCE_ATTACH");
  }

  const sourceResult = await client.query(
    "SELECT id,user_id,role,original_name,mime_type,sha256 FROM uploaded_assets WHERE id=$1 AND user_id=$2 LIMIT 1",
    [sourceAssetId, task.user_id],
  );
  const source = sourceResult.rows[0];
  if (!source || source.role !== "character" || String(source.sha256).toLowerCase() !== sourceHash) throw new Error("SOURCE_REFERENCE_MISMATCH");
  const taskAssets = JSON.parse(task.asset_manifest);
  if (!Array.isArray(taskAssets) || !taskAssets.some((asset) => asset?.id === sourceAssetId && String(asset?.sha256 || "").toLowerCase() === sourceHash)) {
    throw new Error("SOURCE_REFERENCE_NOT_IN_TASK");
  }

  const currentSpec = JSON.parse(await readFile(task.task_spec_path, "utf8"));
  if (!Array.isArray(currentSpec.references) || !currentSpec.references.some((reference) => reference?.asset_id === sourceAssetId && String(reference?.sha256 || "").toLowerCase() === sourceHash)) {
    throw new Error("SOURCE_REFERENCE_NOT_IN_SPEC");
  }

  const derivedAssetId = newId();
  const targetDirectory = path.join(process.cwd(), "data", "video-assets", task.user_id);
  const targetPath = path.join(targetDirectory, `${derivedAssetId}.jpg`);
  const nextSpec = structuredClone(currentSpec);
  const derivedReference = {
    asset_id: derivedAssetId,
    ref_key: `asset_${derivedAssetId}`,
    path: targetPath,
    sha256: derivedHash,
    role: "video_first_frame_anchor",
    source_role: "character",
    reference_type: "image",
    reference_intent: "identity",
    chinese_duty: "Mimo 人物肖像兼容白线参考",
    is_primary: true,
    sort_order: 0,
    user_confirmation: "confirmed",
    actual_video_input: true,
    upload_eligible: true,
  };
  nextSpec.references = [derivedReference];
  nextSpec.channel_reference_plan = {
    mimo: {
      channel: "mimo",
      max_upload_references: 12,
      supports_multi_reference: true,
      selected_reference_keys: [derivedReference.ref_key],
      selections: [{ ref_key: derivedReference.ref_key, selected: true, selection_rank: 1, reason: "approved Mimo face-compatible derived reference" }],
    },
  };
  nextSpec.reference_lineage = {
    source_asset_id: sourceAssetId,
    source_sha256: sourceHash,
    derived_asset_id: derivedAssetId,
    derived_sha256: derivedHash,
    processor: "http://127.0.0.1:9093/face",
    parameters: { line_color: "white", line_thickness: 2 },
    manifest_sha256: sha256(await readFile(manifestPath)),
  };
  nextSpec.execution_mode = "mac_codex";
  nextSpec.status = "prepared";
  nextSpec.blocker = "awaiting_cost_readback_and_submit_authorization";
  nextSpec.submit_allowed = false;
  nextSpec.cost_gate = { authorized: false, max_cost: "", readback: "pending" };

  if (dryRun) {
    await client.query("ROLLBACK");
    output({ ok: true, dryRun: true, taskId, sourceAssetId, derivedAssetId, derivedHash, nextStatus: "queued_mac", submitAllowed: false });
  } else {
    await mkdir(targetDirectory, { recursive: true });
    await copyFile(derivedPath, targetPath);
    const specBackup = `${task.task_spec_path}.face-compat-before-${Date.now()}.json`;
    const specTemporary = `${task.task_spec_path}.face-compat-${derivedAssetId}.tmp`;
    let specInstalled = false;
    await copyFile(task.task_spec_path, specBackup);
    await writeFile(specTemporary, `${JSON.stringify(nextSpec, null, 2)}\n`, "utf8");
    try {
    await client.query(
      "INSERT INTO uploaded_assets (id,user_id,role,original_name,mime_type,byte_size,sha256,local_path,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [derivedAssetId, task.user_id, "character", "source-person-face-white-2px.jpg", "image/jpeg", derivedBytes.length, derivedHash, targetPath, new Date().toISOString()],
    );
    await client.query(
      "INSERT INTO asset_reference_metadata (asset_id,reference_intent,is_primary,sort_order,chinese_duty,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [derivedAssetId, "identity", 1, 0, "Mimo 人物肖像兼容白线参考", new Date().toISOString()],
    );
    const assetManifest = JSON.stringify([{
      id: derivedAssetId,
      role: "character",
      name: "source-person-face-white-2px.jpg",
      sha256: derivedHash,
      referenceIntent: "identity",
      duty: "Mimo 人物肖像兼容白线参考",
      isPrimary: true,
      sortOrder: 0,
    }]);
    await client.query(
      "UPDATE video_tasks SET execution_mode=$1,status=$2,blocker=$3,provider_task_id=NULL,output_path=NULL,submit_allowed=0,cost_authorized=0,asset_manifest=$4,updated_at=$5 WHERE id=$6",
      ["mac_codex", "queued_mac", "awaiting_cost_readback_and_submit_authorization", assetManifest, new Date().toISOString(), taskId],
    );
    await client.query(
      "INSERT INTO video_task_events (id,task_id,event,detail,created_at) VALUES ($1,$2,$3,$4,$5)",
      [newId(), taskId, "admin_face_compatible_reference_attached", JSON.stringify({ sourceAssetId, sourceSha256: sourceHash, derivedAssetId, derivedSha256: derivedHash, processor: "face_white_2px", submissionStatus: "not_submitted" }), new Date().toISOString()],
    );
      await rename(specTemporary, task.task_spec_path);
      specInstalled = true;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (specInstalled) await copyFile(specBackup, task.task_spec_path).catch(() => undefined);
      await rm(targetPath, { force: true }).catch(() => undefined);
      await rm(specTemporary, { force: true }).catch(() => undefined);
      throw error;
    }
    output({ ok: true, dryRun: false, taskId, sourceAssetId, derivedAssetId, derivedHash, specBackup, nextStatus: "queued_mac", submitAllowed: false });
  }
} finally {
  await client.end();
}
