import { NextRequest, NextResponse } from "next/server";
import { authorizeDolaWorker, writeDolaWorkerState } from "@/lib/dola-windows-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!authorizeDolaWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "DOLA_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, state: await writeDolaWorkerState(body) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DOLA_WORKER_HEARTBEAT_FAILED";
    const status = code === "DOLA_WORKER_NOT_CONFIGURED" ? 503 : /INVALID|NOT_ACTIVE/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

