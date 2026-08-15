import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { getCanvasDocument, saveCanvasDocument } from "@/lib/canvas";

export const runtime = "nodejs";

async function ownedProject(request: NextRequest, projectId: string) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return { user: null, project: null };
  return { user, project: await getProject(user.id, projectId) };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, project } = await ownedProject(request, id);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (!project) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ project, ...(await getCanvasDocument(user.id, id)) });
  } catch {
    return NextResponse.json({ error: "CANVAS_UNAVAILABLE" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const { id } = await context.params;
    const { user, project } = await ownedProject(request, id);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (!project) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const saved = await saveCanvasDocument(user.id, id, body.document, Number(body.revision));
    return NextResponse.json(saved);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CANVAS_SAVE_FAILED";
    return NextResponse.json({ error: code }, { status: code === "CANVAS_REVISION_CONFLICT" ? 409 : 503 });
  }
}
