import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const mimoClient = "C:\\Users\\lsb\\.codex\\skills\\mimo-8001-video-channel\\scripts\\mimo_client.mjs";

function parseArgs(argv) {
  const args = {
    base: "http://127.0.0.1:3026",
    origin: "http://localhost:3026",
    mimoBase: "https://fd.aancn.cn",
    duration: 5,
    aspectRatio: "16:9",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`MISSING_VALUE:${flag}`);
      index += 1;
      return argv[index];
    };
    if (flag === "--authorized") args.authorized = true;
    else if (flag === "--email-env") args.emailEnv = next();
    else if (flag === "--password-env") args.passwordEnv = next();
    else if (flag === "--mimo-username-env") args.mimoUsernameEnv = next();
    else if (flag === "--mimo-password-env") args.mimoPasswordEnv = next();
    else if (flag === "--task-id") args.taskId = next();
    else if (flag === "--image") args.image = next();
    else if (flag === "--motion") args.motion = next();
    else if (flag === "--base") args.base = next();
    else if (flag === "--origin") args.origin = next();
    else if (flag === "--mimo-base") args.mimoBase = next();
    else if (flag === "--duration") args.duration = Number(next());
    else if (flag === "--aspect-ratio") args.aspectRatio = next();
    else throw new Error(`UNKNOWN_ARGUMENT:${flag}`);
  }
  return args;
}

function requiredEnv(name) {
  const value = name ? process.env[name] : "";
  if (!value) throw new Error(`MISSING_ENV:${name ?? "unknown"}`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  throw new Error(`UNSUPPORTED_MEDIA_TYPE:${extension}`);
}

async function responseJson(response, errorCode) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${errorCode}:${response.status}:${body.error ?? body.msg ?? "unknown"}`);
  return body;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const header = values.map((value) => value.split(";", 1)[0]).join("; ");
  if (!header) throw new Error("LOCAL_SESSION_COOKIE_MISSING");
  return header;
}

async function localApi(args, cookie, pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("origin", args.origin);
  headers.set("cookie", cookie);
  return fetch(`${args.base}${pathname}`, { ...options, headers });
}

async function uploadAsset(args, cookie, role, filePath) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set("role", role);
  form.set("file", new File([bytes], path.basename(filePath), { type: mimeType(filePath) }));
  const response = await localApi(args, cookie, "/api/assets", { method: "POST", body: form });
  const body = await responseJson(response, "LOCAL_ASSET_UPLOAD_FAILED");
  if (!body.asset?.id) throw new Error("LOCAL_ASSET_ID_MISSING");
  return body.asset;
}

async function adminAction(args, cookie, taskId, action, fields = {}) {
  const response = await localApi(args, cookie, "/api/admin/overview", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, action, ...fields }),
  });
  return responseJson(response, `ADMIN_${action.toUpperCase()}_FAILED`);
}

async function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-8000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`COMMAND_FAILED:${path.basename(command)}:${stderr || stdout}`)));
  });
}

async function mediaProbe(filePath) {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath], process.env);
  return JSON.parse(result.stdout);
}

async function loadTaskSpec(taskId) {
  const directories = ["video-handoffs", "video-manual-queue"];
  for (const directory of directories) {
    const specPath = path.join(projectDirectory, "data", directory, "pending", `${taskId}.json`);
    try {
      const spec = JSON.parse(await readFile(specPath, "utf8"));
      if (spec.task_id === taskId) return { specPath, spec };
    } catch {
      // The exact task id prevents selecting a stale or unrelated task spec.
    }
  }
  throw new Error("TASK_SPEC_NOT_FOUND");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.authorized) throw new Error("REAL_SUBMISSION_REQUIRES_AUTHORIZED_FLAG");
  if (!args.image || !args.motion) throw new Error("IMAGE_AND_MOTION_REQUIRED");
  if (![5, 10, 15].includes(args.duration)) throw new Error("UNSUPPORTED_DURATION");

  const email = requiredEnv(args.emailEnv);
  const password = requiredEnv(args.passwordEnv);
  const mimoUsername = requiredEnv(args.mimoUsernameEnv);
  const mimoPassword = requiredEnv(args.mimoPasswordEnv);
  const imagePath = path.resolve(args.image);
  const motionPath = path.resolve(args.motion);
  const imageBytes = await readFile(imagePath);

  const mimoLogin = await responseJson(await fetch(`${args.mimoBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: mimoUsername, password: mimoPassword }),
  }), "MIMO_LOGIN_FAILED");
  if (mimoLogin.code !== 200 || !mimoLogin.data?.token) throw new Error("MIMO_LOGIN_TOKEN_MISSING");

  const loginResponse = await fetch(`${args.base}/api/auth/login`, {
    method: "POST",
    headers: { origin: args.origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await responseJson(loginResponse, "LOCAL_LOGIN_FAILED");
  const cookie = cookieHeader(loginResponse);
  const credits = mimoLogin.data.credits ?? "unknown";
  let taskId = args.taskId;
  if (!taskId) {
    const character = await uploadAsset(args, cookie, "character", imagePath);
    const motion = await uploadAsset(args, cookie, "motion", motionPath);
    const prompt = "Based on the reference image, preserve the moonlit blue forest, mist, and distant riders. Slow forward camera movement; trees and fog move naturally as the riders cross the forest. Cinematic, stable composition, no subtitles, no text, no watermark.";
    const taskResponse = await localApi(args, cookie, "/api/video-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionMode: "manual_assist",
        channel: "auto",
        prompt,
        model: "Seedance 2.0",
        resolution: "720P",
        durationSeconds: args.duration,
        aspectRatio: args.aspectRatio,
        assetIds: [character.id, motion.id],
      }),
    });
    const taskBody = await responseJson(taskResponse, "TASK_CREATE_FAILED");
    taskId = taskBody.task?.id;
    if (!taskId) throw new Error("TASK_ID_MISSING");
    // Public intake always creates the protected automatic route. Convert it before
    // cost authorization so the worker cannot claim the controlled real-test task.
    const switched = await adminAction(args, cookie, taskId, "switch_to_manual");
    if (switched.status !== "awaiting_manual_operator") throw new Error("TASK_MANUAL_SWITCH_INVALID");
    const claimed = await adminAction(args, cookie, taskId, "claim_manual");
    if (claimed.status !== "manual_in_progress") throw new Error("TASK_CLAIM_INVALID");
    const authorized = await adminAction(args, cookie, taskId, "approve_cost", {
      costReadback: `Mimo quota readback: ${credits} credits before one ${args.duration}s test.`,
      maxCost: `One authorized ${args.duration}s Mimo test`,
    });
    if (authorized.status !== "manual_in_progress" || !authorized.submitAllowed || !authorized.costAuthorized) {
      throw new Error("TASK_COST_GATE_INVALID");
    }
  }

  const { specPath, spec } = await loadTaskSpec(taskId);
  if (spec.submit_allowed !== true || spec.cost_gate?.authorized !== true || !spec.allowed_channels?.includes("mimo")) {
    throw new Error("TASK_SPEC_NOT_AUTHORIZED_FOR_MIMO");
  }
  const activeReferences = spec.references.filter((reference) => reference.actual_video_input !== false);
  const assetRoot = path.resolve(projectDirectory, "data", "video-assets");
  const activeReferencePath = activeReferences.length === 1 ? path.resolve(activeReferences[0].path) : "";
  if (activeReferences.length !== 1 || !activeReferencePath.startsWith(`${assetRoot}${path.sep}`)) {
    throw new Error("ACTIVE_REFERENCE_PRECHECK_FAILED");
  }
  if (activeReferences[0].sha256 !== sha256(await readFile(activeReferencePath))) throw new Error("ACTIVE_REFERENCE_HASH_MISMATCH");

  const downloads = spec.output_paths.downloads;
  const events = spec.output_paths.events;
  await mkdir(downloads, { recursive: true });
  await mkdir(events, { recursive: true });
  const submissionManifest = path.join(events, "mimo-submission.json");
  const finalManifest = path.join(events, "mimo-final.json");
  const outputPath = path.join(downloads, "mimo-real-test.mp4");
  const preflightPath = path.join(events, "real-test-preflight.json");
  await writeFile(preflightPath, `${JSON.stringify({
    taskId,
    primaryChannel: "mimo",
    primaryPreflight: "login_required",
    selectedChannel: "mimo",
    creditsBefore: credits,
    promptSha256: spec.prompt_sha256,
    activeReferences: activeReferences.map((reference) => ({ ref_key: reference.ref_key, path: reference.path, sha256: reference.sha256, chinese_duty: reference.chinese_duty })),
    supportReferences: spec.references.filter((reference) => reference.actual_video_input === false).map((reference) => ({ ref_key: reference.ref_key, path: reference.path, sha256: reference.sha256 })),
    duration: spec.duration,
    aspectRatio: spec.aspect_ratio,
    resolution: spec.resolution,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");

  const clientEnv = { ...process.env, MIMO_REAL_TEST_USERNAME: mimoUsername, MIMO_REAL_TEST_PASSWORD: mimoPassword };
  await run(process.execPath, [mimoClient, "--username-env", "MIMO_REAL_TEST_USERNAME", "--password-env", "MIMO_REAL_TEST_PASSWORD", "--image", activeReferences[0].path, "--prompt-file", spec.prompt_path, "--duration", String(args.duration), "--aspect-ratio", args.aspectRatio, "--poll-once", "--no-download", "--manifest", submissionManifest], clientEnv);
  const submitted = JSON.parse(await readFile(submissionManifest, "utf8"));
  const providerTaskId = submitted.submitted?.taskId;
  if (!providerTaskId) throw new Error("MIMO_PROVIDER_TASK_ID_MISSING");
  const running = await adminAction(args, cookie, taskId, "mark_running", { providerTaskId });
  if (running.status !== "manual_in_progress") throw new Error("TASK_PROVIDER_STATE_INVALID");
  await run(process.execPath, [mimoClient, "--username-env", "MIMO_REAL_TEST_USERNAME", "--password-env", "MIMO_REAL_TEST_PASSWORD", "--task-id", providerTaskId, "--out", outputPath, "--manifest", finalManifest, "--interval-ms", "10000", "--timeout-ms", "900000"], clientEnv);
  const final = JSON.parse(await readFile(finalManifest, "utf8"));
  if (Number(final.finalStatus?.status) !== 1 || !final.downloaded?.path) throw new Error("MIMO_OUTPUT_NOT_COMPLETED");
  const probe = await mediaProbe(final.downloaded.path);
  const contextPath = path.join(events, "real-test-context.json");
  await writeFile(contextPath, `${JSON.stringify({ taskId, providerTaskId, specPath, preflightPath, submissionManifest, finalManifest, outputPath: final.downloaded.path, outputSha256: final.downloaded.sha256, probe, ledgerPath: path.join(spec.output_paths.ledger, "mimo-real-test-ledger.json") }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ taskId, providerTaskId, contextPath, outputPath: final.downloaded.path, outputSha256: final.downloaded.sha256, duration: spec.duration, aspectRatio: spec.aspect_ratio })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
