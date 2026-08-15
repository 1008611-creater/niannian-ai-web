import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { createRedrawJob, listRedrawJobs, markRedrawQueueDispatchFailed, publicRedrawJob } from "@/lib/redraw-jobs";
import { enqueueRedrawJob } from "@/lib/redraw-queue";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ jobs: (await listRedrawJobs(user.id)).map(publicRedrawJob) });
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key") || "";
  try {
    const body = await request.json().catch(() => ({}));
    const result = await createRedrawJob({ userId: user.id, projectId: body.project_id, idempotencyKey, sourceAssetId: body.source_asset_id, referenceAssetIds: body.reference_asset_ids, requirements: body.requirements });
    if (result.job.status === "queued") {
      try { await enqueueRedrawJob(result.job.id, result.job.updated_at); }
      catch {
        await markRedrawQueueDispatchFailed(user.id, result.job.id, result.job.updated_at).catch(() => false);
        throw new Error("REDRAW_QUEUE_DISPATCH_FAILED");
      }
    }
    return NextResponse.json({ job: publicRedrawJob(result.job), idempotentReplay: !result.created }, { status: result.created ? 202 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "REDRAW_JOB_CREATE_FAILED";
    const status = code.startsWith("REDRAW_REQUEST") || code.startsWith("REDRAW_ASSET") || code === "REDRAW_PROJECT_REQUIRED" ? 400 : code === "PROJECT_NOT_FOUND" ? 404 : code === "REDRAW_QUEUE_NOT_CONFIGURED" || code === "REDRAW_QUEUE_DISPATCH_FAILED" ? 503 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
