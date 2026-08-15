import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = await readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp-sync.mjs"), "utf8");

test("Windows Mimo sync only reconciles visible frontend state", () => {
  assert.match(source, /visibleTask\(page, config\.taskId\)/);
  assert.match(source, /page\.waitForEvent\('download'/);
  assert.match(source, /VISIBLE_TASK_NOT_FOUND/);
  assert.doesNotMatch(source, /\/api\/video\/(batch-status|list|proxy-token|proxy-video)/);
  assert.doesNotMatch(source, /page\.evaluate\(async/);
  assert.match(source, /button\.mini-icon\[title="展开 历史记录"\]/);
  assert.match(source, /history\.evaluate\(\(node\) => node\.click\(\)\)/);
  assert.doesNotMatch(source, /history\.click\(\{ force: true \}\)/);
  assert.match(source, /page\.locator\('\.his-card'\)/);
});

test("Windows CDP helper resolves the candidate-local Playwright dependency", async () => {
  const helper = await readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp.mjs"), "utf8");
  assert.match(helper, /moduleDirectory/);
  assert.match(helper, /moduleDirectory, 'node_modules', 'playwright-core/);
  assert.match(helper, /node_modules', 'playwright-core/);
  assert.doesNotMatch(helper, /NIANNIAN_MAC_WORKSPACE/);
});

test("candidate package is limited to the Windows agent runtime", async () => {
  const builder = await readFile(path.join(root, "scripts", "build-windows-mimo-agent-candidate.mjs"), "utf8");
  assert.match(builder, /windows-mimo-agent\/package-lock\.json/);
  assert.doesNotMatch(builder, /\{ source: "package\.json"/);
  assert.doesNotMatch(builder, /\{ source: "package-lock\.json"/);
});

test("Windows agent uses the same token name as the server and installer", async () => {
  const [agent, server, starter, installer] = await Promise.all([
    readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8"),
    readFile(path.join(root, "lib", "mimo-windows-worker.ts"), "utf8"),
    readFile(path.join(root, "scripts", "Start-NiannianMimoAgent.ps1"), "utf8"),
    readFile(path.join(root, "scripts", "Install-NiannianMimoAgentTask.ps1"), "utf8"),
  ]);
  for (const sourcePart of [agent, server, starter, installer]) {
    assert.match(sourcePart, /MIMO_WINDOWS_AGENT_TOKEN/);
    assert.doesNotMatch(sourcePart, /NIANNIAN_MIMO_WINDOWS_AGENT_TOKEN/);
  }
  assert.match(installer, /EnvironmentTokenPresent/);
  assert.doesNotMatch(installer, /ArgumentsContainToken/);
});

test("Windows installer and browser no longer require an interactive desktop", async () => {
  const [installer, browser, starter] = await Promise.all([
    readFile(path.join(root, "scripts", "Install-NiannianMimoAgentTask.ps1"), "utf8"),
    readFile(path.join(root, "scripts", "Start-NiannianMimoBrowser.ps1"), "utf8"),
    readFile(path.join(root, "scripts", "Start-NiannianMimoAgent.ps1"), "utf8"),
  ]);
  assert.match(installer, /LogonType S4U/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/);
  assert.doesNotMatch(installer, /LogonType Interactive/);
  assert.match(browser, /--headless=new/);
  assert.match(browser, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(browser, /--remote-debugging-port=9226/);
  assert.match(browser, /MimoBrowserProfile/);
  assert.match(starter, /ProtectedData\]::Unprotect/);
  assert.match(starter, /DataProtectionScope\]::LocalMachine/);
  assert.doesNotMatch(starter, /-Password|--password/);
});

test("all Windows connect-over-CDP paths close only the client transport and never close the remote browser", async () => {
  const sources = await Promise.all([
    readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp.mjs"), "utf8"),
    readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp-submit.mjs"), "utf8"),
    readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp-sync.mjs"), "utf8"),
  ]);
  for (const sourcePart of sources) assert.doesNotMatch(sourcePart, /browser\.close\s*\(/);
  assert.match(sources[0], /cachedBrowser\?\.isConnected\(\)/);
  assert.match(sources[0], /once\('disconnected'/);
  assert.match(sources[0], /export function disconnectMimoCdp/);
  for (const sourcePart of sources.slice(1)) assert.match(sourcePart, /disconnectMimoCdp/);
  for (const sourcePart of sources.slice(1)) assert.match(sourcePart, /process\.exit\([01]\)/);
});

test("a written Provider receipt is recovered after a submit helper exit and remains sync-only", async () => {
  const agent = await readFile(path.join(root, "scripts", "niannian-windows-mimo-agent.mjs"), "utf8");
  assert.match(agent, /submitError = error/);
  assert.match(agent, /Provider receipt recovered after helper exit; syncing only\./);
  assert.match(agent, /providerTaskId = String\(receipt\.providerTaskId/);
});
