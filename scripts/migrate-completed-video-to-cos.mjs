import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import pg from "pg";
import { readVerifiedVideoCosDelivery, uploadAndVerifyVideoDelivery } from "../lib/video-cos.ts";

const taskId = String(process.argv[2] ?? "").trim();
if (!/^[A-Za-z0-9_-]{12,120}$/.test(taskId)) throw new Error("VIDEO_TASK_ID_INVALID");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (process.env.VIDEO_DELIVERY_COS_REQUIRED !== "true") throw new Error("VIDEO_DELIVERY_COS_REQUIRED_NOT_ENABLED");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  const result = await client.query(
    "SELECT id,user_id,status,output_path,task_spec_path FROM video_tasks WHERE id=$1 LIMIT 1",
    [taskId],
  );
  const task = result.rows[0];
  if (!task) throw new Error("VIDEO_TASK_NOT_FOUND");
  if (task.status !== "completed" || !task.output_path || !task.task_spec_path) throw new Error("VIDEO_TASK_NOT_COMPLETED");
  const spec = JSON.parse(await readFile(task.task_spec_path, "utf8"));
  if (spec.completion_evidence?.media_probe_passed !== true || spec.completion_evidence?.content_qa_passed !== true) {
    throw new Error("VIDEO_TASK_QA_EVIDENCE_REQUIRED");
  }
  const existing = readVerifiedVideoCosDelivery(spec);
  const delivery = existing ?? await uploadAndVerifyVideoDelivery({ userId: task.user_id, taskId: task.id, outputPath: task.output_path });
  if (!delivery) throw new Error("VIDEO_COS_DELIVERY_REQUIRED");
  if (!existing) {
    spec.completion_evidence = { ...spec.completion_evidence, cos: delivery };
    const temporary = `${task.task_spec_path}.cos.tmp`;
    await writeFile(temporary, `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, task.task_spec_path);
    await client.query(
      "INSERT INTO video_task_events (id,task_id,event,detail,created_at) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), task.id, "cos_delivery_verified", JSON.stringify({ sha256: delivery.sha256, byteSize: delivery.byte_size, verifiedAt: delivery.verified_at }), new Date().toISOString()],
    );
  }
  console.log(JSON.stringify({ ok: true, taskId: task.id, sha256: delivery.sha256, byteSize: delivery.byte_size, alreadyMigrated: Boolean(existing) }));
} finally {
  await client.end();
}
