import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { getZiyuPreview, ZiyuApiError } from "@/lib/ziyu-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await sessionFromToken(request.cookies.get(authCookie)?.value))) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const jobId = request.nextUrl.searchParams.get("jobId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(jobId)) return NextResponse.json({ error: "JOB_ID_INVALID" }, { status: 400 });
  try {
    const preview = await getZiyuPreview(jobId);
    if (!preview?.body) return NextResponse.json({ error: "PREVIEW_NOT_READY" }, { status: 404 });
    return new NextResponse(preview.body, { headers: { "Content-Type": preview.contentType, "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    const status = error instanceof ZiyuApiError && error.status === 404 ? 404 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_PREVIEW_FAILED" }, { status });
  }
}
