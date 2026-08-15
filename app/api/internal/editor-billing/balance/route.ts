import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCreditSummary } from "@/lib/credits";

export const runtime = "nodejs";

function secret() {
  const value = process.env.NIANNIAN_EDITOR_SSO_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function validSignature(userId: string, provided: string | null) {
  const signingSecret = secret();
  if (!signingSecret || !provided || !/^[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = Buffer.from(createHmac("sha256", signingSecret).update(userId).digest("hex"), "hex");
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")?.trim() || "";
  if (!userId || !validSignature(userId, request.headers.get("x-niannian-editor-signature"))) {
    return NextResponse.json({ error: "EDITOR_BILLING_UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const summary = await getCreditSummary(userId);
    return NextResponse.json({ balance: summary.balance }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "EDITOR_BILLING_FAILED" }, { status: 409 });
  }
}
