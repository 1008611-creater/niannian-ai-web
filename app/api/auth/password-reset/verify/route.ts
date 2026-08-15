import { NextResponse } from "next/server";
import { normalizeEmail, requestIp, validRequestOrigin, verifyPasswordReset } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || typeof body?.code !== "string") {
    return NextResponse.json({ error: "OTP_REQUIRED" }, { status: 400 });
  }
  try {
    const result = await verifyPasswordReset(email, body.code.trim(), requestIp(request));
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Password reset verification failed", error);
    return NextResponse.json({ error: "AUTH_CONFIGURATION_ERROR" }, { status: 503 });
  }
}
