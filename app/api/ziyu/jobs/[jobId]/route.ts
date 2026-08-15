import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { getZiyuJob } from "@/lib/ziyu-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  if (!(await sessionFromToken(request.cookies.get(authCookie)?.value))) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { jobId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(jobId)) return NextResponse.json({ error: "JOB_ID_INVALID" }, { status: 400 });
  try {
    return NextResponse.json(await getZiyuJob(jobId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_JOB_QUERY_FAILED" }, { status: 502 });
  }
}
