import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const project = {
  projectId: "NN-20260715083045-8120F5",
  analysisRunId: "analysis-1-0dc5c5d751592e9fd0656a81",
  sourceSha256: "a46f74392e2b3f7ec813b4eba5a0cd9756a7c30225e0033fd671d2cab21cd30c",
  sourceBytes: 145897161,
};
const root = path.join(process.cwd(), "data", "video-redraw-step01", project.projectId);
const officialMimoBases = new Set(["https://api.xiaomimimo.com/v1", "https://token-plan-cn.xiaomimimo.com/v1"]);

function fail(code) { const error = new Error(code); error.code = code; throw error; }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
function run(bin, args) { return new Promise((resolve, reject) => { const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] }); let error = ""; child.stderr.on("data", (chunk) => { error = `${error}${chunk}`.slice(-1000); }); child.on("error", () => reject(new Error("FFMPEG_UNAVAILABLE"))); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFMPEG_FAILED:${error.replace(/\s+/g, " ").trim()}`))); }); }
async function preflight() {
  const mimoKey = process.env.MIMO_API_KEY || process.env.MIMOASR_API_KEY || process.env.XIAOMI_MIMO_API_KEY || process.env.MIMO_TOKEN;
  if (!mimoKey) return { ready: false, blocker: "MIMO_ASR_CREDENTIAL_REQUIRED" };
  const mimoBase = String(process.env.MIMO_API_BASE || "https://api.xiaomimimo.com/v1").replace(/\/$/, "");
  if (!officialMimoBases.has(mimoBase)) return { ready: false, blocker: "MIMO_ASR_API_BASE_INVALID" };
  const skillRoot = process.env.STEP01_SKILL_ROOT;
  if (!skillRoot) return { ready: false, blocker: "STEP01_SERVER_BUNDLE_NOT_INSTALLED" };
  try { await access(path.join(skillRoot, "scripts", "build_audio_evidence.py")); await access(path.join(skillRoot, "scripts", "extract_episode_frames.py")); await access(path.join(skillRoot, "scripts", "finalize_step01_evidence.py")); } catch { return { ready: false, blocker: "STEP01_SERVER_BUNDLE_INCOMPLETE" }; }
  try { await run(process.env.FFMPEG_BIN || "ffmpeg", ["-version"]); } catch { return { ready: false, blocker: "FFMPEG_UNAVAILABLE" }; }
  return { ready: true, blocker: null };
}

async function main() {
  const sourceIndex = process.argv.indexOf("--source");
  if (process.argv.includes("--preflight")) { console.log(JSON.stringify(await preflight())); return; }
  if (sourceIndex < 0 || !process.argv[sourceIndex + 1]) fail("STEP01_SOURCE_REQUIRED");
  const ready = await preflight(); if (!ready.ready) fail(ready.blocker);
  const source = path.resolve(process.argv[sourceIndex + 1]);
  await access(source);
  const sourceInfo = await stat(source);
  if (sourceInfo.size !== project.sourceBytes || await sha256(source) !== project.sourceSha256) fail("STEP01_SOURCE_BINDING_INVALID");
  // The sealed server bundle owns Mimo ASR, Qwen3 ForcedAligner, speaker pass,
  // Paddle OCR, TransNetV2, native frames, and final evidence validation.
  // This runner never falls back to a desktop, browser session, or local OCR/ASR.
  fail("STEP01_SERVER_EXECUTION_NOT_DEPLOYED");
}

main().catch(async (error) => {
  const blocker = error?.code || error?.message || "STEP01_RUNNER_FAILED";
  await mkdir(root, { recursive: true });
  const manifest = { schema: "niannian_video_redraw_step01_v1", projectId: project.projectId, analysisRunId: project.analysisRunId, source: { sha256: project.sourceSha256, bytes: project.sourceBytes }, status: "blocked", blocker, artifacts: [], createdAt: new Date().toISOString() };
  const target = path.join(root, "step01-evidence-manifest.json");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2));
  await rename(temporary, target);
  console.error(blocker);
  process.exitCode = 1;
});
