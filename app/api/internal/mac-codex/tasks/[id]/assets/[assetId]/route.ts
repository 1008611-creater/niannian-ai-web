import { NextRequest, NextResponse } from "next/server";
import { authorizeMacWorker, getMacTaskAsset } from "@/lib/mac-codex-worker";

export const runtime = "nodejs";

function validId(value: string) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(value);
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    if (!authorizeMacWorker(request.headers.get("authorization"))) {
      return NextResponse.json({ error: "MAC_WORKER_UNAUTHORIZED" }, { status: 401 });
    }
    const { id, assetId } = await context.params;
    if (!validId(id) || !validId(assetId)) return NextResponse.json({ error: "MAC_TASK_ASSET_INVALID" }, { status: 400 });
    const asset = await getMacTaskAsset(id, assetId);
    return new NextResponse(asset.file, {
      headers: {
        "content-type": asset.mimeType || "application/octet-stream",
        "content-length": String(asset.file.byteLength),
        "content-disposition": `attachment; filename="${encodeURIComponent(asset.name)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-content-sha256": asset.sha256,
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAC_TASK_ASSET_UNAVAILABLE";
    const status = code === "MAC_WORKER_NOT_CONFIGURED" ? 503 : code.includes("NOT_FOUND") ? 404 : /INVALID|NOT_ACTIVE|NOT_ALLOWED|HASH/.test(code) ? 409 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
