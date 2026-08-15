import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { getMioraLearningProfile } from "@/lib/miora-learning";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const profile = await getMioraLearningProfile();
    return NextResponse.json({
      evidenceRule: profile.evidenceRule,
      templates: profile.templates,
    });
  } catch {
    return NextResponse.json({ error: "MIORA_TEMPLATES_UNAVAILABLE" }, { status: 503 });
  }
}
