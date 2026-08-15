import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { processAuthorizedReference } from "../lib/private-face-processor.mjs";
import { validateNativeAudioMediaProbe } from "../windows-mimo-agent/mimo-media-gates.mjs";
import { selectImageToVideoModeControl, selectSemanticControl } from "../windows-mimo-agent/mimo-visible-settings.mjs";

const root = path.resolve(import.meta.dirname, "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function withFaceSecret(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "niannian-face-secret-"));
  const tokenFile = path.join(directory, "token");
  await writeFile(tokenFile, "x".repeat(32), { mode: 0o600 });
  try { return await callback(tokenFile); } finally { await rm(directory, { recursive: true, force: true }); }
}

function response(bytes, headers = {}, status = 200) {
  return new Response(bytes, { status, headers: { "content-type": "image/jpeg", "x-image-width": "1280", "x-image-height": "720", ...headers } });
}

test("private face client rejects public endpoint and never sends a path or URL", async () => {
  const source = Buffer.from("image-fixture");
  await withFaceSecret(async (tokenFile) => assert.rejects(() => processAuthorizedReference({ taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", bytes: source, mimeType: "image/jpeg", sourcePath: "C:/private/source.jpg", outputPath: "C:/private/output.jpg", sourceSha256: hash(source), authorizationText: "exact authorization", endpoint: "https://public.invalid/v1/process", tokenFile, fetchImpl: async () => { throw new Error("must not call"); } }), /FACE_PROCESSOR_ENDPOINT_MUST_BE_PRIVATE/));
  let request;
  const output = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("derived-jpeg")]);
  await withFaceSecret(async (tokenFile) => processAuthorizedReference({ taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", bytes: source, mimeType: "image/jpeg", sourcePath: "C:/private/source.jpg", outputPath: "C:/private/output.jpg", sourceSha256: hash(source), authorizationText: "exact authorization", tokenFile, fetchImpl: async (_url, init) => { request = init; return response(output, { "x-processor-version": "face-white-2px-v1", "x-source-sha256": hash(source), "x-output-sha256": hash(output), "x-faces-detected": "1" }); } }));
  assert.deepEqual(request.body, source);
  assert.equal(String(request.body).includes("C:/private/source.jpg"), false);
});

test("face lineage binds authorization, source, output, fixed transform and duty", async () => {
  const source = Buffer.from("source-image");
  const output = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("derived-image")]);
  const result = await withFaceSecret(async (tokenFile) => processAuthorizedReference({ taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", bytes: source, mimeType: "image/png", sourcePath: "C:/approved/source.png", outputPath: "C:/approved/output.jpg", sourceSha256: hash(source), authorizationText: "authorized once", tokenFile, now: () => "2026-07-28T00:00:00.000Z", fetchImpl: async () => response(output, { "x-processor-version": "face-white-2px-v1", "x-source-sha256": hash(source), "x-output-sha256": hash(output), "x-faces-detected": "2" }) }));
  assert.equal(result.manifest.authorization, "authorized once");
  assert.equal(result.manifest.source.absolutePath, "C:/approved/source.png");
  assert.equal(result.manifest.source.sha256, hash(source));
  assert.equal(result.manifest.output.sha256, hash(output));
  assert.equal(result.manifest.output.absolutePath, "C:/approved/output.jpg");
  assert.equal(result.manifest.duty, "mimo_primary_reference");
  assert.equal(result.manifest.derivedFrom, hash(source));
  assert.deepEqual(result.manifest.processor, { version: "face-white-2px-v1", lineColor: "white", lineThickness: 2 });
});

test("bad face processor output fails closed", async () => {
  const source = Buffer.from("source-image");
  await withFaceSecret(async (tokenFile) => assert.rejects(() => processAuthorizedReference({ taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", bytes: source, mimeType: "image/jpeg", sourcePath: "C:/source.jpg", outputPath: "C:/output.jpg", sourceSha256: hash(source), authorizationText: "authorized", tokenFile, fetchImpl: async () => response(Buffer.from("bad"), { "x-processor-version": "face-white-2px-v1", "x-source-sha256": hash(source), "x-output-sha256": "0".repeat(64) }) }), /FACE_PROCESSOR_OUTPUT_INVALID/));
});

test("face client rejects an environment token even when a secret file exists", async () => {
  const source = Buffer.from("source-image");
  const previous = process.env.FACE_PROCESSOR_TOKEN;
  process.env.FACE_PROCESSOR_TOKEN = "x".repeat(32);
  try {
    await withFaceSecret(async (tokenFile) => assert.rejects(() => processAuthorizedReference({ taskId: "NIANNIAN-WB-REAL-I2V-4S-20260728-01", bytes: source, mimeType: "image/jpeg", sourcePath: "C:/source.jpg", outputPath: "C:/output.jpg", sourceSha256: hash(source), authorizationText: "authorized", tokenFile, fetchImpl: async () => { throw new Error("must not call"); } }), /FACE_PROCESSOR_TOKEN_ENV_FORBIDDEN/));
  } finally {
    if (previous === undefined) delete process.env.FACE_PROCESSOR_TOKEN; else process.env.FACE_PROCESSOR_TOKEN = previous;
  }
});

test("ffprobe completion gate requires native audio and exact 720p video", () => {
  const valid = { streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720 }, { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" }], format: { duration: "4.1" } };
  assert.deepEqual(validateNativeAudioMediaProbe(valid, { duration: 4, width: 1280, height: 720 }).audio.codec, "aac");
  assert.throws(() => validateNativeAudioMediaProbe({ ...valid, streams: valid.streams.slice(0, 1) }, { duration: 4, width: 1280, height: 720 }), /native_audio_missing/);
});

test("submission permits an absent reference-audio control while retaining locked visible video settings", async () => {
  const submit = await readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp-submit.mjs"), "utf8");
  const generate = submit.indexOf("await generate.click()");
  assert.doesNotMatch(submit, /locator\('select'\)\.nth/);
  assert.match(submit, /setSemanticSelect\(page, \{ semantic: "model", expectedValue: "Seedance 2\.0"/);
  assert.match(submit, /semantic: "duration", expectedValue: String\(config\.duration\)/);
  assert.match(submit, /semantic: "aspect_ratio", expectedValue: config\.aspectRatio/);
  assert.match(submit, /generationMode: await setVisibleImageToVideoMode\(page\)/);
  assert.match(submit, /IMAGE_TO_VIDEO_MODE_READBACK_MISMATCH/);
  assert.match(submit, /SETTING_READBACK_MISMATCH/);
  assert.match(submit, /visible_settings: visibleSettings/);
  assert.ok(submit.indexOf("const visibleSettings") < generate);
  assert.match(submit, /const nativeAudio = await nativeAudioState\(page\);/);
  assert.doesNotMatch(submit, /NATIVE_AUDIO_CAPABILITY_UNAVAILABLE|NATIVE_AUDIO_NOT_ENABLED|NATIVE_AUDIO_READBACK_FAILED/);
  assert.match(submit, /audio_mode: 'provider_generated_audio', reference_audio_required: false, reference_audio_count: 0/);
});

test("worker readiness does not block on a missing reference-audio control and delivery never has a local-audio fallback", async () => {
  const worker = await readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8");
  const media = await readFile(path.join(root, "windows-mimo-agent", "mimo-media-gates.mjs"), "utf8");
  assert.match(worker, /referenceAudioRequired: false, audioMode: "provider_generated_audio", blocker: null/);
  assert.doesNotMatch(worker, /MIMO_NATIVE_AUDIO_NOT_READY/);
  assert.match(media, /throw new Error\("native_audio_missing"\)/);
  assert.doesNotMatch(worker, /ffmpeg|local audio|audio fallback/i);
});

test("missing, ambiguous, or wrong image-to-video modes fail before Generate", () => {
  assert.deepEqual(selectImageToVideoModeControl([{ visible: true, kind: "toggle", description: "图生视频", options: null }]), { index: 0, kind: "toggle", option: null });
  assert.throws(() => selectImageToVideoModeControl([{ visible: true, kind: "toggle", description: "文生视频", options: null }]), /MODE_CONTROL_NOT_VISIBLE_OR_AMBIGUOUS/);
  assert.throws(() => selectImageToVideoModeControl([{ visible: true, kind: "toggle", description: "图生视频", options: null }, { visible: true, kind: "toggle", description: "image to video", options: null }]), /MODE_CONTROL_NOT_VISIBLE_OR_AMBIGUOUS/);
});

test("reordered, incorrect, and default-only visible controls cannot satisfy the locked model setting", () => {
  const rule = { semantic: "model", expectedValue: "Seedance 2.0", expectedText: "Seedance 2.0", labels: ["模型", "model"] };
  const reordered = [
    { visible: true, description: "时长 duration", options: [{ value: "4", text: "4秒" }] },
    { visible: true, description: "模型 model", options: [{ value: "Seedance 2.0", text: "Seedance 2.0" }] },
  ];
  assert.deepEqual(selectSemanticControl(reordered, rule), { index: 1, option: { value: "Seedance 2.0", text: "Seedance 2.0" } });
  assert.throws(() => selectSemanticControl([{ visible: true, description: "模型 model", options: [{ value: "other", text: "Other" }] }], rule), /SETTING_CONTROL_NOT_VISIBLE:model/);
  assert.throws(() => selectSemanticControl([{ visible: true, description: "模型 model", options: [{ value: "Seedance 2.0", text: "Seedance 2.0" }] }, { visible: true, description: "模型 model", options: [{ value: "Seedance 2.0", text: "Seedance 2.0" }] }], rule), /SETTING_CONTROL_NOT_VISIBLE:model/);
});

test("provider receipt makes worker sync-only", async () => {
  const worker = await readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8");
  const submitBranch = worker.indexOf("if (!providerTaskId) {");
  const syncLoop = worker.indexOf("for (let cycle = 1");
  assert.ok(submitBranch > 0 && submitBranch < syncLoop);
  assert.match(worker.slice(submitBranch, syncLoop), /providerTaskId = String\(JSON\.parse/);
});

test("face service is loopback-only, authenticated, byte-only and concurrency one", async () => {
  const service = await readFile(path.join(root, "services", "face-processor", "service.py"), "utf8");
  assert.match(service, /HOST = .*"127\.0\.0\.1"/);
  assert.match(service, /FACE_PROCESSOR_MUST_BIND_LOOPBACK/);
  assert.match(service, /HOST == "0\.0\.0\.0" and PRIVATE_NETWORK/);
  assert.match(service, /FACE_PROCESSOR_TOKEN_ENV_FORBIDDEN/);
  assert.match(service, /hmac\.compare_digest/);
  assert.match(service, /threading\.BoundedSemaphore\(1\)/);
  assert.match(service, /IMAGE_MIME_MISMATCH/);
  assert.match(service, /self\.path != "\/face"/);
  assert.doesNotMatch(service, /source_path|source_url|urllib\.request/);
});

test("exact preprocessing runner is task and source hash locked", async () => {
  const runner = await readFile(path.join(root, "scripts", "preprocess-authorized-real-i2v-reference.mjs"), "utf8");
  assert.match(runner, /NIANNIAN-WB-REAL-I2V-4S-20260728-01/);
  assert.match(runner, /59388ad9cc2e37e5d54b03b24f303fb0d83a6a740b4f0d1c9ab7e8af4c375454/);
  assert.match(runner, /http:\/\/127\.0\.0\.1:9093\/face/);
  assert.match(runner, /FACE_PREPROCESS_LOCKED_SOURCE_MISMATCH/);
});

test("fresh exact task requires the derived preprocess manifest while receipt sync skips it", async () => {
  const worker = await readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8");
  const payload = await readFile(path.join(root, "lib", "mimo-windows-worker.ts"), "utf8");
  assert.match(payload, /facePreprocessManifest: spec\.face_preprocess_manifest \?\? null/);
  assert.match(worker, /FACE_PREPROCESS_MANIFEST_REQUIRED/);
  assert.match(worker, /FACE_PREPROCESS_MANIFEST_INVALID/);
  assert.match(worker, /FACE_PREPROCESS_DERIVED_REFERENCE_REQUIRED/);
  assert.match(worker, /FACE_PREPROCESS_DERIVED_UPLOAD_MISMATCH/);
  assert.match(worker, /const references = task\.providerTaskId \? \[\] : selectedReferences\(task\)/);
  assert.match(worker, /source\.sha256 !== EXACT_REAL_SOURCE_SHA256/);
  assert.match(worker, /references\[0\]\.sha256 !== output\.sha256/);
});
