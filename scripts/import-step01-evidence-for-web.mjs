import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const project = {
  projectId: "NN-20260715083045-8120F5",
  analysisRunId: "analysis-1-0dc5c5d751592e9fd0656a81",
  sourceSha256: "a46f74392e2b3f7ec813b4eba5a0cd9756a7c30225e0033fd671d2cab21cd30c",
  sourceBytes: 145897161,
};
const roleFiles = [
  { role: "asr", relative: "EP001_transcript.srt", mimeType: "text/plain; charset=utf-8" },
  { role: "asr", relative: "EP001_dialogue_ledger.json", mimeType: "application/json; charset=utf-8" },
  { role: "alignment", relative: "EP001_qwen3_forced_aligner_receipt.json", mimeType: "application/json; charset=utf-8" },
  { role: "ocr", relative: "smart_ocr/EP001_smart_ocr_ledger.json", mimeType: "application/json; charset=utf-8" },
  { role: "shots", relative: "transnet_shots/EP001_transnet_shots.json", mimeType: "application/json; charset=utf-8" },
  { role: "shots", relative: "shotlevel_start_mid_end_manifest.json", mimeType: "application/json; charset=utf-8" },
  { role: "frames", relative: "shotlevel_start_mid_end_frames/EP001_transnet_shot_0001_start_00-00-00.000.png", mimeType: "image/png" },
  { role: "frames", relative: "shotlevel_start_mid_end_frames/EP001_transnet_shot_0001_mid_00-00-01.160.png", mimeType: "image/png" },
  { role: "frames", relative: "shotlevel_start_mid_end_frames/EP001_transnet_shot_0001_end_00-00-02.360.png", mimeType: "image/png" },
  { role: "frames", relative: "step01_evidence_manifest.json", mimeType: "application/json; charset=utf-8" },
];

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function assertSafeRelative(relative) {
  const normalized = relative.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error(`STEP01_WEB_IMPORT_UNSAFE_RELATIVE:${relative}`);
  }
  return normalized;
}

async function main() {
  const sourceRoot = path.resolve(arg("--source-root"));
  if (!sourceRoot || sourceRoot === process.cwd()) throw new Error("STEP01_WEB_IMPORT_SOURCE_REQUIRED");
  const targetRoot = path.resolve(arg("--target-root", path.join(process.cwd(), "data", "video-redraw-step01", project.projectId)));
  const strictManifestPath = path.join(sourceRoot, "step01_evidence_manifest.json");
  const strictManifest = JSON.parse(await readFile(strictManifestPath, "utf8"));
  if (strictManifest.schema !== "niannian.step01_evidence_manifest.v1") throw new Error("STEP01_STRICT_MANIFEST_SCHEMA_INVALID");
  if (strictManifest.node_id !== "step01_evidence" || strictManifest.status !== "verified" || strictManifest.downstream_consumable !== true) throw new Error("STEP01_STRICT_MANIFEST_NOT_VERIFIED");
  if (strictManifest.source?.sha256 !== project.sourceSha256 || strictManifest.source?.bytes !== project.sourceBytes) throw new Error("STEP01_STRICT_SOURCE_BINDING_INVALID");
  const boundary = strictManifest.boundary || {};
  if (boundary.step02_completed !== false || boundary.step04_prompt_created !== false || boundary.step05_image_created !== false || boundary.provider_invoked !== false) throw new Error("STEP01_STRICT_BOUNDARY_INVALID");

  const artifactsRoot = path.join(targetRoot, "artifacts");
  await rm(artifactsRoot, { recursive: true, force: true });
  await mkdir(artifactsRoot, { recursive: true });

  const artifacts = [];
  for (const item of roleFiles) {
    const relative = assertSafeRelative(item.relative);
    const source = path.join(sourceRoot, relative);
    const target = path.join(artifactsRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
    const bytes = (await stat(target)).size;
    artifacts.push({ role: item.role, path: target, sha256: await sha256(target), bytes, mimeType: item.mimeType });
  }

  const manifest = {
    schema: "niannian_video_redraw_step01_v1",
    projectId: project.projectId,
    analysisRunId: project.analysisRunId,
    source: { sha256: project.sourceSha256, bytes: project.sourceBytes },
    status: "completed",
    blocker: null,
    artifacts,
    createdAt: new Date().toISOString(),
    strictEvidence: {
      status: strictManifest.status,
      downstreamConsumable: strictManifest.downstream_consumable,
      gates: strictManifest.gates,
      counts: strictManifest.counts,
    },
  };
  await mkdir(targetRoot, { recursive: true });
  await writeFile(path.join(targetRoot, "step01-evidence-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ ok: true, targetRoot, artifacts: artifacts.length }));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
