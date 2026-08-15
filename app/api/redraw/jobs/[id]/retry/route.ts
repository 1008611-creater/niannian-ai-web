import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { markRedrawQueueDispatchFailed, publicRedrawJob, retryRedrawJob } from "@/lib/redraw-jobs";
import { enqueueRedrawJob } from "@/lib/redraw-queue";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const { id } = await context.params;
    const job = await retryRedrawJob(user.id, id);
    if (!job) throw new Error("REDRAW_JOB_NOT_FOUND");
    try { await enqueueRedrawJob(id, job.updated_at); }
    catch {
      await markRedrawQueueDispatchFailed(user.id, id, job.updated_at).catch(() => false);
      throw new Error("REDRAW_QUEUE_DISPATCH_FAILED");
    }
    return NextResponse.json({ job: publicRedrawJob(job) });
  }
  catch (error) {
    const code = error instanceof Error ? error.message : "REDRAW_RETRY_FAILED";
    const status = code === "REDRAW_JOB_NOT_FOUND" ? 404 : code === "REDRAW_QUEUE_DISPATCH_FAILED" ? 503 : 409;
    return NextResponse.json({ error: code }, { status });
  }
}
