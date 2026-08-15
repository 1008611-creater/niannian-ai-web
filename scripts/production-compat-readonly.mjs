#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function count(client, table) {
  const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function optionalTable(client, table) {
  const result = await client.query("SELECT to_regclass($1) AS name", [table]);
  return Boolean(result.rows[0]?.name);
}

async function snapshot(client) {
  const metadataTablePresent = await optionalTable(client, "asset_reference_metadata");
  const [users, tasks, assets, events, creditLedger, credits] = await Promise.all([
    count(client, "users"),
    count(client, "video_tasks"),
    count(client, "uploaded_assets"),
    count(client, "video_task_events"),
    count(client, "credit_ledger"),
    count(client, "user_credits"),
  ]);
  const taskRows = (await client.query(
    "SELECT id,user_id,execution_mode,channel,status,blocker,provider_task_id,output_path,submit_allowed,cost_authorized,created_at,updated_at,task_spec_path,asset_manifest FROM video_tasks ORDER BY id",
  )).rows;
  const assetRows = (await client.query(
    "SELECT id,user_id,role,sha256,byte_size,created_at FROM uploaded_assets ORDER BY id",
  )).rows;
  const creditRows = (await client.query(
    "SELECT user_id,balance,updated_at FROM user_credits ORDER BY user_id",
  )).rows;
  const ledgerRows = (await client.query(
    "SELECT id,user_id,amount,balance_after,reason,task_id,recharge_request_id,created_at FROM credit_ledger ORDER BY id",
  )).rows;
  const generationTypes = {};
  let legacyMotionReferences = 0;
  let missingTaskSpecs = 0;
  let malformedTaskSpecs = 0;
  for (const row of taskRows) {
    try {
      const spec = JSON.parse(await readFile(path.resolve(row.task_spec_path), "utf8"));
      const type = String(spec.generation_type || "missing");
      generationTypes[type] = (generationTypes[type] || 0) + 1;
      legacyMotionReferences += Array.isArray(spec.references)
        ? spec.references.filter((reference) => reference?.chinese_duty === "动作参考视频" || reference?.role === "support_asset_ref").length
        : 0;
    } catch (error) {
      if (error?.code === "ENOENT") missingTaskSpecs += 1;
      else malformedTaskSpecs += 1;
    }
  }
  const statusCounts = {};
  for (const row of taskRows) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
  const runningMimoTasks = taskRows.filter((row) => row.execution_mode === "codex_skill" && row.channel === "mimo" && row.status === "running");
  const activeMimoProviderTasks = taskRows.filter((row) => row.execution_mode === "codex_skill"
    && row.channel === "mimo"
    && ["approved_for_execution", "running"].includes(row.status)
    && Boolean(row.provider_task_id));
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    readOnly: true,
    counts: { users, tasks, assets, events, creditLedger, credits, assetReferenceMetadata: metadataTablePresent ? await count(client, "asset_reference_metadata") : 0 },
    metadataTablePresent,
    taskCompatibility: { generationTypes, legacyMotionReferences, missingTaskSpecs, malformedTaskSpecs, statusCounts },
    queueGate: {
      approvedForExecution: statusCounts.approved_for_execution || 0,
      runningOnMac: statusCounts.running_on_mac || 0,
      runningOnMimo: runningMimoTasks.length,
      activeMimoProviderTasks: activeMimoProviderTasks.length,
      deployRequiresAllZero: true,
    },
    fingerprints: {
      tasks: stableHash(taskRows),
      assets: stableHash(assetRows),
      credits: stableHash(creditRows),
      creditLedger: stableHash(ledgerRows),
    },
  };
}

function assertCompatible(current, previous = null) {
  if (current.taskCompatibility.missingTaskSpecs || current.taskCompatibility.malformedTaskSpecs) throw new Error("TASK_SPEC_COMPATIBILITY_FAILED");
  if (current.queueGate.approvedForExecution || current.queueGate.runningOnMac || current.queueGate.runningOnMimo || current.queueGate.activeMimoProviderTasks) {
    throw new Error("DEPLOY_QUEUE_NOT_QUIESCENT");
  }
  if (previous) {
    for (const key of ["tasks", "assets", "credits", "creditLedger"]) {
      if (current.fingerprints[key] !== previous.fingerprints?.[key]) throw new Error(`PRODUCTION_FINGERPRINT_CHANGED:${key}`);
    }
  }
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  const result = await snapshot(client);
  const comparePath = argument("--compare");
  const previous = comparePath ? JSON.parse(await readFile(path.resolve(comparePath), "utf8")) : null;
  assertCompatible(result, previous);
  const outputPath = argument("--output");
  if (outputPath) await writeFile(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} finally {
  await client.end();
}
