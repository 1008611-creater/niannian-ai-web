import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { probeVideoDuration } from "../lib/video-output-gate.mjs";
import { prepareMioraFaceLineReferences } from "./miora-face-line.mjs";

const DEFAULT_MIORA_BASE_URL = "https://miora.design/";
const DEFAULT_MIORA_CDP_URL = "http://127.0.0.1:9415";

function clean(value) {
  return String(value ?? "")
    .replace(/bearer\s+[a-zA-Z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(password|token|secret|cookie)=\S+/gi, "$1=[redacted]")
    .slice(0, 2000);
}

function baseUrl(env = process.env) {
  const parsed = new URL(String(env.MIORA_BASE_URL || DEFAULT_MIORA_BASE_URL).trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MIORA_BASE_URL_INVALID");
  return parsed;
}

function cdpUrl(env = process.env) {
  const parsed = new URL(String(env.MIORA_CDP_URL || DEFAULT_MIORA_CDP_URL).trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MIORA_CDP_URL_INVALID");
  return parsed.toString().replace(/\/$/, "");
}

export function mioraDirectConfigured(env = process.env) {
  return Boolean(String(env.MIORA_CDP_URL || DEFAULT_MIORA_CDP_URL).trim());
}

async function connectMioraPage(env = process.env) {
  const targetOrigin = baseUrl(env).origin;
  // A visible Chrome target can briefly be replaced while CDP reattaches.
  // Wait for a stable canvas target instead of handing a just-closed Page to
  // the sync path. Prefer the project canvas, where the native progress cache
  // lives, over a homepage tab.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const browser = await chromium.connectOverCDP(cdpUrl(env));
    let homepage = null;
    let selected = null;
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          const current = new URL(page.url());
          if (current.origin !== targetOrigin) continue;
          if (/\/file\//.test(current.pathname)) {
            selected = page;
            break;
          }
          homepage ??= page;
        } catch {
          // Continue scanning visible pages.
        }
      }
      if (selected) break;
    }
    selected ??= homepage;
    if (selected) {
      await selected.waitForTimeout(300).catch(() => undefined);
      if (!selected.isClosed()) return { browser, page: selected };
    }
    await disconnectMioraCdp(browser).catch(() => undefined);
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const browser = await chromium.connectOverCDP(cdpUrl(env));
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl(env).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  return { browser, page };
}

async function captureAuthenticatedApi(context, endpoints) {
  const expected = new Set(endpoints);
  const captured = new Map();
  const probe = await context.newPage();
  const observe = (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!expected.has(pathname)) return;
    response.text().then((text) => {
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = { text: text.slice(0, 4000) }; }
      captured.set(pathname, { ok: response.ok(), status: response.status(), payload });
    }).catch(() => undefined);
  };
  probe.on("response", observe);
  try {
    await probe.goto(baseUrl().toString(), { waitUntil: "networkidle", timeout: 45_000 }).catch(() => undefined);
    await probe.waitForTimeout(1_500);
  } finally {
    probe.off("response", observe);
    await probe.close().catch(() => undefined);
  }
  return captured;
}

function findCredit(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length <= 80) return value.trim();
  if (!value || typeof value !== "object") return null;
  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (/credit|quota|balance|point|积分|额度/i.test(key)) {
        const found = findCredit(item);
        if (found) return found;
      }
      if (item && typeof item === "object") queue.push(item);
    }
  }
  return null;
}

function hasAvailableCredits(value) {
  const normalized = String(value ?? "").replace(/,/g, "");
  const numeric = Number.parseFloat(normalized.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0;
}

async function preflight(page) {
  const captured = await captureAuthenticatedApi(page.context(), ["/api/ai/quota/credit", "/api/ai/cloud-agent/media-models"]);
  const credit = captured.get("/api/ai/quota/credit") ?? { ok: false, status: 0, payload: {} };
  const models = captured.get("/api/ai/cloud-agent/media-models") ?? { ok: false, status: 0, payload: {} };
  const modelText = JSON.stringify(models.payload ?? "").toLowerCase();
  return {
    authenticated: credit.ok && models.ok,
    credits: findCredit(credit.payload),
    modelAvailable: modelText.includes("seedance"),
    creditStatus: credit.status,
    modelStatus: models.status,
  };
}

async function verifySpec(task, spec) {
  if (spec.submit_allowed !== true || spec.cost_gate?.authorized !== true) throw new Error("MIORA_SUBMIT_NOT_AUTHORIZED");
  if (!Array.isArray(spec.allowed_channels) || !spec.allowed_channels.includes("miora")) throw new Error("MIORA_CHANNEL_NOT_ALLOWED");
  const prompt = String(spec.prompt ?? (await readFile(spec.prompt_path, "utf8"))).trim();
  if (!prompt) throw new Error("MIORA_PROMPT_EMPTY");
  if (createHash("sha256").update(prompt).digest("hex") !== spec.prompt_sha256) throw new Error("MIORA_PROMPT_HASH_MISMATCH");
  const references = Array.isArray(spec.references) ? spec.references.filter((reference) => reference.actual_video_input !== false && reference.upload_eligible === true) : [];
  if (!references.length) throw new Error("MIORA_REFERENCES_MISSING");
  for (const reference of references) {
    const bytes = await readFile(reference.path);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error("MIORA_REFERENCE_HASH_MISMATCH");
  }
  if (String(task.resolution || "").toUpperCase() !== "720P") throw new Error("MIORA_RESOLUTION_UNSUPPORTED");
  if (Number(task.duration_seconds) !== 15) throw new Error("MIORA_15S_TASK_REQUIRED");
  return { prompt, references };
}

async function captureProviderEvents(page) {
  const installRecorder = () => {
    if (window.__niannianMioraInstalled) return;
    window.__niannianMioraInstalled = true;
    window.__niannianMioraEvents = [];
    const keep = (kind, url, body) => {
      const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
      if (/workflow|task|generate|aisee|cloud-agent|video|media/i.test(String(url))) {
        window.__niannianMioraEvents.push({ kind, url: String(url), body: text.slice(0, 2000), at: new Date().toISOString() });
      }
    };
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = args[0]?.url || args[0];
      response.clone().text().then((text) => keep("fetch", url, text)).catch(() => undefined);
      return response;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__niannianMioraUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener("load", () => keep("xhr", this.__niannianMioraUrl, this.responseText));
      return originalSend.apply(this, args);
    };
  };
  // `addInitScript` applies after a navigation.  Method 13 deliberately
  // reuses an already-open canvas when possible, so also install on the live
  // page now.  Without this immediate installation the first submission can
  // succeed while its same-task progress response is never observed.
  await page.addInitScript(installRecorder);
  await page.evaluate(installRecorder);
}

async function disconnectMioraCdp(browser) {
  // `browser.close()` sends Browser.close to a browser reached through CDP.
  // That can close the user's visible Chrome target, making a later same-ID
  // sync fail with cdp_target_closed.  Close only this Playwright transport;
  // do not close the user-owned browser or any of its tabs.
  const connection = browser?._connection;
  if (connection && typeof connection.close === "function") {
    connection.close();
  }
}

async function configureVisibleParameters(page) {
  const expected = ["Seedance 2.0", "720P", "15s"];
  for (const label of expected) {
    const exact = page.getByText(label, { exact: true }).first();
    if (await exact.count()) await exact.click({ timeout: 5_000 }).catch(() => undefined);
  }
  const visible = await page.locator("body").innerText({ timeout: 8_000 });
  const missing = expected.filter((label) => !visible.includes(label));
  if (missing.length) throw new Error(`MIORA_PARAMETER_READBACK_MISSING:${missing.join(",")}`);
}

async function clickFirstVisible(page, candidates, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      try {
        const locator = typeof candidate === "function" ? candidate(page) : page.locator(candidate);
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < Math.min(count, 6); index += 1) {
          const item = locator.nth(index);
          if (await item.isVisible({ timeout: 500 }).catch(() => false)) {
            await item.click({ timeout: 2_000 });
            return true;
          }
        }
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(250);
  }
  if (lastError) throw lastError;
  return false;
}

async function fillFirstVisible(page, candidates, value, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      try {
        const locator = typeof candidate === "function" ? candidate(page) : page.locator(candidate);
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < Math.min(count, 6); index += 1) {
          const item = locator.nth(index);
          if (!(await item.isVisible({ timeout: 500 }).catch(() => false))) continue;
          await item.fill(value, { timeout: 2_000 }).catch(async () => {
            await item.click({ timeout: 2_000 });
            await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
            await page.keyboard.type(value);
          });
          return true;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(250);
  }
  if (lastError) throw lastError;
  return false;
}

async function enterCanvas(page) {
  // A resumed attempt may already be sitting in the visible Method 13 canvas.
  // Reusing that canvas avoids creating another empty project before any
  // provider submission has happened.
  try {
    const current = new URL(page.url());
    if (current.origin === baseUrl().origin && /\/file\//.test(current.pathname)) {
      const existingCanvasText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
      if (/未命名项目|Page\s*1|视频生成器|生成视频/i.test(existingCanvasText)) return;
    }
  } catch {
    // Fall through to the documented homepage -> Agent short-word route.
  }
  await page.goto(baseUrl().toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  const body = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
  if (/Sign in|登录|登陆/i.test(body) && !/Credits|积分|未命名项目|Page\s*1/i.test(body)) throw new Error("MIORA_AUTHENTICATION_REQUIRED");
  if (/未命名项目|Page\s*1|新建对话|视频生成器|生成视频/i.test(body)) return;

  const entered = await fillFirstVisible(page, [
    'textarea[placeholder*="想法"]',
    'textarea[placeholder*="Describe"]',
    '[contenteditable="true"]',
    "textarea",
    'input[type="text"]',
  ], "你好", 8_000);
  if (!entered) throw new Error("MIORA_CANVAS_ENTRY_INPUT_NOT_FOUND");

  const submitted = await clickFirstVisible(page, [
    (p) => p.getByRole("button", { name: /Submit prompt|Send|提交|发送|创作|开始/i }),
    'button[aria-label*="Submit"]',
    'button[aria-label*="Send"]',
    "button",
  ], 8_000);
  if (!submitted) throw new Error("MIORA_CANVAS_ENTRY_SUBMIT_NOT_FOUND");

  await Promise.race([
    page.waitForURL(/\/file\//, { timeout: 45_000 }).catch(() => undefined),
    page.getByText(/未命名项目|Page\s*1|视频生成器|生成视频/i).first().waitFor({ timeout: 45_000 }).catch(() => undefined),
  ]);
  const canvasText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
  if (!/未命名项目|Page\s*1|视频生成器|生成视频/i.test(canvasText) && !/\/file\//.test(page.url())) {
    throw new Error("MIORA_CANVAS_ENTRY_NOT_CONFIRMED");
  }
}

async function openVideoModule(page) {
  const existing = page.locator('[data-testid="portal-generator-dialog"]');
  if (await existing.count() === 1 && await existing.isVisible().catch(() => false)) return;
  const opened = await clickFirstVisible(page, [
    '[aria-label="视频容器"]',
    // The live canvas currently renders the keyboard shortcut alongside the
    // accessible name (for example `视频容器 S`).  Keep the exact selector
    // for older builds, but accept that verified prefix so Method 13 does not
    // stop before opening the module.
    '[aria-label^="视频容器"]',
    (p) => p.getByRole("button", { name: /^视频容器$/ }),
    (p) => p.getByText(/^视频容器$/),
  ], 12_000);
  if (!opened) throw new Error("MIORA_VIDEO_MODULE_BUTTON_NOT_FOUND");
  await page.locator('[data-testid="portal-generator-dialog"]').waitFor({ state: "visible", timeout: 20_000 });
}

async function generatorDialog(page) {
  const dialogs = page.locator('[data-testid="portal-generator-dialog"]');
  const count = await dialogs.count();
  if (count !== 1) throw new Error(count ? "MIORA_GENERATOR_DIALOG_AMBIGUOUS" : "MIORA_GENERATOR_DIALOG_NOT_FOUND");
  return dialogs;
}

async function openCanvasParameterMenu(page, dialog) {
  // Method 13's current canvas renders model and video parameters separately.
  // The parameter popover is portalled outside the generator dialog, so a
  // dialog-only text lookup cannot see `参考`, 15s, or 720p.
  const menu = page.locator('[role="menu"]').filter({ hasText: "生成方式" });
  if (await menu.count() && await menu.first().isVisible().catch(() => false)) return menu.first();
  const trigger = dialog.locator('[aria-haspopup="menu"]').filter({ hasText: /首尾帧|参考|16:9|9:16|720p|480p|15s|5s/i });
  const count = await trigger.count();
  for (let index = 0; index < count; index += 1) {
    const item = trigger.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    await item.click({ timeout: 5_000 });
    await page.getByText("生成方式", { exact: true }).waitFor({ state: "visible", timeout: 5_000 });
    return page.locator('[role="menu"]').filter({ hasText: "生成方式" }).first();
  }
  throw new Error("MIORA_PARAMETER_MENU_NOT_FOUND");
}

async function selectCanvasParameter(page, dialog, label) {
  const menu = await openCanvasParameterMenu(page, dialog);
  // The current Method 13 duration selector is a Radix slider. Its `15s`
  // marker is decorative and cannot receive clicks, so use the documented
  // keyboard endpoint on the accessible slider rather than force-clicking a
  // label beneath the interactive control.
  if (/^15s$/i.test(label)) {
    const slider = menu.getByRole("slider");
    if (await slider.count() !== 1) throw new Error("MIORA_DURATION_SLIDER_NOT_FOUND");
    await slider.focus();
    await slider.press("End");
    if (await slider.getAttribute("aria-valuenow") !== "15") throw new Error("MIORA_DURATION_15S_NOT_SET");
    return;
  }
  const exact = menu.getByText(label, { exact: true });
  const count = await exact.count();
  for (let index = 0; index < count; index += 1) {
    const option = exact.nth(index);
    if (!(await option.isVisible().catch(() => false))) continue;
    await option.click({ timeout: 5_000 });
    return;
  }
  throw new Error(`MIORA_OPTION_NOT_VISIBLE:${label}`);
}

async function configureCanvasVideoModule(page) {
  const dialog = await generatorDialog(page);
  // These are the verified Method 13 values.  The model remains visible in
  // the dialog, while the remaining options live in the canvas parameter
  // popover.  This never falls back to the homepage Ask flow.
  const initial = await dialog.innerText({ timeout: 8_000 });
  if (!/S2 Video|Seedance\s*2/i.test(initial)) throw new Error("MIORA_S2_MODEL_NOT_VISIBLE");
  await selectCanvasParameter(page, dialog, "参考");
  await selectCanvasParameter(page, dialog, "720p");
  await selectCanvasParameter(page, dialog, "16:9");
  await selectCanvasParameter(page, dialog, "15s");
  const visible = await dialog.innerText({ timeout: 8_000 });
  const required = [/S2 Video|Seedance\s*2/i, /720p|720P/i, /15s|15S/i, /16:9/i];
  const missing = required.filter((pattern) => !pattern.test(visible));
  if (missing.length) throw new Error("MIORA_CANVAS_PARAMETER_READBACK_MISSING");
  // Close only the parameter popover. The generator stays open, while the
  // image action becomes reliably clickable instead of being covered by its
  // portal layer.
  await page.keyboard.press("Escape").catch(() => undefined);
}

function promptWithReferenceTokens(prompt, references) {
  const tokens = references.map((reference, index) => reference.ref_token || reference.refToken || `@参考图${index + 1}`);
  const missing = tokens.filter((token) => !prompt.includes(token));
  if (!missing.length) return prompt;
  return `${tokens.map((token) => `（${token}）`).join("")}\n${prompt}`;
}

async function uploadCanvasReferences(page, references) {
  const dialog = await generatorDialog(page);
  // The Method 13 dialog deliberately creates the file chooser only after the
  // image action and its “从本地上传图片” menu item are selected.  Selecting an
  // arbitrary hidden input bypasses the UI's reference node binding and was
  // the source of earlier unreliable uploads.
  // Attach a rejection handler immediately. If a UI readback blocks before a
  // chooser exists, closing the CDP connection must not leave an unhandled
  // `filechooser` rejection behind.
  const chooser = page.waitForEvent("filechooser", { timeout: 15_000 }).catch(() => null);
  const imageActionOpened = await clickFirstVisible(page, [
    (p) => p.locator('[data-testid*="image"]').filter({ has: p.locator("button") }).first(),
    // The current 参考-mode canvas uses an icon-only image button, without a
    // data-testid or accessible text. Its SVG name is stable in the live UI.
    (p) => p.locator('button:has(svg.lucide-images)').first(),
    (p) => p.getByRole("button", { name: /添加图片|图片|Image/i }),
    (p) => p.locator('button[aria-label*="图片"], button[title*="图片"], button[aria-label*="image" i], button[title*="image" i]').first(),
  ], 8_000);
  if (!imageActionOpened) throw new Error("MIORA_IMAGE_ACTION_NOT_FOUND");
  const localUploadOpened = await clickFirstVisible(page, [
    (p) => p.getByText("从本地上传图片", { exact: true }),
    (p) => p.getByRole("menuitem", { name: /从本地上传图片|Upload.*local/i }),
    (p) => p.getByText(/从本地上传图片|Upload.*local/i),
  ], 8_000);
  if (!localUploadOpened) throw new Error("MIORA_LOCAL_UPLOAD_MENU_NOT_FOUND");
  const fileChooser = await chooser;
  if (!fileChooser) throw new Error("MIORA_FILE_CHOOSER_NOT_OBSERVED");
  await fileChooser.setFiles(references.map((reference) => reference.path));
  await page.waitForTimeout(500);
  const referenceTokens = await dialog.locator("text=/@参考图[0-9]+/").count().catch(() => 0);
  const previewImages = await dialog.locator("img").count().catch(() => 0);
  if (!referenceTokens && !previewImages) throw new Error("MIORA_REFERENCE_NODE_NOT_OBSERVED");
}

function taskIdFromPayload(value) {
  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (/^(taskId|task_id)$/i.test(key) && typeof item === "string" && /^[A-Za-z0-9._:-]{6,}$/.test(item)) return item;
      if (item && typeof item === "object") queue.push(item);
    }
  }
  return null;
}

async function submitVisible(page, prompt, references) {
  if (process.env.MIORA_PROVIDER_SUBMIT_ENABLED !== "true") throw new Error("MIORA_PROVIDER_SUBMIT_DISABLED");
  await captureProviderEvents(page);
  await enterCanvas(page);
  await openVideoModule(page);
  await configureCanvasVideoModule(page);
  await uploadCanvasReferences(page, references);
  const finalPrompt = promptWithReferenceTokens(prompt, references);
  const dialogForPrompt = await generatorDialog(page);
  const promptTargets = [dialogForPrompt.locator("textarea"), dialogForPrompt.locator("[contenteditable=true]"), dialogForPrompt.locator("input[type=text]")];
  let filled = false;
  for (const target of promptTargets) {
    try {
      if (await target.count() === 1 && await target.isVisible()) {
        await target.fill(finalPrompt, { timeout: 3_000 });
        filled = true;
        break;
      }
    } catch {
      // Try the next prompt target.
    }
  }
  if (!filled) throw new Error("MIORA_PROMPT_INPUT_NOT_FOUND");
  await configureCanvasVideoModule(page);
  const dialog = await generatorDialog(page);
  const submitButton = dialog.locator("button:has(svg.arrow-run)");
  if (await submitButton.count() !== 1) throw new Error("MIORA_SUBMIT_BUTTON_NOT_FOUND");
  const responsePromise = page.waitForResponse((response) => {
    try {
      return new URL(response.url()).pathname === "/api/ai/media-generate/video" && response.request().method() === "POST";
    } catch {
      return false;
    }
  }, { timeout: 30_000 });
  await submitButton.click({ timeout: 10_000 });
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  const visibleAfterSubmit = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
  if (/K3\s*Omni/i.test(JSON.stringify(payload) + "\n" + visibleAfterSubmit)) throw new Error("MIORA_PROVIDER_WRONG_MODEL:K3 Omni");
  const providerTaskId = taskIdFromPayload(payload);
  if (!providerTaskId) throw new Error("MIORA_PROVIDER_TASK_ID_NOT_OBSERVED");
  return providerTaskId;
}

async function writeWrongModelLedger(task, spec, blocker) {
  const ledgerRoot = spec.output_paths?.ledger;
  if (!ledgerRoot) return null;
  await mkdir(ledgerRoot, { recursive: true });
  const ledgerPath = path.join(ledgerRoot, "miora-rejection-ledger.json");
  const visibleModel = String(blocker).split(":").slice(1).join(":").trim() || "unknown";
  await writeFile(ledgerPath, JSON.stringify({
    provider: "miora",
    taskId: task.id ?? null,
    providerTaskId: task.provider_task_id ?? null,
    requested_model: "Seedance 2.0",
    requested_resolution: "720P",
    requested_duration: "15s",
    provider_visible_submission_model: visibleModel,
    status: "rejected_wrong_model",
    downstream_consumable: false,
    rejectedAt: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  return ledgerPath;
}

function resultUrlFromProgress(value) {
  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (/^resultSignUrl$/i.test(key) && typeof item === "string" && /^https?:\/\//i.test(item)) return item;
      if (item && typeof item === "object") queue.push(item);
    }
  }
  return null;
}

async function observedTaskProgress(page, providerTaskId) {
  const result = await page.evaluate((taskId) => {
    const events = Array.isArray(window.__niannianMioraEvents) ? window.__niannianMioraEvents : [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!/\/api\/ai\/media-generate\/progress/i.test(String(event?.url ?? ""))) continue;
      let body = null;
      try { body = JSON.parse(String(event?.body ?? "")); } catch { continue; }
      const queue = [body];
      const seen = new Set();
      let matched = false;
      while (queue.length) {
        const value = queue.pop();
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
          if (/^(taskId|task_id)$/i.test(key) && item === taskId) matched = true;
          if (item && typeof item === "object") queue.push(item);
        }
      }
      if (matched) return { ok: true, status: 200, body };
    }
    return null;
  }, providerTaskId).catch((error) => ({
    observationError: /Target page, context or browser has been closed/i.test(String(error?.message ?? error))
      ? "cdp_target_closed"
      : "cdp_observed_progress_unavailable",
  }));
  return result;
}

async function readTaskProgress(page, providerTaskId) {
  // Miora's native canvas already polls this endpoint with its session-bound
  // request client. A bare browser `fetch` can receive 401 even while the
  // visible, authenticated canvas is successfully receiving progress. Reuse
  // the observed same-task response first; it carries no credentials and
  // keeps the provider-task-id binding intact.
  const observed = await observedTaskProgress(page, providerTaskId);
  if (observed?.observationError) {
    return { ok: false, status: 0, body: { _miora_sync_diagnostic: observed.observationError } };
  }
  if (observed) return observed;
  try {
    return await page.evaluate(async (taskId) => {
      const response = await fetch("/api/ai/media-generate/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId }),
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, body };
    }, providerTaskId);
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

async function syncDownload(task, spec, page) {
  const providerTaskId = task.provider_task_id;
  if (!providerTaskId) throw new Error("MIORA_PROVIDER_TASK_ID_REQUIRED");
  const outputPaths = spec.output_paths || {};
  const downloadsRoot = outputPaths.downloads;
  const ledgerRoot = outputPaths.ledger;
  const qaRoot = outputPaths.qa;
  if (!downloadsRoot || !ledgerRoot || !qaRoot) throw new Error("MIORA_OUTPUT_PATHS_MISSING");
  await mkdir(downloadsRoot, { recursive: true });
  await mkdir(ledgerRoot, { recursive: true });
  await mkdir(qaRoot, { recursive: true });
  const progress = await readTaskProgress(page, providerTaskId);
  if (!progress.ok) {
    const diagnostic = typeof progress.body?._miora_sync_diagnostic === "string"
      ? `:${progress.body._miora_sync_diagnostic}`
      : "";
    const blocker = progress.status === 401 || progress.status === 403
      ? "MIORA_PROGRESS_AUTHENTICATION_REQUIRED"
      : `MIORA_PROGRESS_READBACK_FAILED:${progress.status}${diagnostic}`;
    return { status: "blocked", providerTaskId, outputPath: null, blocker, summary: "Miora progress readback is unavailable; no arbitrary page video was downloaded.", mediaProbePassed: false, contentQaPassed: false, ledgerPath: null };
  }
  const progressText = JSON.stringify(progress.body);
  const videoUrl = resultUrlFromProgress(progress.body);
  if (!videoUrl) {
    if (/failed|error/i.test(progressText)) {
      return { status: "blocked", providerTaskId, outputPath: null, blocker: "MIORA_PROVIDER_FAILED", summary: "Miora reported a failed task; no video was downloaded.", mediaProbePassed: false, contentQaPassed: false, ledgerPath: null };
    }
    return { status: "running", providerTaskId, outputPath: null, blocker: null, summary: "Miora task is still running; resultSignUrl is not available yet.", mediaProbePassed: false, contentQaPassed: false, ledgerPath: null };
  }
  const response = await page.context().request.get(videoUrl, { timeout: 120_000 });
  if (!response.ok()) throw new Error("MIORA_DOWNLOAD_FAILED:" + response.status());
  const safeTaskId = providerTaskId.replace(/[^A-Za-z0-9._-]/g, "_");
  const outputPath = path.join(downloadsRoot, "miora-" + safeTaskId + ".mp4");
  const bytes = await response.body();
  await writeFile(outputPath, bytes);
  const size = (await stat(outputPath)).size;
  if (size < 1024) throw new Error("MIORA_DOWNLOADED_FILE_TOO_SMALL");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ledgerPath = path.join(ledgerRoot, "miora-execution-ledger.json");
  const probedDuration = await probeVideoDuration(outputPath);
  const expectedDuration = Number(task.duration_seconds || 15);
  if (Math.abs(probedDuration - expectedDuration) > Math.max(1, expectedDuration * 0.2)) throw new Error("MIORA_MEDIA_DURATION_MISMATCH");
  await writeFile(ledgerPath, JSON.stringify({ provider: "miora", taskId: task.id, providerTaskId, taskSpecSha256: createHash("sha256").update(JSON.stringify(spec)).digest("hex"), promptSha256: spec.prompt_sha256 ?? null, references: (spec.references ?? []).map((reference) => ({ path: reference.path, sha256: reference.sha256, refKey: reference.ref_key ?? null })), facePreprocessManifestPath: path.join(ledgerRoot, "face_preprocess_manifest.json"), output: { path: outputPath, sha256, size }, mediaProbe: { passed: true, duration: probedDuration }, contentQa: "pending_admin_review", downloadedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  await writeFile(path.join(qaRoot, "content-qa.json"), JSON.stringify({ taskId: task.id, providerTaskId, status: "awaiting_content_qa", mediaProbePassed: true, contentQaPassed: false, reason: "等待人工内容验收；未通过前不能交付或进入模板库。", createdAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  return { status: "blocked", providerTaskId, outputPath, blocker: "awaiting_content_qa", summary: "Miora output downloaded and passed media probe; awaiting administrator content QA.", mediaProbePassed: true, contentQaPassed: false, ledgerPath };
}

async function writeSubmissionReceipt(task, spec, providerTaskId, credits, references, facePreprocessManifestPath) {
  const eventsRoot = spec.output_paths?.events;
  if (!eventsRoot) throw new Error("MIORA_EVENT_OUTPUT_PATH_MISSING");
  await mkdir(eventsRoot, { recursive: true });
  await writeFile(path.join(eventsRoot, "submission.json"), JSON.stringify({
    provider: "miora",
    taskId: task.id,
    providerTaskId,
    submittedAt: new Date().toISOString(),
    modelReadback: "S2 Video",
    modeReadback: "参考",
    resolutionReadback: "720p",
    durationReadback: "15s",
    aspectRatioReadback: "16:9",
    creditsReadback: credits ?? null,
    costGate: spec.cost_gate ?? null,
    promptSha256: spec.prompt_sha256 ?? null,
    references: references.map((reference) => ({ path: reference.path, sha256: reference.sha256, refKey: reference.ref_key ?? null, originalPath: reference.original_path_before_face_line ?? null, originalSha256: reference.original_sha256_before_face_line ?? null, faceLinePreprocessed: reference.face_line_preprocessed === true })),
    facePreprocessManifestPath,
  }, null, 2) + "\n", "utf8");
}

export async function runMioraDirectTask({ task, spec }) {
  const { prompt, references } = await verifySpec(task, spec);
  const { browser, page } = await connectMioraPage();
  try {
    // A persisted provider id is an immutable external-side-effect boundary.
    // Syncing it cannot submit or change provider parameters, so do not open a
    // fresh probe tab before attempting the task-bound native progress read.
    // Besides being cheaper, this preserves the existing canvas event cache
    // that carries the same-id progress/result response after a reconnect.
    if (task.provider_task_id) return syncDownload(task, spec, page);
    const state = await preflight(page);
    if (!state.authenticated) throw new Error("MIORA_AUTHENTICATION_REQUIRED");
    if (!state.modelAvailable) throw new Error("MIORA_SEEDANCE2_MODEL_NOT_VISIBLE");
    if (!hasAvailableCredits(state.credits)) throw new Error("MIORA_CREDITS_NOT_AVAILABLE");
    const prepared = await prepareMioraFaceLineReferences({ task, spec, references });
    const providerTaskId = await submitVisible(page, prompt, prepared.references);
    await writeSubmissionReceipt(task, spec, providerTaskId, state.credits, prepared.references, prepared.manifestPath);
    return { status: "running", providerTaskId, outputPath: null, blocker: null, summary: "Miora submitted; credits readback " + (state.credits ?? "unknown") + ".", mediaProbePassed: false, contentQaPassed: false, ledgerPath: null };
  } catch (error) {
    const blocker = clean(error instanceof Error ? error.message : error);
    const ledgerPath = blocker.startsWith("MIORA_PROVIDER_WRONG_MODEL")
      ? await writeWrongModelLedger(task, spec, blocker).catch(() => null)
      : null;
    return { status: "blocked", providerTaskId: task.provider_task_id ?? null, outputPath: null, blocker, summary: "Miora direct task blocked: " + blocker, mediaProbePassed: false, contentQaPassed: false, ledgerPath };
  } finally {
    await disconnectMioraCdp(browser).catch(() => undefined);
  }
}
