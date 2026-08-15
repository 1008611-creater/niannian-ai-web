#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.env.CODEX_SKILLS_ROOT || "C:/Users/lsb/.codex/skills");
const bundleRoot = path.join(projectRoot, "..", "deliverables", "employee-redraw-video-skill-bundle-v1");
const templateRoot = path.join(projectRoot, "scripts", "employee-redraw-bundle");
const skills = [
  "ai-video-production-router",
  "ai-video-fundamentals-skill",
  "ai-video-firstframe-workflow",
  "ai-video-channel-router",
  "commerce-video-redraw-router",
  "realistic-commerce-video-replication",
  "prompt-skill-router",
  "image2-storyboard-video",
  "runninghub-image2-image",
  "seedance2-commerce-video",
  "mimo-8001-video-channel",
];

const excludedNames = new Set([".env"]);
const excludedFragments = ["__pycache__", ".pyc"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function walk(dir, relative = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (excludedNames.has(entry.name) || excludedFragments.some((part) => entryRelative.includes(part))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full, entryRelative));
    else files.push({ full, relative: entryRelative.replaceAll("\\", "/") });
  }
  return files;
}

await rm(bundleRoot, { recursive: true, force: true });
await cp(templateRoot, bundleRoot, { recursive: true });
await mkdir(path.join(bundleRoot, "skills"), { recursive: true });
const manifestFiles = [];
for (const skill of skills) {
  const sourceDir = path.join(sourceRoot, skill);
  const sourceFiles = await walk(sourceDir);
  if (!sourceFiles.some((file) => file.relative === "SKILL.md")) throw new Error(`MISSING_SKILL:${skill}`);
  for (const file of sourceFiles) {
    const targetRelative = path.posix.join("skills", skill, file.relative);
    const target = path.join(bundleRoot, ...targetRelative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(file.full);
    if (/RUNNINGHUB_API_KEY\s*=|AUTHORIZATION:\s*BEARER\s+[A-Za-z0-9_-]{20,}/i.test(bytes.toString("utf8"))) {
      throw new Error(`SECRET_RISK:${skill}/${file.relative}`);
    }
    await writeFile(target, bytes);
    manifestFiles.push({ path: targetRelative, bytes: bytes.length, sha256: sha256(bytes) });
  }
}

const manifest = {
  schema_version: "employee_redraw_video_skill_bundle_v1",
  bundle_version: "employee-redraw-video-skill-bundle-v1",
  runtime_kind: "commerce_video_redraw",
  skills,
  install_target: "%USERPROFILE%/.codex/skills",
  execution_contract: "Step01 -> Step02 -> Step03 -> Step04 -> Step05",
  default_output_language: "zh-CN",
  real_submit_requires_explicit_authorization: true,
  local_pixel_edit_requires_exact_current_task_authorization: true,
  prohibited_secrets: ["RUNNINGHUB_API_KEY", "provider tokens", "cookies", "OTP codes"],
  files: manifestFiles,
};
const canonical = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(path.join(bundleRoot, "manifest.json"), canonical, "utf8");
await writeFile(path.join(bundleRoot, "bundle.sha256"), `${sha256(Buffer.from(canonical))}  manifest.json\n`, "utf8");
process.stdout.write(JSON.stringify({ bundleRoot, skills: skills.length, files: manifestFiles.length }) + "\n");
