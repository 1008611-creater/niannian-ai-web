import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 20 * 1024 * 1024;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function privateEndpoint(value) {
  const url = new URL(String(value || "http://127.0.0.1:9093/face"));
  const allowed = (url.hostname === "127.0.0.1" || url.hostname === "niannian-face-processor") && url.port === "9093" && url.pathname === "/face";
  if (url.protocol !== "http:" || !allowed || url.username || url.password || url.search || url.hash) {
    throw new Error("FACE_PROCESSOR_ENDPOINT_MUST_BE_PRIVATE");
  }
  return url;
}

async function privateToken(tokenFile) {
  if (process.env.FACE_PROCESSOR_TOKEN !== undefined) throw new Error("FACE_PROCESSOR_TOKEN_ENV_FORBIDDEN");
  if (!tokenFile || !path.isAbsolute(tokenFile)) throw new Error("FACE_PROCESSOR_TOKEN_REQUIRED");
  let token;
  try { token = (await readFile(tokenFile, "utf8")).trim(); } catch { throw new Error("FACE_PROCESSOR_TOKEN_REQUIRED"); }
  if (token.length < 32) throw new Error("FACE_PROCESSOR_TOKEN_REQUIRED");
  return token;
}

export async function processAuthorizedReference({
  taskId,
  bytes,
  mimeType,
  sourcePath,
  outputPath,
  sourceSha256,
  authorizationText,
  endpoint = process.env.FACE_PROCESSOR_URL,
  tokenFile = process.env.FACE_PROCESSOR_TOKEN_FILE,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_BYTES) throw new Error("FACE_SOURCE_BYTES_INVALID");
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("FACE_SOURCE_MIME_INVALID");
  const actualSourceHash = hash(bytes);
  if (!/^[a-f0-9]{64}$/.test(String(sourceSha256 || "")) || actualSourceHash !== sourceSha256) throw new Error("FACE_SOURCE_HASH_MISMATCH");
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(String(taskId || "")) || !path.isAbsolute(sourcePath) || !path.isAbsolute(outputPath || "") || !authorizationText) throw new Error("FACE_PREPROCESS_AUTHORITY_INCOMPLETE");
  const bearerToken = await privateToken(tokenFile);
  const response = await fetchImpl(privateEndpoint(endpoint), {
    method: "POST",
    headers: { authorization: `Bearer ${bearerToken}`, "content-type": mimeType, "content-length": String(bytes.length), "x-source-sha256": sourceSha256 },
    body: bytes,
    signal: AbortSignal.timeout(45_000),
  }).catch(() => { throw new Error("face_line_service_not_ready"); });
  if (!response.ok) throw new Error(`face_line_service_not_ready:${response.status}`);
  const output = Buffer.from(await response.arrayBuffer());
  const derivedSha256 = hash(output);
  const processorVersion = response.headers.get("x-processor-version") || "";
  const width = Number(response.headers.get("x-image-width"));
  const height = Number(response.headers.get("x-image-height"));
  if (response.headers.get("content-type") !== "image/jpeg" || output.length < 4 || output.length > MAX_BYTES || output[0] !== 0xff || output[1] !== 0xd8 || output[2] !== 0xff || !Number.isInteger(width) || width < 1 || width > 8192 || !Number.isInteger(height) || height < 1 || height > 8192 || response.headers.get("x-source-sha256") !== sourceSha256 || response.headers.get("x-output-sha256") !== derivedSha256 || !/^face-white-2px-v\d+$/.test(processorVersion)) {
    throw new Error("FACE_PROCESSOR_OUTPUT_INVALID");
  }
  return {
    bytes: output,
    manifest: {
      schema: "niannian_face_preprocess_manifest_v1",
      taskId,
      authorization: authorizationText,
      serviceUrl: privateEndpoint(endpoint).toString(),
      processedAt: now(),
      source: { absolutePath: sourcePath, sha256: sourceSha256, bytes: bytes.length },
      output: { absolutePath: outputPath, sha256: derivedSha256, bytes: output.length, mimeType: "image/jpeg", width, height },
      duty: "mimo_primary_reference",
      derivedFrom: sourceSha256,
      processor: { version: processorVersion, lineColor: "white", lineThickness: 2 },
      receipt: { facesDetected: Number(response.headers.get("x-faces-detected") || 0) },
    },
  };
}

export async function writeAuthorizedReference({ manifestPath, ...input }) {
  if (!path.isAbsolute(manifestPath || "")) throw new Error("FACE_MANIFEST_PATH_REQUIRED");
  const result = await processAuthorizedReference(input);
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const outputTemporary = `${input.outputPath}.${process.pid}.tmp`;
  const manifestTemporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(outputTemporary, result.bytes, { mode: 0o600 });
  await writeFile(manifestTemporary, `${JSON.stringify(result.manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(outputTemporary, input.outputPath);
  await rename(manifestTemporary, manifestPath);
  return result.manifest;
}
