import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { markRedrawQueueDispatchFailed, publicRedrawJob, reconcileRedrawProviderTask } from "@/lib/redraw-jobs";
import { enqueueRedrawJob } from "@/lib/redraw-queue";

export const runtime = "nodejs";

const publicErrors = new Set([
  "REDRAW_JOB_NOT_FOUND",
  "REDRAW_PROVIDER_RECONCILIATION_INVALID",
  "REDRAW_PROVIDER_RECONCILIATION_NOT_ALLOWED",
  "REDRAW_PROVIDER_RECONCILIATION_CONFLICT",
  "REDRAW_QUEUE_DISPATCH_FAILED",
]);

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await reconcileRedrawProviderTask({
      jobId: body.jobId,
      attemptNumber: body.attemptNumber,
      transactionKey: body.transactionKey,
      providerTaskId: body.providerTaskId,
    });
    if (result.reconciled) {
      try { await enqueueRedrawJob(result.job.id, result.job.updated_at); }
      catch {
        await markRedrawQueueDispatchFailed(result.job.user_id, result.job.id, result.job.updated_at).catch(() => false);
        throw new Error("REDRAW_QUEUE_DISPATCH_FAILED");
      }
    }
    return NextResponse.json({ job: publicRedrawJob(result.job), idempotentReplay: !result.reconciled });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "";
    const code = publicErrors.has(rawCode) ? rawCode : "REDRAW_PROVIDER_RECONCILIATION_FAILED";
    const status = code === "REDRAW_JOB_NOT_FOUND" ? 404
      : code === "REDRAW_QUEUE_DISPATCH_FAILED" ? 503
        : code.endsWith("_INVALID") ? 400 : 409;
    return NextResponse.json({ error: code }, { status });
  }
}
