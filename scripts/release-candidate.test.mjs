import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { isExcludedReleaseDirectory, isExcludedReleaseFile, releaseCandidate } from "./release-candidate-config.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFile(path.join(root, ...relative.split("/")), "utf8");

test("release identity is consistent across website and post-deploy validation", async () => {
  const [identity, postdeploy] = await Promise.all([
    read("lib/release-version.ts"),
    read("scripts/postdeploy-readonly-check.mjs"),
  ]);
  for (const value of [releaseCandidate.releaseId, releaseCandidate.macWorkerVersion, releaseCandidate.skillBundleVersion, releaseCandidate.windowsMimoWorkerVersion]) {
    assert.match(identity, new RegExp(value.replaceAll(".", "\\.")));
  }
  assert.match(postdeploy, /import \{ releaseCandidate \} from "\.\/release-candidate-config\.mjs"/);
  assert.match(postdeploy, /releaseCandidate\.releaseId/);
  assert.match(postdeploy, /releaseCandidate\.macWorkerVersion/);
  assert.match(postdeploy, /releaseCandidate\.skillBundleVersion/);
  assert.match(postdeploy, /releaseCandidate\.windowsMimoWorkerVersion/);
});

test("release package excludes runtime data and secrets and includes rollback tooling", async () => {
  const builder = await read("scripts/build-release-candidate.mjs");
  assert.equal(isExcludedReleaseDirectory(".next-preview-3032"), true);
  assert.equal(isExcludedReleaseDirectory(".next-preview-review"), true);
  assert.equal(isExcludedReleaseDirectory(".next-preview"), false);
  assert.equal(isExcludedReleaseDirectory(".codex_tmp"), true);
  assert.equal(isExcludedReleaseDirectory("runtime"), true);
  assert.equal(isExcludedReleaseFile("AUTOMATION_AI_4_MEMORY.md"), true);
  assert.equal(isExcludedReleaseFile("POST_CODING_REVIEW_MIMO_EFFICIENCY_REWORK_20260728.md"), true);
  assert.equal(isExcludedReleaseFile("docs/agent-team/mimo-efficiency-rework-worker-report-20260728.md"), true);
  assert.match(builder, /name\.startsWith\("\.env"\)/);
  const audit = await read("scripts/release-candidate-audit.mjs");
  assert.match(audit, /\\\.codex_tmp/);
  assert.match(audit, /runtime/);
  const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  assert.doesNotMatch(dockerfile, /COPY --from=build \/app\/runtime/);
  assert.match(dockerfile, /RUN mkdir -p \.\/runtime/);
  assert.match(audit, /backup-before-upgrade\.sh/);
  assert.match(audit, /rollback-macos\.sh/);
});

test("current candidate advances evidence-only Mimo efficiency without mutating historical workers", async () => {
  assert.equal(releaseCandidate.releaseId, "niannian-mimo-efficiency-20260728-rc1");
  assert.equal(releaseCandidate.macWorkerVersion, "1.4.12");
  assert.equal(releaseCandidate.skillBundleVersion, "1.2.8");
  assert.equal(releaseCandidate.windowsMimoWorkerVersion, "1.4.13-windows-mimo.3");
  const builder = await read("scripts/build-release-candidate.mjs");
  assert.match(builder, /build-windows-mimo-agent-candidate\.mjs/);
  assert.match(builder, /windowsMimoWorkerVersion/);
  assert.match(builder, /Windows Mimo Agent binaries only/);
  const audit = await read("scripts/release-candidate-audit.mjs");
  assert.match(audit, /WINDOWS_MIMO_AGENT_MANIFEST_INVALID/);
});

test("asset visibility migration is additive and keeps uploaded assets immutable", async () => {
  const migration = (await read("deploy/migrations/20260728_asset_library_visibility.sql")).replace(/^\s*--.*$/gm, "");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_library_visibility/i);
  assert.match(migration, /ON DELETE RESTRICT/i);
  assert.doesNotMatch(migration, /(^|;)\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE|ALTER|INSERT)\b/i);
});

test("additive migration permits ON DELETE CASCADE but no destructive statement", async () => {
  const migration = (await read("deploy/migrations/20260713_asset_reference_metadata.sql")).replace(/^\s*--.*$/gm, "");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_reference_metadata/i);
  assert.match(migration, /ON DELETE CASCADE/i);
  assert.doesNotMatch(migration, /(^|;)\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE|ALTER|INSERT)\b/i);
});

test("compatibility and post-deploy checks are read-only with no claim or task creation", async () => {
  for (const file of ["scripts/production-compat-readonly.mjs", "scripts/postdeploy-readonly-check.mjs"]) {
    const source = await read(file);
    assert.doesNotMatch(source, /client\.query\(\s*[`\"']\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
    assert.doesNotMatch(source, /\/claim|video-tasks[^\n]*method:\s*[\"']POST/i);
  }
});

test("Mac backup and rollback preserve exact pre-upgrade presence state", async () => {
  const [backup, rollback] = await Promise.all([
    read("mac-agent/backup-before-upgrade.sh"),
    read("mac-agent/rollback-macos.sh"),
  ]);
  for (const marker of ["bin_present", "plist_present", "bundle_manifest_present", "skills_present"]) {
    assert.ok(backup.includes(marker));
    assert.ok(rollback.includes(marker));
  }
  assert.match(rollback, /rm -rf \"\$INSTALL_ROOT\/bin\"/);
  assert.match(rollback, /launchctl bootstrap/);
});

test("Mac rollback restores a simulated 1.3.0 installation without credentials", () => {
  const gitBash = "C:/Program Files/Git/bin/bash.exe";
  const useGitBash = process.platform === "win32" && existsSync(gitBash);
  const bashRoot = useGitBash
    ? root.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : root.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll("\\", "/");
  const result = useGitBash
    ? spawnSync(gitBash, ["-lc", `shasum(){ if [ "$1" = "-a" ]; then shift 2; fi; sha256sum "$@"; }; export -f shasum; bash '${bashRoot}/scripts/mac-rollback.fixture.sh'`], { cwd: root, encoding: "utf8" })
    : spawnSync("bash", [`${bashRoot}/scripts/mac-rollback.fixture.sh`], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
