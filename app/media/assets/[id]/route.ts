import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { getOwnedReusableAssetPreview } from "@/lib/video-tasks";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(id)) return NextResponse.json({ error: "ASSET_INVALID" }, { status: 400 });
    const preview = await getOwnedReusableAssetPreview(user.id, id);
    return new NextResponse(preview.file, {
      headers: {
        "content-type": preview.mimeType,
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(preview.name)}`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASSET_PREVIEW_FAILED";
    return NextResponse.json({ error: code }, { status: code === "ASSET_NOT_FOUND" ? 404 : /INVALID|MISMATCH/.test(code) ? 400 : 503 });
  }
}
