import { NextRequest, NextResponse } from "next/server";
import { authorizeMacWorker, readMacWorkerDiagnostics, readMacWorkerState } from "@/lib/mac-codex-worker";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (!authorizeMacWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "MAC_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const [state, diagnostics] = await Promise.all([readMacWorkerState(), readMacWorkerDiagnostics()]);
    return NextResponse.json({ configured: true, state, diagnostics });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAC_WORKER_STATUS_FAILED";
    return NextResponse.json({ error: code }, { status: code === "MAC_WORKER_NOT_CONFIGURED" ? 503 : 500 });
  }
}
