import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { publicVideoTask, resumeOwnedMioraHumanHandoff } from "@/lib/video-tasks";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(id)) return NextResponse.json({ error: "VIDEO_TASK_INVALID" }, { status: 400 });
    const task = await resumeOwnedMioraHumanHandoff(user.id, id);
    if (!task) return NextResponse.json({ error: "VIDEO_TASK_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ task: await publicVideoTask(task) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MIORA_HANDOFF_RESUME_FAILED";
    const status = /NOT_FOUND|INVALID|REQUIRED/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
