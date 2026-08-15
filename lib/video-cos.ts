import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import COS from "cos-nodejs-sdk-v5";

const DEFAULT_PREFIX = "video-workbench";
const SIGNED_URL_TTL_SECONDS = 300;
const CVM_METADATA_ROOT = "http://169.254.0.23/latest/meta-data/cam/security-credentials";

export type VideoCosDelivery = {
  provider: "tencent_cos";
  bucket: string;
  region: string;
  object_key: string;
  etag: string;
  sha256: string;
  byte_size: number;
  content_type: string;
  uploaded_at: string;
  verified_at: string;
};

type CosEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function requiredValue(env: CosEnvironment, name: string) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error("VIDEO_COS_NOT_CONFIGURED");
  return value;
}

export function videoCosConfigured(env: CosEnvironment = process.env) {
  const storageConfigured = ["TENCENT_COS_BUCKET", "TENCENT_COS_REGION"].every((name) => Boolean(String(env[name] ?? "").trim()));
  const staticCredentials = ["TENCENT_COS_SECRET_ID", "TENCENT_COS_SECRET_KEY"].every((name) => Boolean(String(env[name] ?? "").trim()));
  const cvmRole = String(env.TENCENT_COS_CVM_ROLE ?? "").trim().toLowerCase() === "true";
  return storageConfigured && (staticCredentials || cvmRole);
}

export function videoCosRequired(env: CosEnvironment = process.env) {
  return String(env.VIDEO_DELIVERY_COS_REQUIRED ?? "").trim().toLowerCase() === "true";
}

export function videoCosPrefix(env: CosEnvironment = process.env) {
  const prefix = String(env.TENCENT_COS_PREFIX ?? DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{0,119}$/.test(prefix) || prefix.split("/").includes("..")) {
    throw new Error("VIDEO_COS_PREFIX_INVALID");
  }
  return prefix;
}

function safeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error(`VIDEO_COS_${label}_INVALID`);
  return value;
}

export function videoCosObjectKey(input: { userId: string; taskId: string; sha256: string }, env: CosEnvironment = process.env) {
  const sha256 = input.sha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("VIDEO_COS_SHA256_INVALID");
  return `${videoCosPrefix(env)}/outputs/${safeSegment(input.userId, "USER_ID")}/${safeSegment(input.taskId, "TASK_ID")}/${sha256}.mp4`;
}

type CvmRoleCredentials = COS.Credentials;
let cachedCvmCredentials: CvmRoleCredentials | null = null;

async function cvmRoleCredentials(env: CosEnvironment): Promise<CvmRoleCredentials> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedCvmCredentials && cachedCvmCredentials.ExpiredTime > nowSeconds + 120) return cachedCvmCredentials;
  const configuredRole = String(env.TENCENT_COS_CVM_ROLE_NAME ?? "").trim();
  const roleResponse = configuredRole ? null : await fetch(`${CVM_METADATA_ROOT}/`, { signal: AbortSignal.timeout(2_000) });
  if (roleResponse && !roleResponse.ok) throw new Error("VIDEO_COS_CVM_ROLE_UNAVAILABLE");
  const roleName = configuredRole || String(await roleResponse?.text()).trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(roleName)) throw new Error("VIDEO_COS_CVM_ROLE_INVALID");
  const response = await fetch(`${CVM_METADATA_ROOT}/${encodeURIComponent(roleName)}`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error("VIDEO_COS_CVM_CREDENTIALS_UNAVAILABLE");
  const value = await response.json() as Record<string, unknown>;
  const secretId = String(value.SecretId ?? "");
  const secretKey = String(value.SecretKey ?? "");
  const securityToken = String(value.Token ?? "");
  const expiredTime = Number(value.ExpiredTime ?? 0);
  if (!secretId || !secretKey || !securityToken || !Number.isFinite(expiredTime)) throw new Error("VIDEO_COS_CVM_CREDENTIALS_INVALID");
  cachedCvmCredentials = {
    TmpSecretId: secretId,
    TmpSecretKey: secretKey,
    SecurityToken: securityToken,
    StartTime: nowSeconds - 30,
    ExpiredTime: expiredTime,
  };
  return cachedCvmCredentials;
}

function client(env: CosEnvironment) {
  if (String(env.TENCENT_COS_CVM_ROLE ?? "").trim().toLowerCase() === "true") {
    return new COS({
      getAuthorization: (_options, callback) => {
        void cvmRoleCredentials(env).then(callback).catch(() => callback({
          TmpSecretId: "unavailable",
          TmpSecretKey: "unavailable",
          SecurityToken: "unavailable",
          StartTime: 0,
          ExpiredTime: 0,
        }));
      },
    });
  }
  return new COS({
    SecretId: requiredValue(env, "TENCENT_COS_SECRET_ID"),
    SecretKey: requiredValue(env, "TENCENT_COS_SECRET_KEY"),
    ...(String(env.TENCENT_COS_SECURITY_TOKEN ?? "").trim() ? { SecurityToken: String(env.TENCENT_COS_SECURITY_TOKEN).trim() } : {}),
  });
}

function stripEtag(value: unknown) {
  return String(value ?? "").replace(/^"|"$/g, "");
}

export async function uploadAndVerifyVideoDelivery(input: {
  userId: string;
  taskId: string;
  outputPath: string;
  onStage?: (stage: "upload" | "verify", detail: { byteSize: number; sha256: string }) => void | Promise<void>;
}, env: CosEnvironment = process.env): Promise<VideoCosDelivery | null> {
  if (!videoCosConfigured(env)) {
    if (videoCosRequired(env)) throw new Error("VIDEO_COS_NOT_CONFIGURED");
    return null;
  }

  const bytes = await readFile(input.outputPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const bucket = requiredValue(env, "TENCENT_COS_BUCKET");
  const region = requiredValue(env, "TENCENT_COS_REGION");
  const objectKey = videoCosObjectKey({ userId: input.userId, taskId: input.taskId, sha256 }, env);
  const cos = client(env);
  const uploadedAt = new Date().toISOString();
  const put = await new Promise<COS.PutObjectResult>((resolve, reject) => cos.putObject({
    Bucket: bucket,
    Region: region,
    Key: objectKey,
    Body: bytes,
    ContentType: "video/mp4",
    ContentDisposition: `inline; filename="niannian-video-${input.taskId.slice(0, 10)}.mp4"`,
    "x-cos-meta-sha256": sha256,
  }, (error, result) => error ? reject(error) : resolve(result)));
  await input.onStage?.("upload", { byteSize: bytes.length, sha256 });
  const downloaded = await cos.getObject({ Bucket: bucket, Region: region, Key: objectKey });
  if (!downloaded.Body) throw new Error("VIDEO_COS_OBJECT_BODY_MISSING");
  const verifiedBytes = Buffer.from(downloaded.Body);
  const verifiedSha256 = createHash("sha256").update(verifiedBytes).digest("hex");
  if (verifiedBytes.length !== bytes.length || verifiedSha256 !== sha256) throw new Error("VIDEO_COS_OBJECT_VERIFY_MISMATCH");
  const contentLength = Number(downloaded.headers?.["content-length"] ?? verifiedBytes.length);
  if (contentLength !== bytes.length) throw new Error("VIDEO_COS_OBJECT_SIZE_MISMATCH");
  await input.onStage?.("verify", { byteSize: verifiedBytes.length, sha256: verifiedSha256 });

  return {
    provider: "tencent_cos",
    bucket,
    region,
    object_key: objectKey,
    etag: stripEtag(downloaded.ETag || put.ETag),
    sha256,
    byte_size: bytes.length,
    content_type: "video/mp4",
    uploaded_at: uploadedAt,
    verified_at: new Date().toISOString(),
  };
}

export function readVerifiedVideoCosDelivery(spec: Record<string, unknown>): VideoCosDelivery | null {
  const completion = spec.completion_evidence;
  if (!completion || typeof completion !== "object") return null;
  const delivery = (completion as Record<string, unknown>).cos;
  if (!delivery || typeof delivery !== "object") return null;
  const value = delivery as Record<string, unknown>;
  if (value.provider !== "tencent_cos" || typeof value.verified_at !== "string") return null;
  if (typeof value.bucket !== "string" || typeof value.region !== "string" || typeof value.object_key !== "string") return null;
  if (!/^[a-f0-9]{64}$/.test(String(value.sha256 ?? "")) || !Number.isSafeInteger(Number(value.byte_size)) || Number(value.byte_size) <= 0) return null;
  const prefix = `${videoCosPrefix()}/`;
  if (!value.object_key.startsWith(prefix) || value.object_key.split("/").includes("..")) return null;
  return value as VideoCosDelivery;
}

export async function signedVideoCosUrl(delivery: VideoCosDelivery, input: { download: boolean }, env: CosEnvironment = process.env) {
  if (delivery.bucket !== requiredValue(env, "TENCENT_COS_BUCKET") || delivery.region !== requiredValue(env, "TENCENT_COS_REGION")) {
    throw new Error("VIDEO_COS_DELIVERY_SCOPE_MISMATCH");
  }
  const expectedPrefix = `${videoCosPrefix(env)}/`;
  if (!delivery.object_key.startsWith(expectedPrefix) || delivery.object_key.split("/").includes("..")) {
    throw new Error("VIDEO_COS_OBJECT_KEY_INVALID");
  }
  const extension = path.extname(delivery.object_key).toLowerCase() || ".mp4";
  const disposition = `${input.download ? "attachment" : "inline"}; filename="niannian-video${extension}"`;
  const signedUrl = await new Promise<string>((resolve, reject) => client(env).getObjectUrl({
    Bucket: delivery.bucket,
    Region: delivery.region,
    Key: delivery.object_key,
    Sign: true,
    Method: "GET",
    Expires: SIGNED_URL_TTL_SECONDS,
    Protocol: "https:",
    Query: { "response-content-disposition": disposition, "response-content-type": delivery.content_type },
  }, (error, result) => error ? reject(error) : resolve(result.Url)));
  const publicHost = String(env.TENCENT_COS_PUBLIC_HOST ?? "").trim().toLowerCase();
  if (!publicHost) return signedUrl;
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(publicHost) || publicHost.includes("..")) {
    throw new Error("VIDEO_COS_PUBLIC_HOST_INVALID");
  }
  const publicUrl = new URL(signedUrl);
  publicUrl.protocol = "https:";
  publicUrl.host = publicHost;
  return publicUrl.toString();
}
