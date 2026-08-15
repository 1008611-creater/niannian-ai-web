import { NextRequest, NextResponse } from "next/server";
import { claimMimoTask } from "@/lib/mimo-windows-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const task = await claimMimoTask(body.workerId);
    return NextResponse.json({ task });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MIMO_WINDOWS_WORKER_CLAIM_FAILED";
    const status = code === "MIMO_WINDOWS_WORKER_NOT_CONFIGURED" ? 503 : code === "MIMO_WINDOWS_WORKER_NOT_READY" ? 409 : /INVALID|MISSING/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

