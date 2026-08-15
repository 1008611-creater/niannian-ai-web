import { NextRequest, NextResponse } from "next/server";
import { authorizeMacWorker, claimMacTask } from "@/lib/mac-codex-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!authorizeMacWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "MAC_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const task = await claimMacTask(body.workerId);
    return NextResponse.json({ task });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAC_WORKER_CLAIM_FAILED";
    const status = code === "MAC_WORKER_NOT_CONFIGURED" ? 503 : code === "MAC_WORKER_NOT_READY" ? 409 : /INVALID|MISSING/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
