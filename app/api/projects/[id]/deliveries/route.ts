import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { projectOverview } from "@/lib/project-workspace";
import { listRedrawJobs, publicRedrawJob } from "@/lib/redraw-jobs";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try {
    const [overview, jobs] = await Promise.all([projectOverview(user.id, id), listRedrawJobs(user.id)]);
    return NextResponse.json({
      project: overview.project,
      word: { status: "not_available", url: null },
      videoTasks: overview.deliveries,
      redrawJobs: jobs.filter((job) => job.project_id === id).map(publicRedrawJob),
      scripts: overview.scripts,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROJECT_DELIVERIES_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "PROJECT_NOT_FOUND" ? 404 : 503 });
  }
}
