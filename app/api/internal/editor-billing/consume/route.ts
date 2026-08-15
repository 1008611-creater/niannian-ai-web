import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { consumeEditorCredits } from "@/lib/credits";

export const runtime = "nodejs";

function secret() {
  const value = process.env.NIANNIAN_EDITOR_SSO_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function validSignature(raw: Buffer, provided: string | null) {
  const signingSecret = secret();
  if (!signingSecret || !provided || !/^[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = Buffer.from(createHmac("sha256", signingSecret).update(raw).digest("hex"), "hex");
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: NextRequest) {
  const raw = Buffer.from(await request.arrayBuffer());
  if (!validSignature(raw, request.headers.get("x-niannian-editor-signature"))) {
    return NextResponse.json({ error: "EDITOR_BILLING_UNAUTHORIZED" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "EDITOR_CREDIT_REQUEST_INVALID" }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
  const step = typeof body.step === "string" ? body.step.trim() : "";
  const credits = Number(body.credits);
  if (!userId || !operationId || !step || !Number.isInteger(credits) || credits < 0 || credits > 100000) {
    return NextResponse.json({ error: "EDITOR_CREDIT_REQUEST_INVALID" }, { status: 400 });
  }
  try {
    const result = await consumeEditorCredits({ userId, operationId, step, credits });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EDITOR_BILLING_FAILED";
    return NextResponse.json({ error: code === "CREDITS_INSUFFICIENT" ? "CREDITS_INSUFFICIENT" : "EDITOR_BILLING_FAILED" }, { status: code === "CREDITS_INSUFFICIENT" ? 402 : 409 });
  }
}
