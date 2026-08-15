import { NextRequest, NextResponse } from "next/server";
import { authorizeAStorieWorker } from "@/lib/astorie-windows-worker";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    if (!authorizeAStorieWorker(request.headers.get("authorization"))) return NextResponse.json({ error: "ASTORIE_WORKER_UNAUTHORIZED" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, workerId: String(body.workerId ?? ""), receivedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ASTORIE_WORKER_HEARTBEAT_FAILED" }, { status: 503 });
  }
}
