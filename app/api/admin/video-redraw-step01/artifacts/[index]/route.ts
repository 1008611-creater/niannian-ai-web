import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { readStep01Manifest, verifyStep01Artifact } from "@/lib/video-redraw-step01";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ index: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const index = Number((await context.params).index);
  const result = await readStep01Manifest();
  if (!result.valid || !Number.isInteger(index) || index < 0 || index >= result.manifest.artifacts.length) return NextResponse.json({ error: "STEP01_ARTIFACT_NOT_FOUND" }, { status: 404 });
  const artifact = result.manifest.artifacts[index];
  if (!(await verifyStep01Artifact(artifact))) return NextResponse.json({ error: "STEP01_ARTIFACT_VERIFICATION_FAILED" }, { status: 409 });
  const content = await readFile(artifact.path);
  return new NextResponse(content, { headers: { "content-type": artifact.mimeType, "content-length": String(content.length), "cache-control": "private, no-store" } });
}
