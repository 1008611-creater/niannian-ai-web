import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { dolaSkillChain, getDolaReadiness } from "@/lib/dola-channel";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const readiness = await getDolaReadiness({ force: true });
  return NextResponse.json({
    ok: readiness.state === "ready",
    code: readiness.state === "ready" ? "DOLA_PREFLIGHT_PASSED" : "DOLA_PREFLIGHT_BLOCKED",
    readiness,
    skillRoute: dolaSkillChain,
    submitAllowed: false,
    spendRequested: false,
    realDelivery: false,
  }, { status: readiness.state === "ready" ? 200 : 409 });
}
