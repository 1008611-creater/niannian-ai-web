import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { createProject, listProjects, validProjectTitle, validProjectType } from "@/lib/projects";

export const runtime = "nodejs";

async function currentUser(request: NextRequest) {
  return sessionFromToken(request.cookies.get(authCookie)?.value);
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    return NextResponse.json({ projects: await listProjects(user.id) });
  } catch {
    return NextResponse.json({ error: "PROJECTS_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const title = validProjectTitle(body.title);
    const type = validProjectType(body.type);
    if (!title || !type) return NextResponse.json({ error: "PROJECT_INVALID" }, { status: 400 });
    return NextResponse.json({ project: await createProject(user.id, title, type) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "PROJECT_CREATE_FAILED" }, { status: 503 });
  }
}
