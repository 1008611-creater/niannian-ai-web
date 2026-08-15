import { NextRequest, NextResponse } from "next/server";
import { acceptMimoTaskResult } from "@/lib/mimo-windows-worker";

export const runtime = "nodejs";

function validId(value: string) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(value);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!validId(id)) return NextResponse.json({ error: "MIMO_WINDOWS_TASK_INVALID" }, { status: 400 });
    const form = await request.formData();
    const output = form.get("output");
    const ledger = form.get("ledger");
    const providerCostEvidence = JSON.parse(String(form.get("providerCostEvidence") || "null"));
    const progressEvents = JSON.parse(String(form.get("progressEvents") || "[]"));
    const result = await acceptMimoTaskResult({
      taskId: id,
      status: form.get("status"),
      workerId: form.get("workerId"),
      providerTaskId: form.get("providerTaskId"),
      summary: form.get("summary"),
      blocker: form.get("blocker"),
      output: output instanceof File ? output : null,
      ledger: ledger instanceof File ? ledger : null,
      providerCostEvidence,
      progressEvents,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MIMO_WINDOWS_TASK_RESULT_FAILED";
    const status = code === "MIMO_WINDOWS_WORKER_NOT_CONFIGURED" ? 503 : code.includes("NOT_FOUND") ? 404 : /INVALID|REQUIRED|NOT_ACTIVE|MISMATCH|OUTSIDE/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

