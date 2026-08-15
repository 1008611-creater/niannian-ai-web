import { NextResponse } from "next/server";
import { authCookie, createSession, normalizeEmail, requestIp, validRequestOrigin, verifyRegistration } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || typeof body?.code !== "string") return NextResponse.json({ error: "OTP_REQUIRED" }, { status: 400 });
  try {
    const result = await verifyRegistration(email, body.code.trim(), requestIp(request));
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    const session = await createSession(result.user);
    const response = NextResponse.json({ user: { email: session.email } }, { status: 201 });
    response.cookies.set(authCookie, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false",
      path: "/",
      maxAge: session.maxAge,
    });
    return response;
  } catch { return NextResponse.json({ error: "AUTH_CONFIGURATION_ERROR" }, { status: 503 }); }
}
