import { NextRequest, NextResponse } from "next/server";
import { authorizeMacWorker, writeMacWorkerState } from "@/lib/mac-codex-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!authorizeMacWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "MAC_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, state: await writeMacWorkerState(body) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAC_WORKER_HEARTBEAT_FAILED";
    const status = code === "MAC_WORKER_NOT_CONFIGURED" ? 503 : /INVALID|NOT_ACTIVE/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
