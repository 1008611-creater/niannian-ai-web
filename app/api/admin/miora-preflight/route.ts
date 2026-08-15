import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { getMioraReadiness, runMioraPreflight } from "@/lib/miora-channel";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await getMioraReadiness());
  } catch {
    return NextResponse.json({ error: "MIORA_PREFLIGHT_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await runMioraPreflight());
  } catch {
    return NextResponse.json({ error: "MIORA_PREFLIGHT_UNAVAILABLE" }, { status: 503 });
  }
}
