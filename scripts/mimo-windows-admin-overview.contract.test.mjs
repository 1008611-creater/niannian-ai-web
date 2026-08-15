import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("admin overview exposes the Windows Mimo worker as the current Mimo route", async () => {
  const [admin, page] = await Promise.all([
    readFile(path.join(root, "lib", "admin.ts"), "utf8"),
    readFile(path.join(root, "app", "admin", "page.tsx"), "utf8"),
  ]);
  assert.match(admin, /readMimoWorkerState/);
  assert.match(admin, /async function mimoWindowsWorkerStatus\(\)/);
  assert.match(admin, /mimoWindowsWorker,/);
  assert.match(admin, /modes: \["windows_skill", "legacy_mac"\]/);
  assert.match(page, /mimoWindowsWorker:/);
  assert.match(page, /Windows Mimo CDP 执行器/);
  assert.match(page, /新建渠道 M 任务只会由该 Windows Worker 领取/);
  assert.match(page, /Mac Codex 历史兼容执行器/);
  assert.match(page, /以上方 Windows Mimo CDP 执行器的生产预检为准/);
  assert.match(page, /Windows Mimo CDP 执行器"\}领取/);
  assert.doesNotMatch(page, /客户自动任务只会由该节点领取；Windows 和服务器执行器不会替代它/);
  assert.doesNotMatch(page, /客户是否能接单以上方 Mac 生产预检为准/);
  assert.doesNotMatch(page, /: " Mac 自动员工"/);
});
