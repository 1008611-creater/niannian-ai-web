import { NextRequest, NextResponse } from "next/server";
import { writeMimoWorkerState } from "@/lib/mimo-windows-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, state: await writeMimoWorkerState(body) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MIMO_WINDOWS_WORKER_HEARTBEAT_FAILED";
    const status = code === "MIMO_WINDOWS_WORKER_NOT_CONFIGURED" ? 503 : /INVALID|NOT_ACTIVE/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

