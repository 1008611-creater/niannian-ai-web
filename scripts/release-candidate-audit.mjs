#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { isExcludedReleaseDirectory, isExcludedReleaseFile, releaseCandidate } from "./release-candidate-config.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const { releaseId } = releaseCandidate;
const releaseRoot = path.join(projectRoot, "release-candidates", releaseId);
const windowsMimoPackageName = `niannian-windows-mimo-agent-${releaseCandidate.windowsMimoWorkerVersion}`;
const excludedExtensions = new Set([".log", ".zip", ".tgz", ".gz", ".tmp", ".tsbuildinfo"]);
const allowedDotEnvFiles = new Set([".env.example", ".env.docker.example"]);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function excluded(relativePath) {
  if (isExcludedReleaseFile(relativePath)) return true;
  const parts = relativePath.split("/");
  if (parts.some(isExcludedReleaseDirectory)) return true;
  const name = parts.at(-1) || "";
  if (name === ".postgres-password.local" || name.startsWith("server-") || name.startsWith("real-mimo-test")) return true;
  if (name.startsWith(".env") && !allowedDotEnvFiles.has(name)) return true;
  return excludedExtensions.has(path.extname(name).toLowerCase());
}

async function sourceFiles(directory = projectRoot, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excluded(relative)) continue;
    if (entry.isDirectory()) found.push(...await sourceFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort();
}

async function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${executable} failed: ${stderr}`)));
  });
}

const manifest = JSON.parse(await readFile(path.join(releaseRoot, "release-manifest.json"), "utf8"));
if (manifest.releaseId !== releaseId || manifest.status !== "deploy_ready_candidate") throw new Error("RELEASE_IDENTITY_INVALID");
if (
  manifest.versions.website !== releaseCandidate.releaseVersion
  || manifest.versions.macWorker !== releaseCandidate.macWorkerVersion
  || manifest.versions.skillBundle !== releaseCandidate.skillBundleVersion
  || manifest.versions.windowsMimoWorker !== releaseCandidate.windowsMimoWorkerVersion
  || manifest.versions.referenceContract !== releaseCandidate.referenceContractVersion
) throw new Error("RELEASE_VERSION_INVALID");
const currentSourceFiles = await sourceFiles();
const manifestSourceFiles = Object.keys(manifest.sourceFiles || {}).sort();
if (JSON.stringify(currentSourceFiles) !== JSON.stringify(manifestSourceFiles)) throw new Error("RELEASE_SOURCE_FILE_SET_CHANGED");
const currentSourceHashes = [];
for (const relative of currentSourceFiles) {
  const currentHash = hash(await readFile(path.join(projectRoot, ...relative.split("/"))));
  if (currentHash !== manifest.sourceFiles[relative]) throw new Error(`RELEASE_SOURCE_FILE_CHANGED:${relative}`);
  currentSourceHashes.push([relative, currentHash]);
}
if (hash(JSON.stringify(currentSourceHashes)) !== manifest.sourceTreeSha256) throw new Error("RELEASE_SOURCE_TREE_HASH_MISMATCH");
for (const [name, expected] of Object.entries(manifest.artifacts)) {
  const bytes = await readFile(path.join(releaseRoot, name));
  if (hash(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error(`RELEASE_ARTIFACT_HASH_MISMATCH:${name}`);
}
for (const [relative, expected] of Object.entries(manifest.criticalSourceHashes)) {
  if (hash(await readFile(path.join(projectRoot, ...relative.split("/")))) !== expected) throw new Error(`CRITICAL_SOURCE_CHANGED:${relative}`);
}
const websiteArchive = path.join(releaseRoot, `${releaseId}-website-source.tar.gz`);
const entries = String(await command("tar", ["-tzf", websiteArchive])).split(/\r?\n/).filter(Boolean);
const forbidden = entries.filter((entry) => /(^|\/)(\.env(?!\.example|\.docker\.example)|\.codex_tmp|data|node_modules|\.next(?:-preview-[^/]*)?|output|release-candidates|runtime)(\/|$)|\.log$|\.tsbuildinfo$/i.test(entry));
if (forbidden.length) throw new Error(`FORBIDDEN_RELEASE_ENTRY:${forbidden[0]}`);
for (const required of [
  "site-source/RELEASE_IDENTITY.json",
  `site-source/${releaseCandidate.authorizationPackage}`,
  `site-source/${releaseCandidate.runbook}`,
  "site-source/deploy/migrations/20260713_asset_reference_metadata.sql",
  "site-source/deploy/migrations/20260728_asset_library_visibility.sql",
  "site-source/mac-agent/niannian-mac-worker.mjs",
  "site-source/mac-agent/backup-before-upgrade.sh",
  "site-source/mac-agent/rollback-macos.sh",
  "site-source/mac-agent/skill-bundle/bundle-manifest.json",
  "site-source/scripts/niannian-windows-mimo-agent.mjs",
  "site-source/scripts/Start-NiannianMimoAgent.ps1",
  "site-source/scripts/Install-NiannianMimoAgentTask.ps1",
  "site-source/windows-mimo-agent/mimo-chrome-cdp.mjs",
  "site-source/windows-mimo-agent/mimo-chrome-cdp-submit.mjs",
  "site-source/windows-mimo-agent/mimo-chrome-cdp-sync.mjs",
  "site-source/scripts/production-compat-readonly.mjs",
  "site-source/scripts/postdeploy-readonly-check.mjs",
]) if (!entries.includes(required)) throw new Error(`REQUIRED_RELEASE_ENTRY_MISSING:${required}`);
const windowsMimoArchive = `${windowsMimoPackageName}.tar.gz`;
if (!manifest.artifacts?.[windowsMimoArchive]) throw new Error("WINDOWS_MIMO_AGENT_ARTIFACT_MISSING");
const windowsMimoEntries = String(await command("tar", ["-tzf", path.join(releaseRoot, windowsMimoArchive)])).split(/\r?\n/).filter(Boolean);
for (const required of [
  `${windowsMimoPackageName}/manifest.json`,
  `${windowsMimoPackageName}/scripts/niannian-windows-mimo-agent.mjs`,
  `${windowsMimoPackageName}/scripts/Start-NiannianMimoAgent.ps1`,
  `${windowsMimoPackageName}/scripts/Install-NiannianMimoAgentTask.ps1`,
  `${windowsMimoPackageName}/scripts/Start-NiannianMimoBrowser.ps1`,
  `${windowsMimoPackageName}/scripts/Set-NiannianMimoCredential.ps1`,
  `${windowsMimoPackageName}/windows-mimo-agent/mimo-chrome-cdp-submit.mjs`,
  `${windowsMimoPackageName}/windows-mimo-agent/mimo-chrome-cdp-sync.mjs`,
]) if (!windowsMimoEntries.includes(required)) throw new Error(`WINDOWS_MIMO_AGENT_ENTRY_MISSING:${required}`);
const windowsMimoManifest = JSON.parse(await command("tar", ["-xOf", path.join(releaseRoot, windowsMimoArchive), `${windowsMimoPackageName}/manifest.json`]));
if (
  windowsMimoManifest.version !== releaseCandidate.windowsMimoWorkerVersion
  || windowsMimoManifest.executionMode !== "codex_skill"
  || windowsMimoManifest.channel !== "mimo"
  || windowsMimoManifest.providerSubmitAuthorized !== false
) throw new Error("WINDOWS_MIMO_AGENT_MANIFEST_INVALID");

const migration = await readFile(path.join(projectRoot, "deploy", "migrations", "20260713_asset_reference_metadata.sql"), "utf8");
const migrationStatements = migration.replace(/^\s*--.*$/gm, "");
if (
  !/CREATE TABLE IF NOT EXISTS asset_reference_metadata/i.test(migrationStatements)
  || /(^|;)\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE|ALTER|INSERT)\b/i.test(migrationStatements)
) throw new Error("DATABASE_MIGRATION_NOT_ADDITIVE");
const visibilityMigration = await readFile(path.join(projectRoot, "deploy", "migrations", "20260728_asset_library_visibility.sql"), "utf8");
const visibilityStatements = visibilityMigration.replace(/^\s*--.*$/gm, "");
if (
  !/CREATE TABLE IF NOT EXISTS asset_library_visibility/i.test(visibilityStatements)
  || !/ON DELETE RESTRICT/i.test(visibilityStatements)
  || /(^|;)\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE|ALTER|INSERT)\b/i.test(visibilityStatements)
) throw new Error("ASSET_VISIBILITY_MIGRATION_NOT_ADDITIVE");
const taskContract = await readFile(path.join(projectRoot, "lib", "video-tasks.ts"), "utf8");
const macContract = await readFile(path.join(projectRoot, "lib", "mac-codex-worker.ts"), "utf8");
if (!taskContract.includes('"image_to_video", "action_transfer", "reference_guided_video"')) throw new Error("LEGACY_GENERATION_TYPES_NOT_PRESERVED");
if (!macContract.includes('spec.generation_type === "image_to_video"') || !macContract.includes('spec.generation_type === "action_transfer"')) throw new Error("MAC_LEGACY_TASK_COMPATIBILITY_MISSING");
const installer = await readFile(path.join(projectRoot, "mac-agent", "install-macos.sh"), "utf8");
if (!installer.includes("run-loop") || !installer.includes("<key>KeepAlive</key>")) throw new Error("MAC_LAUNCHD_CONTINUITY_MISSING");
const compose = await readFile(path.join(projectRoot, "docker-compose.yml"), "utf8");
if (!compose.includes("niannian-postgres:/var/lib/postgresql/data") || !compose.includes("niannian-data:/app/data")) throw new Error("PRODUCTION_VOLUME_CONTRACT_CHANGED");
const authorization = await readFile(path.join(projectRoot, ...releaseCandidate.authorizationPackage.split("/")), "utf8");
for (const marker of ["不重建 PostgreSQL", "不删除 Docker 数据卷", "不提交 Mimo", "回滚网站", "恢复部署前 Worker 状态"]) {
  if (!authorization.includes(marker)) throw new Error(`ROLLBACK_AUTHORIZATION_MARKER_MISSING:${marker}`);
}
const runbook = await readFile(path.join(projectRoot, ...releaseCandidate.runbook.split("/")), "utf8");
for (const marker of ["approved_for_execution = 0", "running_on_mimo = 0", "15-60 秒", "Windows Worker", "不创建真实任务"]) {
  if (!runbook.includes(marker)) throw new Error(`RUNBOOK_MARKER_MISSING:${marker}`);
}

process.stdout.write(`${JSON.stringify({ ok: true, releaseId, artifacts: manifest.artifacts, entries: entries.length, windowsMimoEntries: windowsMimoEntries.length, forbiddenEntries: 0, migration: "additive", legacyCompatibility: true, rollbackContract: true })}\n`);
