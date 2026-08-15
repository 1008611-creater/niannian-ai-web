#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.env.REDRAW_HARNESS_SOURCE_ROOT || "D:/codex-work/zhuanhui");
const templateRoot = path.join(projectRoot, "scripts", "redraw-harness-bundle");
const outputRoot = path.join(projectRoot, "..", "deliverables", "employee-redraw-project-harness-v1");

const sourceFiles = [
  "07_PROJECT_DOCS/workflow-contract.md",
  "07_PROJECT_DOCS/redraw-router-v2-decision-kernel.md",
  "07_PROJECT_DOCS/redraw-routing-contracts.md",
  "07_PROJECT_DOCS/factory-overlay-contract.md",
  "07_PROJECT_DOCS/redraw-ai-image-video-bridge-contract.md",
  "07_PROJECT_DOCS/acceptance-and-versioning.md",
  "08_TEMPLATES/artifact_ledger.schema.json",
  "08_TEMPLATES/gate_dashboard.template.json",
  "08_TEMPLATES/node_contracts.factory_overlay.template.json",
  "08_TEMPLATES/production_graph.factory_overlay.template.json",
  "08_TEMPLATES/redraw_router_v2.schema.json",
  "08_TEMPLATES/redraw_routing_contracts.schema.json",
  "08_TEMPLATES/route_decision.template.json",
  "08_TEMPLATES/shot_quality_vector.template.json",
  "08_TEMPLATES/step01_evidence_manifest.template.json",
  "08_TEMPLATES/step02_handoff.template.json",
  "08_TEMPLATES/step04_compiled_contract.template.json",
  "08_TEMPLATES/step05_execution_manifest.template.json",
  "08_TEMPLATES/video_channel_capabilities.template.json",
  "08_TEMPLATES/video_task_spec.template.json",
  "08_TEMPLATES/workspace_transaction.template.yaml",
  "tools/compute_redraw_route_decision.js",
  "tools/test_compute_redraw_route_decision.js",
  "tools/verify_redraw_routing_contracts.js",
  "tools/test_redraw_routing_contracts.js",
  "tools/verify_redraw_factory_overlay.js",
  "tools/zhuanhui_artifact_ledger.js",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const secretPatterns = [
  /RUNNINGHUB_API_KEY\s*=\s*[^\s<][^\r\n]{12,}/i,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["'][A-Za-z0-9._-]{20,}["']/i,
];

await rm(outputRoot, { recursive: true, force: true });
await cp(templateRoot, outputRoot, { recursive: true });

const records = [];
for (const relative of sourceFiles) {
  const source = path.join(sourceRoot, ...relative.split("/"));
  const target = path.join(outputRoot, ...relative.split("/"));
  const bytes = await readFile(source);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function collect(dir, relative = "") {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    const childRelative = path.join(relative, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) files.push(...await collect(child, childRelative));
    else if (!new Set(["MANIFEST.json", "SHA256SUMS.txt"]).has(entry.name)) files.push({ child, childRelative });
  }
  return files;
}

const packagedFiles = await collect(outputRoot);
const secretHits = [];
for (const file of packagedFiles) {
  const bytes = await readFile(file.child);
  const text = bytes.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) secretHits.push(file.childRelative);
  records.push({ path: file.childRelative, bytes: bytes.length, sha256: sha256(bytes) });
}
if (secretHits.length) throw new Error(`HARNESS_SECRET_RISK:${secretHits.join(",")}`);

records.sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  schema_version: "employee_redraw_project_harness_v1",
  bundle_version: "employee-redraw-project-harness-v1",
  route_kind: "commercial_video_redraw",
  route_kernel: "router-v2-shadow.1",
  companion_skill_bundle: "employee-redraw-video-skill-bundle-v1.zip",
  entrypoint: "tools/init_redraw_project_harness.js",
  route_decision_tool: "tools/compute_redraw_route_decision.js",
  provider_submit_default: false,
  package_send_default: false,
  local_image_edit_default: false,
  files: records,
};
await writeFile(path.join(outputRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${records.map((item) => `${item.sha256}  ${item.path}`).join("\n")}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputRoot, files: records.length, secretHits: secretHits.length })}\n`);
