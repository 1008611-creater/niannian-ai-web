import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const currentOrigin = "https://fd.aancn.cn";
const historicalOrigins = [
  "https://ai" + ".mimo.fashion",
  "http://nas" + ".mimo.fashion:8001",
];

// This list is intentionally explicit: historical evidence and frozen release
// candidates are not current execution inputs and must retain their facts.
const currentExecutionFiles = [
  ".env.example",
  ".env.docker.example",
  "docker-compose.yml",
  "lib/mimo-readiness.ts",
  "scripts/mimo-direct.mjs",
  "scripts/run-real-mimo-app-task.mjs",
  "mac-agent/niannian-mac-worker.mjs",
  "mac-agent/install-macos.sh",
  "mac-agent/patch-mimo-origin-macos.sh",
  "mac-agent/prepare-mimo-safari-session.mjs",
  "mac-agent/mimo-safari-visible-submit.mjs",
  "mac-agent/mimo-safari-visible-sync.mjs",
  "mac-agent/mimo-safari-ui-diagnostic.mjs",
  "mac-agent/skill-bundle/skills/mimo-8001-video-channel/SKILL.md",
  "mac-agent/skill-bundle/skills/mimo-8001-video-channel/scripts/mimo_client.mjs",
];

const read = (relative) => readFile(path.join(root, ...relative.split("/")), "utf8");

test("all current Mimo execution paths use the migrated origin", async () => {
  for (const relative of currentExecutionFiles) {
    const source = await read(relative);
    assert.ok(source.includes(currentOrigin), `${relative} must contain ${currentOrigin}`);
    for (const historicalOrigin of historicalOrigins) {
      assert.ok(!source.includes(historicalOrigin), `${relative} still routes to historical origin ${historicalOrigin}`);
    }
  }
});

test("runtime defaults preserve one explicit MIMO_BASE_URL override contract", async () => {
  for (const relative of [
    "lib/mimo-readiness.ts",
    "scripts/mimo-direct.mjs",
    "mac-agent/niannian-mac-worker.mjs",
    "mac-agent/install-macos.sh",
    "mac-agent/patch-mimo-origin-macos.sh",
    "mac-agent/prepare-mimo-safari-session.mjs",
    "mac-agent/mimo-safari-visible-submit.mjs",
    "mac-agent/mimo-safari-visible-sync.mjs",
    "mac-agent/mimo-safari-ui-diagnostic.mjs",
  ]) {
    assert.match(await read(relative), /MIMO_BASE_URL/, `${relative} must honor MIMO_BASE_URL`);
  }
});

test("Safari sync forwards the selected origin to session preparation and proxy download", async () => {
  const source = await read("mac-agent/mimo-safari-visible-sync.mjs");
  assert.match(source, /"--url", new URL\("\/", config\.mimoBase\)\.toString\(\)/);
  assert.match(source, /new URL\(`\/api\/video\/proxy-video\?token=\$\{encodeURIComponent\(proxyToken\)\}`, config\.mimoBase\)/);
});

test("existing Mac upgrades patch the wrapper and diagnostics run the shipped source", async () => {
  const hotfix = await read("mac-agent/deploy-existing-macos-hotfix.sh");
  const diagnosticRunner = await read("mac-agent/run-mimo-safari-diagnostic.zsh");
  assert.match(hotfix, /\/bin\/zsh "\$SOURCE_DIR\/patch-mimo-origin-macos\.sh"/);
  assert.match(diagnosticRunner, /"\$NODE_BIN" "\$SOURCE_DIR\/mimo-safari-ui-diagnostic\.mjs"/);
  assert.doesNotMatch(diagnosticRunner, /\.niannian-deploy\/\d/);
});
