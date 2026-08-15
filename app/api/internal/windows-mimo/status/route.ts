import { NextRequest, NextResponse } from "next/server";
import { readMimoWorkerDiagnostics, readMimoWorkerState } from "@/lib/mimo-windows-worker";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const [state, diagnostics] = await Promise.all([readMimoWorkerState(), readMimoWorkerDiagnostics()]);
    return NextResponse.json({ configured: true, state, diagnostics });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MIMO_WINDOWS_WORKER_STATUS_FAILED";
    return NextResponse.json({ error: code }, { status: code === "MIMO_WINDOWS_WORKER_NOT_CONFIGURED" ? 503 : 500 });
  }
}

