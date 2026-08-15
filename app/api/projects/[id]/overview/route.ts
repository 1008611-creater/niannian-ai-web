import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { projectOverview } from "@/lib/project-workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await projectOverview(user.id, id));
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROJECT_OVERVIEW_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "PROJECT_NOT_FOUND" ? 404 : 503 });
  }
}
