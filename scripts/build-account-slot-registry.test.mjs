import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import xlsx from "xlsx";

test("account matrix registry excludes credentials and preserves channel slots", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "niannian-account-slots-"));
  const source = path.join(directory, "accounts.xlsx");
  const target = path.join(directory, "registry.json");
  const sheet = xlsx.utils.aoa_to_sheet([["账号", "密码", "辅助邮箱", "AStorie", "Dola"], ["owner@example.com", "secret", "recovery@example.com", "yes", ""]]);
  const workbook = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(workbook, sheet, "账号表"); xlsx.writeFile(workbook, source);
  const result = spawnSync(process.execPath, ["scripts/build-account-slot-registry.mjs", source, target], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const registry = JSON.parse(await readFile(target, "utf8"));
  const serialized = JSON.stringify(registry);
  assert.equal(registry.slots.length, 1);
  assert.deepEqual(registry.slots[0].enabledChannels, ["AStorie"]);
  assert.match(registry.slots[0].accountFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(serialized, /owner@example\.com|secret|recovery@example\.com/);
});
