import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { uploadZiyuAssets } from "@/lib/ziyu-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  if (!(await sessionFromToken(request.cookies.get(authCookie)?.value))) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body?.files) || body.files.length < 1 || body.files.length > 10) return NextResponse.json({ error: "FILES_INVALID" }, { status: 400 });
    const files = body.files.map((file: Record<string, unknown>) => ({ type: file.type, name: file.name, data: file.data }));
    if (files.some((file: { type: unknown; name: unknown; data: unknown }) => !["image", "video", "audio"].includes(String(file.type)) || typeof file.name !== "string" || typeof file.data !== "string" || !String(file.data).startsWith("data:"))) return NextResponse.json({ error: "FILE_FORMAT_INVALID" }, { status: 400 });
    return NextResponse.json({ assets: await uploadZiyuAssets(files as Array<{ type: "image" | "video" | "audio"; name: string; data: string }>) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_UPLOAD_FAILED" }, { status: 502 });
  }
}
