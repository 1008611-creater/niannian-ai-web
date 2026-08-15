import { createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";

export const runtime = "nodejs";

function secret() {
  const value = process.env.NIANNIAN_EDITOR_SSO_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function editorOrigin() {
  return (process.env.NIANNIAN_EDITOR_ORIGIN?.trim() || "https://edit.cauai.fun").replace(/\/+$/, "");
}

function allowedReturnTo(value: string | null) {
  const fallback = `${editorOrigin()}/`;
  if (!value) return fallback;
  try {
    const target = new URL(value, fallback);
    const allowed = new URL(editorOrigin());
    return target.origin === allowed.origin && target.pathname.startsWith("/") ? target.toString() : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const signingSecret = secret();
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value).catch(() => null);
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/api/editor/sso")}`, request.url));
  if (!signingSecret) return NextResponse.json({ error: "EDITOR_SSO_NOT_CONFIGURED" }, { status: 503 });
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    userId: user.id,
    email: user.email,
    exp: Date.now() + 2 * 60 * 1000,
    nonce: randomBytes(12).toString("hex"),
  })).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(payload).digest("hex");
  const returnTo = allowedReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const target = new URL("/api/niannian-auth/exchange", editorOrigin());
  target.searchParams.set("ticket", `${payload}.${signature}`);
  target.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(target);
}
