export const releaseCandidate = Object.freeze({
  releaseId: "niannian-mimo-efficiency-20260728-rc1",
  releaseVersion: "2026.07.28-mimo-efficiency-rc1",
  referenceContractVersion: 3,
  databaseMigration: "20260728_asset_library_visibility_v1",
  macWorkerVersion: "1.4.12",
  skillBundleVersion: "1.2.8",
  windowsMimoWorkerVersion: "1.4.13-windows-mimo.3",
  authorizationPackage: "RELEASE_AUTHORIZATION_PACKAGE_20260727_WINDOWS_MIMO_RC1.md",
  runbook: "deploy/RELEASE_RUNBOOK_1.4.13_WINDOWS_MIMO_RC1.md",
});

export const excludedReleaseDirectories = Object.freeze([
  ".codex_tmp",
  ".next",
  ".playwright-cli",
  ".postgres-data",
  "data",
  "node_modules",
  "output",
  "release-candidates",
  "runtime",
]);

export function isExcludedReleaseDirectory(name) {
  return excludedReleaseDirectories.includes(name) || name.startsWith(".next-preview-");
}

export const excludedReleaseEvidenceFiles = Object.freeze([
  "AUTOMATION_AI_4_MEMORY.md",
  "POST_CODING_REVIEW_MIMO_EFFICIENCY_REWORK_20260728.md",
  "docs/agent-team/mimo-efficiency-rework-worker-report-20260728.md",
]);

export function isExcludedReleaseFile(relativePath) {
  return excludedReleaseEvidenceFiles.includes(relativePath.replaceAll("\\", "/"));
}
