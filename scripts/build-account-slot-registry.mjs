#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import xlsx from "xlsx";

const source = process.argv[2];
const target = process.argv[3] || path.join(process.cwd(), "runtime", "account-slot-registry.json");
if (!source) throw new Error("ACCOUNT_MATRIX_PATH_REQUIRED");

const sensitiveHeaders = new Set(["密码", "辅助邮箱", "cookie", "token", "验证码", "mfa"]);
const workbook = xlsx.readFile(source, { cellText: false, cellDates: false });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
const headers = (rows[0] || []).map((value) => String(value).trim());
const accountColumn = headers.indexOf("账号");
if (accountColumn < 0) throw new Error("ACCOUNT_MATRIX_ACCOUNT_COLUMN_REQUIRED");

const channels = headers
  .map((header, index) => ({ header, index }))
  .filter(({ header }) => header && header !== "账号" && !sensitiveHeaders.has(header.toLowerCase()));

const slots = rows.slice(1).flatMap((row, index) => {
  const account = String(row[accountColumn] || "").trim();
  if (!account) return [];
  const enabledChannels = channels
    .filter(({ index: column }) => Boolean(String(row[column] || "").trim()))
    .map(({ header }) => header);
  if (!enabledChannels.length) return [];
  return [{
    slotId: `account-slot-${String(index + 1).padStart(3, "0")}`,
    accountFingerprint: createHash("sha256").update(account.toLowerCase()).digest("hex"),
    enabledChannels,
    concurrency: 1,
    status: "needs_browser_login",
  }];
});

const registry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "user_authoritative_account_matrix_sanitized",
  slots,
  policy: {
    credentialColumnsIgnored: ["密码", "辅助邮箱"],
    credentialPersistence: "windows_dpapi_current_user_sealed",
    oneActiveProviderTaskPerSlot: true,
  },
};

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ target, slotCount: slots.length, channelCount: new Set(slots.flatMap((slot) => slot.enabledChannels)).size })}\n`);
