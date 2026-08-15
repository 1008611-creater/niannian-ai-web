#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const version = "1.4.13-windows-mimo.3";
const packageName = `niannian-windows-mimo-agent-${version}`;
const outputRoot = path.join(projectRoot, "output", packageName);
const files = [
  { source: "scripts/niannian-windows-mimo-agent.mjs", target: "scripts/niannian-windows-mimo-agent.mjs" },
  { source: "scripts/Start-NiannianMimoAgent.ps1", target: "scripts/Start-NiannianMimoAgent.ps1" },
  { source: "scripts/Install-NiannianMimoAgentTask.ps1", target: "scripts/Install-NiannianMimoAgentTask.ps1" },
  { source: "scripts/Start-NiannianMimoBrowser.ps1", target: "scripts/Start-NiannianMimoBrowser.ps1" },
  { source: "scripts/Set-NiannianMimoCredential.ps1", target: "scripts/Set-NiannianMimoCredential.ps1" },
  { source: "windows-mimo-agent/package.json", target: "windows-mimo-agent/package.json" },
  { source: "windows-mimo-agent/package-lock.json", target: "windows-mimo-agent/package-lock.json" },
  { source: "windows-mimo-agent/mimo-chrome-cdp.mjs", target: "windows-mimo-agent/mimo-chrome-cdp.mjs" },
  { source: "windows-mimo-agent/mimo-chrome-cdp-submit.mjs", target: "windows-mimo-agent/mimo-chrome-cdp-submit.mjs" },
  { source: "windows-mimo-agent/mimo-chrome-cdp-sync.mjs", target: "windows-mimo-agent/mimo-chrome-cdp-sync.mjs" },
  { source: "windows-mimo-agent/mimo-media-gates.mjs", target: "windows-mimo-agent/mimo-media-gates.mjs" },
  { source: "windows-mimo-agent/mimo-visible-settings.mjs", target: "windows-mimo-agent/mimo-visible-settings.mjs" },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr}`)));
  });
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), `${packageName}-`));
try {
  const root = path.join(temporary, packageName);
  for (const file of files) {
    const target = path.join(root, ...file.target.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(projectRoot, ...file.source.split("/")), target);
  }
  const manifestFiles = {};
  for (const file of files) manifestFiles[file.target] = sha256(await readFile(path.join(root, ...file.target.split("/"))));
  await writeFile(path.join(root, "README.txt"), [
    "NianNian Windows Mimo CDP Agent candidate",
    `Version: ${version}`,
    "This package is not a production authorization and cannot submit a provider task by itself.",
    "Run npm ci inside windows-mimo-agent, configure the environment outside this package, then run the preflight command.",
    "The background browser binds CDP only to 127.0.0.1:9226 and uses an isolated profile.",
    "Enroll the Mimo account with Set-NiannianMimoCredential.ps1; the password is never accepted as a command-line argument.",
  ].join("\r\n") + "\r\n", "utf8");
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({ packageName, version, provider: "mimo", executionMode: "codex_skill", channel: "mimo", productionDeployAuthorized: false, providerSubmitAuthorized: false, files: manifestFiles }, null, 2)}\n`, "utf8");
  const archive = path.join(outputRoot, `${packageName}.tar.gz`);
  await run("tar", ["-czf", archive, "-C", temporary, packageName]);
  const archiveBytes = await readFile(archive);
  await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${sha256(archiveBytes)}  ${path.basename(archive)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, archive, bytes: (await stat(archive)).size, sha256: sha256(archiveBytes), files: files.length })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
