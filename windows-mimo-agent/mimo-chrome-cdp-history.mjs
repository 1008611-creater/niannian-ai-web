#!/usr/bin/env node

import { authenticateMimoPage, connectMimoChrome, disconnectMimoCdp } from "./mimo-chrome-cdp.mjs";

const query = String(process.argv[process.argv.indexOf("--query") + 1] || "").trim();

async function main() {
  if (!query) throw new Error("CHROME_CDP_HISTORY:QUERY_REQUIRED");
  const { browser, page } = await connectMimoChrome();
  try {
    const authentication = await authenticateMimoPage(page);
    if (!authentication.authenticated) throw new Error(`CHROME_CDP_HISTORY:${authentication.blocker}`);
    const toggle = page.locator('button.mini-icon[title="展开 历史记录"]').first();
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.waitForTimeout(500);
    const cards = await page.locator(".his-card").allTextContents();
    const normalized = query.replace(/\s+/g, "").toLowerCase();
    const matched = cards.some((text) => text.replace(/\s+/g, "").toLowerCase().includes(normalized));
    // Do not emit unrelated prompts, IDs, or account details from history.
    console.log(JSON.stringify({ historyCards: cards.length, matchingTask: matched }));
  } finally {
    disconnectMimoCdp(browser);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
