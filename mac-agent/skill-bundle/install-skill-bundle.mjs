#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const selfRoot = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(option("--bundle-dir", selfRoot));
const codexHome = path.resolve(option("--codex-home", process.env.CODEX_HOME || path.join(os.homedir(), ".codex")));
const skillsRoot = path.join(codexHome, "skills");
const installedManifestPath = path.join(codexHome, "niannian-skill-bundle.json");
const manifestBytes = await readFile(path.join(bundleRoot, "bundle-manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));

if (manifest.schemaVersion !== 1 || manifest.bundleName !== "niannian-mac-production-skills" || !Array.isArray(manifest.skills) || !manifest.skills.length) {
  throw new Error("SKILL_BUNDLE_MANIFEST_INVALID");
}

for (const skill of manifest.skills) {
  if (!/^[a-z0-9-]{1,64}$/.test(skill.name) || !Array.isArray(skill.files) || !skill.files.length) throw new Error(`SKILL_RECORD_INVALID:${skill.name || "unknown"}`);
  for (const file of skill.files) {
    if (!file.path || path.isAbsolute(file.path) || file.path.split("/").includes("..")) throw new Error(`SKILL_FILE_PATH_INVALID:${skill.name}`);
    const bytes = await readFile(path.join(bundleRoot, "skills", skill.name, ...file.path.split("/")));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`SKILL_BUNDLE_HASH_MISMATCH:${skill.name}:${file.path}`);
  }
}

await mkdir(skillsRoot, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const stageRoot = path.join(codexHome, `.niannian-skill-stage-${process.pid}`);
const backupRoot = path.join(codexHome, "skill-bundle-backups", timestamp);
const installed = [];

try {
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  for (const skill of manifest.skills) {
    await cp(path.join(bundleRoot, "skills", skill.name), path.join(stageRoot, skill.name), { recursive: true, force: true });
  }
  for (const skill of manifest.skills) {
    const target = path.join(skillsRoot, skill.name);
    const backup = path.join(backupRoot, skill.name);
    let hadExisting = true;
    try { await access(target); } catch { hadExisting = false; }
    if (hadExisting) {
      await mkdir(path.dirname(backup), { recursive: true });
      await rename(target, backup);
    }
    await rename(path.join(stageRoot, skill.name), target);
    installed.push({ name: skill.name, target, backup: hadExisting ? backup : null });
  }
  const temporaryManifest = `${installedManifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryManifest, manifestBytes);
  await rename(temporaryManifest, installedManifestPath);
} catch (error) {
  for (const item of installed.reverse()) {
    await rm(item.target, { recursive: true, force: true }).catch(() => undefined);
    if (item.backup) await rename(item.backup, item.target).catch(() => undefined);
  }
  throw error;
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: true, bundleName: manifest.bundleName, bundleVersion: manifest.bundleVersion, installedSkills: installed.map((item) => item.name), manifest: installedManifestPath })}\n`);
