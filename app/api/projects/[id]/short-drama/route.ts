import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { createScriptWorkflowRequest, listScriptWorkflowRequests } from "@/lib/project-workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try { return NextResponse.json({ requests: await listScriptWorkflowRequests(user.id, id) }); }
  catch (error) {
    const code = error instanceof Error ? error.message : "SHORT_DRAMA_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "PROJECT_NOT_FOUND" ? 404 : 503 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await createScriptWorkflowRequest({ userId: user.id, projectId: id, sourceText: String(body.sourceText ?? ""), requirements: String(body.requirements ?? "") });
    return NextResponse.json({ request: { id: result.id, status: result.status, createdAt: result.created_at, updatedAt: result.updated_at } }, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHORT_DRAMA_CREATE_FAILED";
    return NextResponse.json({ error: code }, { status: code === "PROJECT_NOT_FOUND" ? 404 : code === "SCRIPT_SOURCE_REQUIRED" ? 400 : 503 });
  }
}
