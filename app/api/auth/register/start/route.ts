import { NextResponse } from "next/server";
import { normalizeEmail, requestIp, startRegistration, validPassword, validRequestOrigin } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "EMAIL_INVALID" }, { status: 400 });
  if (!validPassword(body?.password)) return NextResponse.json({ error: "PASSWORD_INVALID" }, { status: 400 });
  try {
    const result = await startRegistration(email, body.password, requestIp(request), request.headers.get("user-agent"));
    if ("error" in result) return NextResponse.json(result, { status: result.error === "EMAIL_ALREADY_REGISTERED" ? 409 : 429 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Registration start failed", error);
    return NextResponse.json({ error: "AUTH_CONFIGURATION_ERROR" }, { status: 503 });
  }
}
