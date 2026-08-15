import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { authenticateMimoPage } from "../windows-mimo-agent/mimo-chrome-cdp.mjs";

const root = path.resolve(import.meta.dirname, "..");
const mainSelector = '[contenteditable="true"][placeholder*="描述视频内容"], textarea[placeholder*="描述视频内容"]';

class FakePage {
  constructor({ generator = false, verification = false } = {}) {
    this.generator = generator;
    this.verification = verification;
    this.fills = [];
    this.clicked = false;
  }
  locator(selector) {
    const kind = selector === mainSelector ? "generator" : selector.includes("验证码") ? "verification" : selector.includes('button[type="submit"]') ? "submit" : selector.includes("password") || selector.includes("输入密码") ? "password" : "username";
    const page = this;
    return {
      first() { return this; },
      async isVisible() { return kind === "generator" ? page.generator : kind === "verification" ? page.verification : !page.generator; },
      async fill(value) { page.fills.push({ kind, value }); },
      async click() { if (kind !== "submit") throw new Error(`UNEXPECTED_CLICK:${kind}`); page.clicked = true; },
      waitFor() {
        if (kind === "generator") { page.generator = true; return Promise.resolve(); }
        return new Promise(() => {});
      },
    };
  }
  getByRole() {
    const page = this;
    return { first() { return this; }, async isVisible() { return true; }, async click() { page.clicked = true; } };
  }
}

function withCredential(username, password, callback) {
  const previousUsername = process.env.NIANNIAN_MIMO_USERNAME;
  const previousPassword = process.env.NIANNIAN_MIMO_PASSWORD;
  process.env.NIANNIAN_MIMO_USERNAME = username;
  process.env.NIANNIAN_MIMO_PASSWORD = password;
  return Promise.resolve(callback()).finally(() => {
    if (previousUsername === undefined) delete process.env.NIANNIAN_MIMO_USERNAME; else process.env.NIANNIAN_MIMO_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.NIANNIAN_MIMO_PASSWORD; else process.env.NIANNIAN_MIMO_PASSWORD = previousPassword;
  });
}

test("background login blocks without a configured credential before filling", async () => {
  delete process.env.NIANNIAN_MIMO_USERNAME;
  delete process.env.NIANNIAN_MIMO_PASSWORD;
  const page = new FakePage();
  assert.deepEqual(await authenticateMimoPage(page), { authenticated: false, blocker: "MIMO_CREDENTIAL_NOT_CONFIGURED" });
  assert.equal(page.fills.length, 0);
  assert.equal(page.clicked, false);
});

test("background login blocks on verification without submitting", async () => {
  await withCredential("account", "secret-value", async () => {
    const page = new FakePage({ verification: true });
    assert.deepEqual(await authenticateMimoPage(page), { authenticated: false, blocker: "MIMO_LOGIN_VERIFICATION_REQUIRED" });
    assert.equal(page.fills.length, 0);
    assert.equal(page.clicked, false);
  });
});

test("background login fills only the page and reports authenticated", async () => {
  await withCredential("account", "secret-value", async () => {
    const page = new FakePage();
    assert.deepEqual(await authenticateMimoPage(page), { authenticated: true, blocker: null });
    assert.deepEqual(page.fills, [{ kind: "username", value: "account" }, { kind: "password", value: "secret-value" }]);
    assert.equal(page.clicked, true);
  });
});

test("background login targets the form submit control instead of a login tab", async () => {
  const helper = await readFile(path.join(root, "windows-mimo-agent", "mimo-chrome-cdp.mjs"), "utf8");
  assert.match(helper, /form button\[type="submit"\], button\.submit-btn/);
  assert.doesNotMatch(helper, /getByRole\('button', \{ name: \/登录/);
});

test("credential enrollment accepts no username or password command-line parameter", async () => {
  const enrollment = await readFile(path.join(root, "scripts", "Set-NiannianMimoCredential.ps1"), "utf8");
  assert.match(enrollment, /Get-Credential/);
  assert.match(enrollment, /\[switch\]\$FromStdin/);
  assert.match(enrollment, /\[Console\]::In\.ReadToEnd\(\)/);
  assert.match(enrollment, /DataProtectionScope\]::LocalMachine/);
  assert.match(enrollment, /ProtectedData\]::Protect/);
  assert.match(enrollment, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.doesNotMatch(enrollment, /\[string\]\$Username|\[string\]\$Password/);
});
