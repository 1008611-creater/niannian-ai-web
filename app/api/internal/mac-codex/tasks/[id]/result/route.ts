import { NextRequest, NextResponse } from "next/server";
import { acceptMacTaskResult, authorizeMacWorker } from "@/lib/mac-codex-worker";

export const runtime = "nodejs";

function validId(value: string) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(value);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!authorizeMacWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "MAC_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const { id } = await context.params;
    if (!validId(id)) return NextResponse.json({ error: "MAC_TASK_INVALID" }, { status: 400 });
    const form = await request.formData();
    const output = form.get("output");
    const ledger = form.get("ledger");
    const result = await acceptMacTaskResult({
      taskId: id,
      status: form.get("status"),
      providerTaskId: form.get("providerTaskId"),
      summary: form.get("summary"),
      blocker: form.get("blocker"),
      output: output instanceof File ? output : null,
      ledger: ledger instanceof File ? ledger : null,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAC_TASK_RESULT_FAILED";
    const status = code === "MAC_WORKER_NOT_CONFIGURED" ? 503 : code.includes("NOT_FOUND") ? 404 : /INVALID|REQUIRED|NOT_ACTIVE|MISMATCH|OUTSIDE/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
