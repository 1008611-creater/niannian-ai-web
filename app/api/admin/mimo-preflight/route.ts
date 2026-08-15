import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { getMimoReadiness, runMimoPreflight } from "@/lib/mimo-readiness";

export const runtime = "nodejs";

async function hasAdminAccess(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return Boolean(user && isAdminEmail(user.email));
}

export async function GET(request: NextRequest) {
  try {
    if (!(await hasAdminAccess(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await getMimoReadiness());
  } catch {
    return NextResponse.json({ error: "MIMO_PREFLIGHT_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    if (!(await hasAdminAccess(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await runMimoPreflight());
  } catch {
    return NextResponse.json({ error: "MIMO_PREFLIGHT_UNAVAILABLE" }, { status: 503 });
  }
}
