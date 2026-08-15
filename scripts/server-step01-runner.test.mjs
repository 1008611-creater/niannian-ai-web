import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function invoke(args, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/server-step01-runner.mjs", ...args], { cwd: process.cwd(), env: { ...process.env, ...environment } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("Step01 preflight fail-closes before inspecting or exposing a missing Mimo credential", async () => {
  const result = await invoke(["--preflight"], { MIMO_API_KEY: "", MIMOASR_API_KEY: "", XIAOMI_MIMO_API_KEY: "", MIMO_TOKEN: "" });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /MIMO_ASR_CREDENTIAL_REQUIRED/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /token|authorization|cookie/i);
});

test("Step01 reducer accepts only the exact source and every required artifact", async () => {
  const program = `import('./lib/video-redraw-step01.ts').then(({step01Project,validateStep01Manifest})=>{const artifact=(role)=>({role,path:'E:/codex/aisp/aidaihuo/niannian-ai-web/data/video-redraw-step01/'+step01Project.projectId+'/'+role+'.json',sha256:'a'.repeat(64),bytes:1,mimeType:'application/json'});const value={schema:'niannian_video_redraw_step01_v1',projectId:step01Project.projectId,analysisRunId:step01Project.analysisRunId,source:{sha256:step01Project.sourceSha256,bytes:step01Project.sourceBytes},status:'completed',blocker:null,artifacts:['asr','alignment','ocr','shots','frames'].map(artifact),createdAt:'2026-07-21T00:00:00.000Z'};const duplicate={...value,artifacts:value.artifacts.map((item,index)=>index===1?{...item,path:value.artifacts[0].path}:item)};if(!validateStep01Manifest(value).valid||validateStep01Manifest({...value,source:{...value.source,sha256:'b'.repeat(64)}}).valid||validateStep01Manifest({...value,artifacts:value.artifacts.slice(1)}).valid||validateStep01Manifest(duplicate).valid)process.exit(1)})`;
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "-e", program], { cwd: process.cwd() });
    let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
});

test("Step01 web importer accepts only a verified strict manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "step01-import-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  const files = [
    "EP001_transcript.srt",
    "EP001_dialogue_ledger.json",
    "EP001_qwen3_forced_aligner_receipt.json",
    "smart_ocr/EP001_smart_ocr_ledger.json",
    "transnet_shots/EP001_transnet_shots.json",
    "shotlevel_start_mid_end_manifest.json",
    "shotlevel_start_mid_end_frames/EP001_transnet_shot_0001_start_00-00-00.000.png",
    "shotlevel_start_mid_end_frames/EP001_transnet_shot_0001_mid_00-00-01.160.png",
    "shotlevel_start_mid_end_frames/EP001_transnet_shot_0001_end_00-00-02.360.png",
  ];
  await Promise.all(files.map(async (file) => {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await writeFile(path.join(source, file), file);
  }));
  await writeFile(path.join(source, "step01_evidence_manifest.json"), JSON.stringify({
    schema: "niannian.step01_evidence_manifest.v1",
    node_id: "step01_evidence",
    status: "verified",
    downstream_consumable: true,
    source: { sha256: "a46f74392e2b3f7ec813b4eba5a0cd9756a7c30225e0033fd671d2cab21cd30c", bytes: 145897161 },
    boundary: { step02_completed: false, step04_prompt_created: false, step05_image_created: false, provider_invoked: false },
    gates: { source_ffprobe: true },
    counts: { transnet_shots: 37 },
  }));
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/import-step01-evidence-for-web.mjs", "--source-root", source, "--target-root", target], { cwd: process.cwd() });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  const imported = JSON.parse(await readFile(path.join(target, "step01-evidence-manifest.json"), "utf8"));
  assert.equal(imported.status, "completed");
  assert.equal(imported.artifacts.length, 10);
});
