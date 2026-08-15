#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const bundleRoot = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.join(bundleRoot, "skills");
const config = JSON.parse(await readFile(path.join(bundleRoot, "bundle.config.json"), "utf8"));
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collectFiles(directory, relativeBase = directory) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store" || entry.name === "__pycache__") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectFiles(absolute, relativeBase));
    else if (entry.isFile()) {
      const bytes = await readFile(absolute);
      output.push({
        path: path.relative(relativeBase, absolute).split(path.sep).join("/"),
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
    }
  }
  return output;
}

await mkdir(skillsRoot, { recursive: true });
for (const skill of config.requiredSkills) {
  const destination = path.join(skillsRoot, skill.name);
  if (skill.source === "codex_home") {
    const source = path.join(codexHome, "skills", skill.name);
    await readFile(path.join(source, "SKILL.md"), "utf8");
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, force: true });
  } else if (skill.source === "project") {
    await readFile(path.join(destination, "SKILL.md"), "utf8");
  } else {
    throw new Error(`UNSUPPORTED_SKILL_SOURCE:${skill.name}:${skill.source}`);
  }
}

const skillRecords = [];
for (const skill of config.requiredSkills) {
  const directory = path.join(skillsRoot, skill.name);
  const files = await collectFiles(directory);
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error(`SKILL_MD_MISSING:${skill.name}`);
  skillRecords.push({ name: skill.name, role: skill.role, files });
}

const manifest = {
  schemaVersion: 1,
  bundleName: config.bundleName,
  bundleVersion: config.bundleVersion,
  minimumWorkerVersion: config.minimumWorkerVersion,
  allowedChannels: config.allowedChannels,
  skills: skillRecords,
};
await writeFile(path.join(bundleRoot, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, bundleName: manifest.bundleName, bundleVersion: manifest.bundleVersion, skills: skillRecords.length, files: skillRecords.reduce((sum, skill) => sum + skill.files.length, 0) })}\n`);
