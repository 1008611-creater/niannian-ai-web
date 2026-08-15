import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FACE_SERVICE_URL = "http://127.0.0.1:9093/face";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanFileName(value, fallback) {
  const name = String(value ?? "").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return name && name !== "." && name !== ".." ? name.slice(0, 180) : fallback;
}

function faceServiceUrl(env = process.env) {
  const url = new URL(String(env.MIORA_FACE_LINE_URL || DEFAULT_FACE_SERVICE_URL).trim());
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.protocol !== "http:") {
    throw new Error("face_line_service_not_ready");
  }
  if (url.pathname !== "/face") throw new Error("face_line_service_not_ready");
  return url;
}

async function responseJson(response, blocker) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(blocker);
  return payload;
}

/**
 * Uses the user's locked 9093/face service. This module deliberately performs
 * no image manipulation itself; it only stages the service's returned image
 * in the current task directory and records immutable source/derived hashes.
 */
export async function prepareMioraFaceLineReferences({ task, spec, references, env = process.env }) {
  const policy = spec.face_line;
  if (!policy || policy.required !== true || policy.authorization !== "current_miora_task_goal") {
    throw new Error("MIORA_FACE_LINE_AUTHORIZATION_REQUIRED");
  }
  const service = faceServiceUrl(env);
  const statusUrl = new URL("/admin/api/face/status", service.origin);
  let status;
  try {
    status = await responseJson(await fetch(statusUrl, { signal: AbortSignal.timeout(10_000) }), "face_line_service_not_ready");
  } catch (error) {
    if (String(error?.message ?? error) === "face_line_service_not_ready") throw error;
    throw new Error("face_line_service_not_ready");
  }
  if (status.ready !== true) throw new Error("face_line_service_not_ready");

  const ledgerRoot = String(spec.output_paths?.ledger ?? "").trim();
  if (!ledgerRoot) throw new Error("MIORA_OUTPUT_PATHS_MISSING");
  const derivedRoot = path.join(ledgerRoot, "face-line-references");
  await mkdir(derivedRoot, { recursive: true });
  const processed = [];

  for (const [index, reference] of references.entries()) {
    if (String(reference.reference_type ?? "image") !== "image") throw new Error("MIORA_FACE_LINE_IMAGE_REFERENCE_REQUIRED");
    const sourceBytes = await readFile(reference.path);
    const sourceSha256 = sha256(sourceBytes);
    if (sourceSha256 !== reference.sha256) throw new Error("MIORA_REFERENCE_HASH_MISMATCH");
    const form = new FormData();
    form.set("file", new Blob([sourceBytes]), path.basename(reference.path));
    form.set("line_thickness", String(policy.line_thickness ?? 2));
    form.set("line_color", String(policy.line_color ?? "white"));
    let result;
    try {
      result = await responseJson(await fetch(new URL("/admin/api/face/process", service.origin), {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(90_000),
      }), "face_line_service_not_ready");
    } catch (error) {
      if (String(error?.message ?? error) === "face_line_service_not_ready") throw error;
      throw new Error("face_line_service_not_ready");
    }
    const outputUrlValue = String(result.output_url ?? "").trim();
    if (!outputUrlValue) throw new Error("face_line_service_not_ready");
    let outputResponse;
    try {
      outputResponse = await fetch(new URL(outputUrlValue, service.origin), { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error("face_line_service_not_ready");
    }
    if (!outputResponse.ok) throw new Error("face_line_service_not_ready");
    const outputBytes = Buffer.from(await outputResponse.arrayBuffer());
    if (outputBytes.length < 256) throw new Error("face_line_service_not_ready");
    const serviceName = cleanFileName(result.result?.output_name, `reference-${String(index + 1).padStart(2, "0")}-face.jpg`);
    const outputPath = path.join(derivedRoot, `${String(index + 1).padStart(2, "0")}-${serviceName}`);
    await writeFile(outputPath, outputBytes);
    processed.push({
      ...reference,
      path: outputPath,
      sha256: sha256(outputBytes),
      original_path_before_face_line: reference.path,
      original_sha256_before_face_line: sourceSha256,
      face_line_preprocessed: true,
      face_line_service_url: service.toString(),
      face_line_faces_detected: Number(result.result?.faces_detected ?? 0),
      face_line_output_name: serviceName,
    });
  }

  const manifestPath = path.join(ledgerRoot, "face_preprocess_manifest.json");
  const manifest = {
    schemaVersion: 1,
    provider: "miora",
    taskId: task.id,
    authorization: policy.authorization,
    authorizedOperation: "Use http://127.0.0.1:9093/face to process this task's Miora reference images.",
    service: { url: service.toString(), lineColor: String(policy.line_color ?? "white"), lineThickness: Number(policy.line_thickness ?? 2), statusReady: true },
    references: processed.map((reference) => ({
      refKey: reference.ref_key ?? null,
      originalPath: reference.original_path_before_face_line,
      originalSha256: reference.original_sha256_before_face_line,
      derivedPath: reference.path,
      derivedSha256: reference.sha256,
      facesDetected: reference.face_line_faces_detected,
    })),
    createdAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { references: processed, manifestPath };
}
