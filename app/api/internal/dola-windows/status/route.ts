import { NextRequest, NextResponse } from "next/server";
import { authorizeDolaWorker, readDolaWorkerDiagnostics, readDolaWorkerState } from "@/lib/dola-windows-worker";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (!authorizeDolaWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "DOLA_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const [state, diagnostics] = await Promise.all([readDolaWorkerState(), readDolaWorkerDiagnostics()]);
    return NextResponse.json({ configured: true, state, diagnostics });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DOLA_WORKER_STATUS_FAILED";
    return NextResponse.json({ error: code }, { status: code === "DOLA_WORKER_NOT_CONFIGURED" ? 503 : 500 });
  }
}

