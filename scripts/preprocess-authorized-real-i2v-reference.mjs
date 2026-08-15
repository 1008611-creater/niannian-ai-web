#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAuthorizedReference } from "../lib/private-face-processor.mjs";

const TASK_ID = "NIANNIAN-WB-REAL-I2V-4S-20260728-01";
const SOURCE_SHA256 = "59388ad9cc2e37e5d54b03b24f303fb0d83a6a740b4f0d1c9ab7e8af4c375454";
const AUTHORIZATION = "用户明确授权本任务在上传 Mimo 前，将锁定 LSB 原图通过 http://127.0.0.1:9093/face 执行一次 white/2px 加白线处理；不授权其他本地修图。";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const taskId = argument("--task-id");
const sourcePath = path.resolve(argument("--source") || "");
const outputPath = path.resolve(argument("--output") || "");
const manifestPath = path.resolve(argument("--manifest") || "");
if (taskId !== TASK_ID || !argument("--source") || !argument("--output") || !argument("--manifest")) throw new Error("FACE_PREPROCESS_EXACT_TASK_ARGUMENTS_REQUIRED");
const bytes = await readFile(sourcePath);
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
if (sourceSha256 !== SOURCE_SHA256) throw new Error("FACE_PREPROCESS_LOCKED_SOURCE_MISMATCH");
const manifest = await writeAuthorizedReference({
  taskId: TASK_ID,
  bytes,
  mimeType: /\.png$/i.test(sourcePath) ? "image/png" : /\.webp$/i.test(sourcePath) ? "image/webp" : "image/jpeg",
  sourcePath,
  outputPath,
  manifestPath,
  sourceSha256,
  authorizationText: AUTHORIZATION,
});
process.stdout.write(`${JSON.stringify({ ok: true, taskId: TASK_ID, sourceSha256, derivedSha256: manifest.output.sha256, manifestPath })}\n`);
