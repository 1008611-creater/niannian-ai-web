#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.env.NIANNIAN_SKILL_SOURCE_ROOT || "C:/Users/lsb/.codex/skills");
const bundleVersion = process.env.REDRAW_SKILL_BUNDLE_VERSION || "image-redraw-runtime-2";
const outputRoot = path.join(projectRoot, "runtime", "skill-bundles", bundleVersion);
const sources = [
  ["commerce-video-redraw-router/SKILL.md", "skills/commerce-video-redraw-router/SKILL.md"],
  ["runninghub-image2-image/SKILL.md", "skills/runninghub-image2-image/SKILL.md"],
  ["runninghub-image2-image/references/api.md", "skills/runninghub-image2-image/references/api.md"],
];

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

const files = [];
for (const [sourceRelative, targetRelative] of sources) {
  const bytes = await readFile(path.join(sourceRoot, ...sourceRelative.split("/")));
  if (/RUNNINGHUB_API_KEY\s*=|AUTHORIZATION:\s*BEARER\s+[A-Za-z0-9_-]{20,}/i.test(bytes.toString("utf8"))) throw new Error(`SKILL_BUNDLE_SECRET_RISK:${sourceRelative}`);
  files.push({ sourceRelative, targetRelative, bytes, sha256: hash(bytes) });
}

await rm(outputRoot, { recursive: true, force: true });
for (const file of files) {
  const target = path.join(outputRoot, ...file.targetRelative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.bytes);
}

const manifest = {
  schema_version: "niannian_server_skill_bundle_v1",
  bundle_version: bundleVersion,
  skills: ["commerce-video-redraw-router", "runninghub-image2-image"],
  allowed_tools: ["cos_read", "gpt_plan", "runninghub_image2_image", "gpt_vision_qa", "cos_write"],
  prohibited_tools: ["local_pixel_edit", "arbitrary_shell", "desktop_gui", "codex_thread"],
  runtime_kind: "image_redraw",
  subject_modes: ["product", "character", "scene", "first_frame"],
  plan_schema: "image_redraw_plan_v2",
  qa_schema: "image_redraw_visual_qa_v2",
  files: files.map(({ sourceRelative, targetRelative, bytes, sha256 }) => ({ source_relative_path: sourceRelative, path: targetRelative, bytes: bytes.length, sha256 })),
};
const canonical = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(path.join(outputRoot, "manifest.json"), canonical);
const bundleSha256 = hash(Buffer.from(canonical));
await writeFile(path.join(outputRoot, "bundle.sha256"), `${bundleSha256}  manifest.json\n`);
process.stdout.write(`${JSON.stringify({ bundleVersion, outputRoot, bundleSha256, files: files.length })}\n`);
