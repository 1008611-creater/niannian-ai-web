import { NextRequest, NextResponse } from "next/server";
import { authorizeAStorieWorker, claimAStorieTask } from "@/lib/astorie-windows-worker";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    if (!authorizeAStorieWorker(request.headers.get("authorization"))) return NextResponse.json({ error: "ASTORIE_WORKER_UNAUTHORIZED" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ task: await claimAStorieTask(body.workerId) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASTORIE_WORKER_CLAIM_FAILED";
    return NextResponse.json({ error: code }, { status: /INVALID/.test(code) ? 400 : 503 });
  }
}
