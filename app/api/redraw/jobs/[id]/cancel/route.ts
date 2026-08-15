import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { cancelRedrawJob, publicRedrawJob } from "@/lib/redraw-jobs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try { const { id } = await context.params; return NextResponse.json({ job: publicRedrawJob(await cancelRedrawJob(user.id, id) as never) }); }
  catch (error) { const code = error instanceof Error ? error.message : "REDRAW_CANCEL_FAILED"; return NextResponse.json({ error: code }, { status: code === "REDRAW_JOB_NOT_FOUND" ? 404 : 409 }); }
}
