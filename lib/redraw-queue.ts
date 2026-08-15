import { createHash } from "node:crypto";

const QUEUE_NAME = "niannian-redraw-v1";

function redisConnection() {
  const url = process.env.REDRAW_REDIS_URL;
  if (!url) return null;
  const parsed = new URL(url);
  if (!/^rediss?:$/.test(parsed.protocol)) throw new Error("REDRAW_REDIS_URL_INVALID");
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "rediss:" ? 6380 : 6379)),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

export function redrawQueueDispatchId(jobId: string, revision: string) {
  if (!jobId || !revision) throw new Error("REDRAW_QUEUE_DISPATCH_INVALID");
  return `redraw-${createHash("sha256").update(`${jobId}|${revision}`).digest("hex").slice(0, 32)}`;
}

export async function enqueueRedrawJob(jobId: string, revision: string) {
  if (process.env.REDRAW_QUEUE_MODE === "disabled") return { queued: false, mode: "disabled" as const };
  const connection = redisConnection();
  if (!connection) throw new Error("REDRAW_QUEUE_NOT_CONFIGURED");
  const { Queue } = await import("bullmq");
  const queue = new Queue(QUEUE_NAME, { connection });
  try {
    await queue.add("execute-redraw", { jobId }, {
      jobId: redrawQueueDispatchId(jobId, revision),
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return { queued: true, mode: "redis" as const };
  } finally {
    await queue.close();
  }
}

export const redrawQueueName = QUEUE_NAME;
