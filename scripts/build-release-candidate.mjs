#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
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
const criticalFiles = [
  releaseCandidate.authorizationPackage,
  releaseCandidate.runbook,
  "scripts/release-candidate-config.mjs",
  "lib/release-version.ts",
  "lib/auth.ts",
  "lib/video-tasks.ts",
  "lib/mac-codex-worker.ts",
  "lib/mimo-windows-worker.ts",
  "app/api/health/route.ts",
  "app/api/assets/route.ts",
  "app/api/internal/mac-codex/status/route.ts",
  "app/home/page.tsx",
  "deploy/migrations/20260713_asset_reference_metadata.sql",
  "deploy/migrations/20260728_asset_library_visibility.sql",
  "docker-compose.yml",
  "mac-agent/niannian-mac-worker.mjs",
  "mac-agent/install-macos.sh",
  "mac-agent/deploy-existing-macos-hotfix.sh",
  "mac-agent/patch-mimo-origin-macos.sh",
  "mac-agent/backup-before-upgrade.sh",
  "mac-agent/rollback-macos.sh",
  "mac-agent/worker-result.schema.json",
  "mac-agent/skill-bundle/bundle.config.json",
  "mac-agent/skill-bundle/bundle-manifest.json",
  "scripts/production-compat-readonly.mjs",
  "scripts/postdeploy-readonly-check.mjs",
  "scripts/niannian-windows-mimo-agent.mjs",
  "scripts/Start-NiannianMimoAgent.ps1",
  "scripts/Install-NiannianMimoAgentTask.ps1",
  "scripts/build-windows-mimo-agent-candidate.mjs",
  "windows-mimo-agent/package.json",
  "windows-mimo-agent/package-lock.json",
  "windows-mimo-agent/mimo-chrome-cdp.mjs",
  "windows-mimo-agent/mimo-chrome-cdp-submit.mjs",
  "windows-mimo-agent/mimo-chrome-cdp-sync.mjs",
];

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

async function files(directory = projectRoot, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excluded(relative)) continue;
    if (entry.isDirectory()) found.push(...await files(path.join(directory, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort();
}

async function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr}`)));
  });
}

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), `${releaseId}-`));
try {
  await run(process.execPath, ["scripts/build-windows-mimo-agent-candidate.mjs"], projectRoot);
  const sourceRoot = path.join(temporary, "site-source");
  const sourceFiles = await files();
  for (const relative of sourceFiles) {
    const destination = path.join(sourceRoot, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(projectRoot, ...relative.split("/")), destination);
  }
  await writeFile(path.join(sourceRoot, "RELEASE_IDENTITY.json"), `${JSON.stringify({
    releaseId,
    releaseVersion: releaseCandidate.releaseVersion,
    referenceContractVersion: releaseCandidate.referenceContractVersion,
    databaseMigration: releaseCandidate.databaseMigration,
    macWorkerVersion: releaseCandidate.macWorkerVersion,
    skillBundleVersion: releaseCandidate.skillBundleVersion,
    windowsMimoWorkerVersion: releaseCandidate.windowsMimoWorkerVersion,
  }, null, 2)}\n`, "utf8");

  const websiteArchive = path.join(releaseRoot, `${releaseId}-website-source.tar.gz`);
  const macArchive = path.join(releaseRoot, `${releaseId}-mac-worker.tar.gz`);
  const windowsMimoArchive = path.join(releaseRoot, `${windowsMimoPackageName}.tar.gz`);
  await run("tar", ["-czf", websiteArchive, "-C", temporary, "site-source"], projectRoot);
  await run("tar", ["-czf", macArchive, "-C", sourceRoot, "mac-agent"], projectRoot);
  await cp(path.join(projectRoot, "output", windowsMimoPackageName, `${windowsMimoPackageName}.tar.gz`), windowsMimoArchive);

  const criticalSourceHashes = {};
  for (const relative of criticalFiles) criticalSourceHashes[relative] = hash(await readFile(path.join(projectRoot, ...relative.split("/"))));
  const sourceHashes = await Promise.all(sourceFiles.map(async (relative) => [relative, hash(await readFile(path.join(projectRoot, ...relative.split("/"))))]));
  const artifacts = {};
  for (const artifact of [websiteArchive, macArchive, windowsMimoArchive]) {
    const bytes = await readFile(artifact);
    artifacts[path.basename(artifact)] = { sha256: hash(bytes), bytes: (await stat(artifact)).size };
  }
  const manifest = {
    schemaVersion: 1,
    releaseId,
    status: "deploy_ready_candidate",
    createdAt: new Date().toISOString(),
    versions: {
      website: releaseCandidate.releaseVersion,
      referenceContract: releaseCandidate.referenceContractVersion,
      databaseMigration: releaseCandidate.databaseMigration,
      macWorker: releaseCandidate.macWorkerVersion,
      skillBundle: releaseCandidate.skillBundleVersion,
      windowsMimoWorker: releaseCandidate.windowsMimoWorkerVersion,
    },
    artifacts,
    sourceFileCount: sourceFiles.length + 1,
    sourceTreeSha256: hash(JSON.stringify(sourceHashes)),
    sourceFiles: Object.fromEntries(sourceHashes),
    criticalSourceHashes,
    dataContract: {
      databaseVolume: "niannian-ai-video-workbench_niannian-postgres",
      customerDataVolume: "niannian-ai-video-workbench_niannian-data",
      migration: "additive_create_tables_only; asset visibility rollback keeps rows and bytes and may leave the compatibility table in place",
      rollback: "keep_database_and_data_volumes; roll back application and Windows Mimo Agent binaries only; legacy Mac binaries remain unchanged",
    },
    authorization: {
      productionDeployAuthorized: false,
      macInstallAuthorized: false,
      windowsMimoInstallAuthorized: false,
      providerSubmitAuthorized: false,
      costAuthorized: false,
    },
  };
  await writeFile(path.join(releaseRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(releaseRoot, "SHA256SUMS.txt"),
    `${Object.entries(artifacts).map(([name, item]) => `${item.sha256}  ${name}`).join("\n")}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({ ok: true, releaseRoot, manifest })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
