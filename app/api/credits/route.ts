import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { createRechargeRequest, getCreditSummary, redeemLdxpCode } from "@/lib/credits";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    return NextResponse.json(await getCreditSummary(user.id));
  } catch {
    return NextResponse.json({ error: "CREDITS_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (body.action === "redeem_ldxp_code") {
      return NextResponse.json(await redeemLdxpCode({ userId: user.id, code: body.code }));
    }
    if (body.action !== "create_recharge_request") return NextResponse.json({ error: "CREDIT_ACTION_INVALID" }, { status: 400 });
    const requestRecord = await createRechargeRequest({
      userId: user.id,
      requestedCredits: Number(body.requestedCredits),
      note: typeof body.note === "string" ? body.note : undefined,
    });
    return NextResponse.json({ request: requestRecord }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CREDIT_REQUEST_FAILED";
    return NextResponse.json({ error: code }, { status: /INVALID|USED/.test(code) ? 400 : 503 });
  }
}
