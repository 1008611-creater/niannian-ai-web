#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import pg from "pg";

const databaseUrl = process.env.REDRAW_TEST_DATABASE_URL;
const redisUrl = process.env.REDRAW_TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("REDRAW_INTEGRATION_ENV_REQUIRED");

const pool = new pg.Pool({ connectionString: databaseUrl });
const schema = `redraw_it_${randomUUID().replaceAll("-", "")}`;
const queueName = `redraw-it-${randomUUID()}`;

async function withSchema(client, work) {
  await client.query(`SET search_path TO ${schema}`);
  return work();
}

async function seed(client, suffix) {
  const jobId = `job-${suffix}`;
  const token = `claim-${suffix}`;
  await client.query("INSERT INTO redraw_jobs (id,user_id,status,worker_claim_token,updated_at) VALUES ($1,'user-1','planning',$2,now())", [jobId, token]);
  await client.query("INSERT INTO redraw_attempts (id,job_id,attempt_number,status) VALUES ($1,$2,1,'preparing')", [`attempt-${suffix}`, jobId]);
  return { jobId, token };
}

async function cancel(client, jobId) {
  return client.query(`UPDATE redraw_jobs SET status='cancelled',worker_claim_token=NULL,updated_at=now()
    WHERE id=$1 AND user_id='user-1' AND status IN ('created','queued','planning')
    AND NOT EXISTS (SELECT 1 FROM redraw_attempts WHERE job_id=redraw_jobs.id AND (status='submitting' OR provider_task_id IS NOT NULL))`, [jobId]);
}

async function enterSubmit(client, jobId, token) {
  return client.query(`UPDATE redraw_attempts SET status='submitting'
    WHERE job_id=$1 AND attempt_number=1
    AND EXISTS (SELECT 1 FROM redraw_jobs WHERE id=$1 AND worker_claim_token=$2)`, [jobId, token]);
}

try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  const setup = await pool.connect();
  try {
    await withSchema(setup, async () => {
      await setup.query("CREATE TABLE redraw_jobs (id text PRIMARY KEY,user_id text NOT NULL,status text NOT NULL,worker_claim_token text,updated_at timestamptz NOT NULL)");
      await setup.query("CREATE TABLE redraw_attempts (id text PRIMARY KEY,job_id text NOT NULL,attempt_number integer NOT NULL,status text NOT NULL,provider_task_id text)");
    });
  } finally { setup.release(); }

  const cancelFirst = await pool.connect();
  try {
    await withSchema(cancelFirst, async () => {
      const { jobId, token } = await seed(cancelFirst, "cancel-first");
      assert.equal((await cancel(cancelFirst, jobId)).rowCount, 1);
      assert.equal((await enterSubmit(cancelFirst, jobId, token)).rowCount, 0);
      const row = (await cancelFirst.query("SELECT status,worker_claim_token FROM redraw_jobs WHERE id=$1", [jobId])).rows[0];
      assert.deepEqual(row, { status: "cancelled", worker_claim_token: null });
    });
  } finally { cancelFirst.release(); }

  const submitFirst = await pool.connect();
  try {
    await withSchema(submitFirst, async () => {
      const { jobId, token } = await seed(submitFirst, "submit-first");
      assert.equal((await enterSubmit(submitFirst, jobId, token)).rowCount, 1);
      assert.equal((await cancel(submitFirst, jobId)).rowCount, 0);
      const row = (await submitFirst.query("SELECT status,worker_claim_token FROM redraw_jobs WHERE id=$1", [jobId])).rows[0];
      assert.deepEqual(row, { status: "planning", worker_claim_token: token });
    });
  } finally { submitFirst.release(); }

  const parsed = new URL(redisUrl);
  const connection = { host: parsed.hostname, port: Number(parsed.port || 6379), maxRetriesPerRequest: null };
  const queue = new Queue(queueName, { connection });
  try {
    const first = await queue.add("execute-redraw", { jobId: "job-stable" }, { jobId: "stable-revision" });
    const replay = await queue.add("execute-redraw", { jobId: "job-stable" }, { jobId: "stable-revision" });
    assert.equal(first.id, replay.id);
    assert.equal((await queue.getJobs(["waiting", "delayed", "active"])).filter((job) => job.id === "stable-revision").length, 1);
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
  }

  process.stdout.write(`${JSON.stringify({ ok: true, verified: ["cancel_before_submit_blocks_provider_commit", "submitting_blocks_false_cancel", "redis_duplicate_dispatch_collapses"] })}\n`);
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
  await pool.end();
}
