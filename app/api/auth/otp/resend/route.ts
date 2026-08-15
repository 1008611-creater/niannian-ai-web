import { NextResponse } from "next/server";
import { normalizeEmail, requestIp, resendRegistrationCode, validRequestOrigin } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "EMAIL_INVALID" }, { status: 400 });
  try {
    const result = await resendRegistrationCode(email, requestIp(request));
    if ("error" in result) return NextResponse.json(result, { status: result.error === "OTP_RESEND_COOLDOWN" ? 429 : 400 });
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: "AUTH_CONFIGURATION_ERROR" }, { status: 503 }); }
}
