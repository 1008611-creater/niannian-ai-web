import { NextRequest, NextResponse } from "next/server";
import { acceptAStorieTaskResult, authorizeAStorieWorker } from "@/lib/astorie-windows-worker";
export const runtime = "nodejs";
function validId(value: string) { return /^[A-Za-z0-9_-]{12,120}$/.test(value); }
function json(value: FormDataEntryValue | null) { try { return JSON.parse(String(value || "null")); } catch { return null; } }
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!authorizeAStorieWorker(request.headers.get("authorization"))) return NextResponse.json({ error: "ASTORIE_WORKER_UNAUTHORIZED" }, { status: 401 });
    const { id } = await context.params;
    if (!validId(id)) return NextResponse.json({ error: "ASTORIE_WINDOWS_TASK_INVALID" }, { status: 400 });
    const form = await request.formData(); const output = form.get("output"); const ledger = form.get("ledger");
    const result = await acceptAStorieTaskResult({ taskId: id, workerId: form.get("workerId"), status: form.get("status"), providerTaskId: form.get("providerTaskId"), summary: form.get("summary"), blocker: form.get("blocker"), receipt: json(form.get("receipt")), mediaSpec: json(form.get("mediaSpec")), output: output instanceof File ? output : null, ledger: ledger instanceof File ? ledger : null });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASTORIE_WINDOWS_TASK_RESULT_FAILED";
    return NextResponse.json({ error: code }, { status: /INVALID|REQUIRED|NOT_ACTIVE|MISMATCH/.test(code) ? 400 : 503 });
  }
}
