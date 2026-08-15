import { NextRequest, NextResponse } from "next/server";
import { authorizeDolaWorker, claimDolaTask } from "@/lib/dola-windows-worker";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!authorizeDolaWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "DOLA_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const task = await claimDolaTask(body.workerId);
    return NextResponse.json({ task });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DOLA_WORKER_CLAIM_FAILED";
    const status = code === "DOLA_WORKER_NOT_CONFIGURED" ? 503 : code === "DOLA_WORKER_NOT_READY" ? 409 : /INVALID|MISSING/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

