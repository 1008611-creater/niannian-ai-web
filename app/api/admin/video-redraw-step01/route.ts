import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { publicStep01Result, step01Project } from "@/lib/video-redraw-step01";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  return NextResponse.json({ project: { projectId: step01Project.projectId, analysisRunId: step01Project.analysisRunId }, result: await publicStep01Result() });
}
