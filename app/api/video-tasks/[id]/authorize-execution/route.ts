import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { authorizeOwnedAstorieExecution, authorizeOwnedMimoExecution, findOwnedVideoTask, publicVideoTask } from "@/lib/video-tasks";
import { publicMimoWorkerAvailability } from "@/lib/mimo-windows-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(id)) return NextResponse.json({ error: "VIDEO_TASK_INVALID" }, { status: 400 });
    const task = await findOwnedVideoTask(user.id, id);
    if (!task) return NextResponse.json({ error: "VIDEO_TASK_NOT_FOUND" }, { status: 404 });
    const result = task.channel === "astorie"
      ? await authorizeOwnedAstorieExecution(user.id, id)
      : await authorizeOwnedMimoExecution(user.id, id);
    const worker = await publicMimoWorkerAvailability();
    return NextResponse.json({ task: await publicVideoTask(result.task, { mimoReadyToClaim: worker.readyToClaim }), idempotent: result.idempotent });
  } catch (error) {
    const code = error instanceof Error ? error.message : "VIDEO_TASK_OWNER_AUTHORIZATION_FAILED";
    const status = code === "VIDEO_TASK_NOT_FOUND" ? 404 : /UNAUTHORIZED|INVALID|STATE|SYNC_ONLY|NOT_READY|MISMATCH|UNAVAILABLE/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
