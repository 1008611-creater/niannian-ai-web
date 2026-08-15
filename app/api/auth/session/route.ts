import { NextRequest, NextResponse } from "next/server";
import { authCookie, revokeSession, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    return NextResponse.json({ user: user ? { ...user, isAdmin: isAdminEmail(user.email) } : null });
  } catch {
    return NextResponse.json({ user: null }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try { await revokeSession(request.cookies.get(authCookie)?.value); } catch { /* Clear browser session even if persistence is unavailable. */ }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(authCookie, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
