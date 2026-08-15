import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { probeVideoDuration } from "../lib/video-output-gate.mjs";

const modelId = "cinematic_studio_video_3_5";
const clean = (value) => String(value ?? "").replace(/(token|secret|cookie|password)=\S+/gi, "$1=[redacted]").replace(/\s+/g, " ").trim().slice(0, 400);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function cli(env) { return String(env.HIGGSFIELD_BIN || "higgsfield").trim(); }
export function higgsfieldDirectConfigured(env = process.env) { return Boolean(cli(env)); }

async function invoke(command, args) {
  await access(command).catch(() => { if (command.includes(path.sep)) throw new Error("HIGGSFIELD_CLI_NOT_FOUND"); });
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = ""; let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", () => reject(new Error("HIGGSFIELD_CLI_NOT_AVAILABLE")));
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`HIGGSFIELD_CLI_FAILED:${code}:${clean(err)}`)));
  });
}

function resultJson(text) {
  try { return JSON.parse(String(text).trim()); } catch { throw new Error("HIGGSFIELD_CLI_INVALID_JSON"); }
}
function field(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) if (typeof value[key] === "string" && value[key]) return value[key];
  for (const nested of Object.values(value)) { const found = field(nested, keys); if (found) return found; }
  return null;
}
async function jsonFile(target, value) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(value, null, 2)}\n`); }

export async function runHiggsfieldDirectTask({ task, spec, env = process.env, fetchImpl = fetch, probe = probeVideoDuration }) {
  const command = cli(env);
  const existing = task.provider_task_id || spec.provider_task_id || null;
  let payload;
  if (existing) {
    payload = resultJson(await invoke(command, ["generate", "get", existing, "--json", "--no-color"]));
  } else {
    const reference = Array.isArray(spec.references) ? spec.references[0] : null;
    const args = ["generate", "create", modelId, "--prompt", String(spec.prompt || ""), "--duration", String(spec.duration || "").replace(/[^\d]/g, ""), "--aspect-ratio", String(spec.aspect_ratio || ""), "--resolution", "720p", "--wait", "--json", "--no-color"];
    if (reference?.path) args.push("--start-image", String(reference.path));
    payload = resultJson(await invoke(command, args));
  }
  const providerTaskId = field(payload, ["job_id", "jobId", "id", "task_id", "taskId"]);
  if (!providerTaskId) throw new Error("HIGGSFIELD_PROVIDER_TASK_ID_MISSING");
  const outputUrl = field(payload, ["result_url", "resultUrl", "video_url", "videoUrl", "url"]);
  if (!outputUrl) return { status: "running", providerTaskId, outputPath: null, blocker: null, summary: "Higgsfield 已提交，正在生成。", mediaProbePassed: false, contentQaPassed: false, ledgerPath: null };
  const downloads = String(spec.output_paths?.downloads || ""); const ledgerRoot = String(spec.output_paths?.ledger || "");
  if (!path.isAbsolute(downloads) || !path.isAbsolute(ledgerRoot)) throw new Error("TASK_OUTPUT_PATHS_INVALID");
  const outputPath = path.join(downloads, "higgsfield-output.mp4"); await mkdir(downloads, { recursive: true });
  const response = await fetchImpl(outputUrl); if (!response.ok || !response.body) throw new Error(`HIGGSFIELD_DOWNLOAD_FAILED:${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
  const bytes = await readFile(outputPath); const ledgerPath = path.join(ledgerRoot, "higgsfield-provider-ledger.json");
  await jsonFile(ledgerPath, { provider: "higgsfield", taskId: task.id, providerTaskId, model: modelId, output: { path: outputPath, bytes: bytes.length, sha256: hash(bytes) }, probedDuration: await probe(outputPath), completedAt: new Date().toISOString() });
  return { status: "blocked", providerTaskId, outputPath, blocker: "awaiting_content_qa", summary: "Higgsfield 成片已下载并通过媒体探测，等待内容验收后交付。", mediaProbePassed: true, contentQaPassed: false, ledgerPath };
}
