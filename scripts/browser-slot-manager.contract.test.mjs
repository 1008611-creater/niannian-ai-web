import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const manager = path.join(root, "scripts", "niannian-windows-browser-slot-manager.mjs");

test("browser slot manager isolates profiles and enforces one task per slot", async () => {
  const result = spawnSync(process.execPath, [manager, "contract-self-test"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BROWSER_SLOT_MANAGER_CONTRACT_SELF_TEST_PASS/);
  const source = await readFile(manager, "utf8");
  assert.match(source, /--user-data-dir=\$\{profile\}/);
  assert.match(source, /BROWSER_SLOT_ALREADY_LEASED/);
  assert.match(source, /BROWSER_SLOT_CAPACITY_BUSY/);
  assert.match(source, /ageMs > 120_000/);
  assert.match(source, /delete state\.sessions\[id\]/);
  assert.match(source, /\/json\/version/);
  assert.match(source, /\/json\/new/);
  assert.match(source, /activeTaskId/);
  assert.match(source, /NIANNIAN_BROWSER_SLOT_EXTENSION \?/);
  assert.match(source, /--proxy-server=/);
  assert.match(source, /BROWSER_SLOT_PROXY_INVALID/);
});
