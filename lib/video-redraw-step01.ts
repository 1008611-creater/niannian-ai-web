import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const step01Project = {
  projectId: "NN-20260715083045-8120F5",
  analysisRunId: "analysis-1-0dc5c5d751592e9fd0656a81",
  sourceSha256: "a46f74392e2b3f7ec813b4eba5a0cd9756a7c30225e0033fd671d2cab21cd30c",
  sourceBytes: 145897161,
} as const;

export const step01RequiredArtifactRoles = ["asr", "alignment", "ocr", "shots", "frames"] as const;
export type Step01ArtifactRole = (typeof step01RequiredArtifactRoles)[number];
export type Step01Artifact = { role: Step01ArtifactRole; path: string; sha256: string; bytes: number; mimeType: string };
export type Step01Manifest = {
  schema: "niannian_video_redraw_step01_v1";
  projectId: string;
  analysisRunId: string;
  source: { sha256: string; bytes: number };
  status: "completed" | "blocked" | "failed";
  blocker: string | null;
  artifacts: Step01Artifact[];
  createdAt: string;
};

export function step01Root() {
  return path.join(process.cwd(), "data", "video-redraw-step01", step01Project.projectId);
}

export function step01ManifestPath() {
  return path.join(step01Root(), "step01-evidence-manifest.json");
}

export function isSafeArtifactPath(value: string) {
  const root = path.resolve(step01Root());
  const target = path.resolve(value);
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function validateStep01Manifest(value: unknown): { valid: true; manifest: Step01Manifest } | { valid: false; code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, code: "STEP01_MANIFEST_INVALID" };
  const manifest = value as Partial<Step01Manifest>;
  if (manifest.schema !== "niannian_video_redraw_step01_v1" || manifest.projectId !== step01Project.projectId || manifest.analysisRunId !== step01Project.analysisRunId) return { valid: false, code: "STEP01_MANIFEST_BINDING_INVALID" };
  if (manifest.source?.sha256 !== step01Project.sourceSha256 || manifest.source?.bytes !== step01Project.sourceBytes) return { valid: false, code: "STEP01_SOURCE_BINDING_INVALID" };
  if (manifest.status !== "completed" || manifest.blocker !== null || !Array.isArray(manifest.artifacts)) return { valid: false, code: "STEP01_NOT_ACCEPTED" };
  const roles = new Set(manifest.artifacts.map((artifact) => artifact?.role));
  if (step01RequiredArtifactRoles.some((role) => !roles.has(role))) return { valid: false, code: "STEP01_ARTIFACTS_INCOMPLETE" };
  const paths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!artifact || !step01RequiredArtifactRoles.includes(artifact.role) || !isSafeArtifactPath(artifact.path) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isInteger(artifact.bytes) || artifact.bytes < 1 || typeof artifact.mimeType !== "string") return { valid: false, code: "STEP01_ARTIFACT_INVALID" };
    const resolvedPath = path.resolve(artifact.path);
    if (paths.has(resolvedPath)) return { valid: false, code: "STEP01_ARTIFACT_PATH_DUPLICATED" };
    paths.add(resolvedPath);
  }
  return { valid: true, manifest: manifest as Step01Manifest };
}

export async function readStep01Manifest() {
  try {
    const parsed = JSON.parse(await readFile(step01ManifestPath(), "utf8"));
    return validateStep01Manifest(parsed);
  } catch {
    return { valid: false as const, code: "STEP01_EVIDENCE_NOT_FOUND" };
  }
}

export async function verifyStep01Artifact(artifact: Step01Artifact) {
  if (!isSafeArtifactPath(artifact.path)) return false;
  try {
    await access(artifact.path);
    const details = await stat(artifact.path);
    if (details.size !== artifact.bytes) return false;
    const hash = createHash("sha256").update(await readFile(artifact.path)).digest("hex");
    return hash === artifact.sha256;
  } catch {
    return false;
  }
}

export async function publicStep01Result() {
  const result = await readStep01Manifest();
  if (!result.valid) return { status: "not_ready" as const, blocker: result.code, artifacts: [] as Array<Pick<Step01Artifact, "role" | "mimeType"> & { index: number }> };
  const verified = await Promise.all(result.manifest.artifacts.map(verifyStep01Artifact));
  if (verified.some((value) => !value)) return { status: "not_ready" as const, blocker: "STEP01_ARTIFACT_VERIFICATION_FAILED", artifacts: [] as Array<Pick<Step01Artifact, "role" | "mimeType"> & { index: number }> };
  return { status: "completed" as const, blocker: null, artifacts: result.manifest.artifacts.map(({ role, mimeType }, index) => ({ role, mimeType, index })) };
}
