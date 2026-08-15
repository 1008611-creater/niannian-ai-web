import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { getRedrawJob, publicRedrawJob } from "@/lib/redraw-jobs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await context.params;
  const job = await getRedrawJob(user.id, id);
  return job ? NextResponse.json({ job: publicRedrawJob(job) }) : NextResponse.json({ error: "REDRAW_JOB_NOT_FOUND" }, { status: 404 });
}
