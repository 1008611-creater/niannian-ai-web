import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const bundleDirectory = path.join(projectDirectory, "mac-agent", "skill-bundle");
const installer = path.join(bundleDirectory, "install-skill-bundle.mjs");

function runInstaller(bundle, codexHome, expectSuccess = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [installer, "--bundle-dir", bundle, "--codex-home", codexHome], {
      cwd: projectDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code === 0) !== expectSuccess) return reject(new Error(`unexpected installer exit ${code}: ${stderr}`));
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

test("versioned Mac Skill bundle installs all required Skills and manifest", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "niannian-skill-install-"));
  try {
    const result = JSON.parse((await runInstaller(bundleDirectory, codexHome)).stdout);
    assert.equal(result.bundleName, "niannian-mac-production-skills");
    assert.equal(result.bundleVersion, "1.2.8");
    assert.equal(result.installedSkills.length, 6);
    const installedManifest = JSON.parse(await readFile(path.join(codexHome, "niannian-skill-bundle.json"), "utf8"));
    for (const skill of installedManifest.skills) {
      assert.match(await readFile(path.join(codexHome, "skills", skill.name, "SKILL.md"), "utf8"), /^---/);
    }
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("Mac Skill bundle rejects a tampered file before changing Codex Skills", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-skill-tamper-"));
  const copiedBundle = path.join(temporary, "bundle");
  const codexHome = path.join(temporary, "codex-home");
  try {
    await cp(bundleDirectory, copiedBundle, { recursive: true });
    const target = path.join(copiedBundle, "skills", "niannian-mac-production", "SKILL.md");
    await writeFile(target, `${await readFile(target, "utf8")}\nTAMPERED\n`, "utf8");
    const result = await runInstaller(copiedBundle, codexHome, false);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /SKILL_BUNDLE_HASH_MISMATCH/);
    await assert.rejects(readFile(path.join(codexHome, "niannian-skill-bundle.json"), "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
