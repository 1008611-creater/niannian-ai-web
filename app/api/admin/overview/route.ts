import { NextRequest, NextResponse } from "next/server";
import { getAdminOverview, isAdminEmail, updateAdminTask } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { approveRechargeRequest, rejectRechargeRequest } from "@/lib/credits";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await getAdminOverview());
  } catch {
    return NextResponse.json({ error: "ADMIN_OVERVIEW_UNAVAILABLE" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await adminUser(request);
    if (!user) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (typeof body.action !== "string") return NextResponse.json({ error: "ADMIN_ACTION_INVALID" }, { status: 400 });
    if (body.action === "approve_recharge" || body.action === "reject_recharge") {
      const requestId = typeof body.rechargeRequestId === "string" ? body.rechargeRequestId : "";
      if (!requestId) return NextResponse.json({ error: "RECHARGE_REQUEST_INVALID" }, { status: 400 });
      const result = body.action === "approve_recharge"
        ? await approveRechargeRequest({ requestId, adminUserId: user.id })
        : await rejectRechargeRequest({ requestId, adminUserId: user.id });
      return NextResponse.json({ ok: true, recharge: result });
    }
    if (typeof body.taskId !== "string") return NextResponse.json({ error: "ADMIN_ACTION_INVALID" }, { status: 400 });
    return NextResponse.json(await updateAdminTask(body));
  } catch (error) {
    const code = error instanceof Error ? error.message : "ADMIN_ACTION_FAILED";
    const status = /REQUIRED|INVALID|NOT_FOUND|OUTSIDE|CONTENT_QA|MISMATCH|SWITCH|NOT_PENDING|WORKER_OWNS/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
