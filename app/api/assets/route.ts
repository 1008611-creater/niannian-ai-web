import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { getOwnedReusableAssetPreview, listReusableImageAssets, saveUploadedAsset, setOwnedReusableAssetHidden, validAssetRole, validReferenceIntent } from "@/lib/video-tasks";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const assetId = request.nextUrl.searchParams.get("id");
    if (assetId) {
      if (!/^[A-Za-z0-9_-]{12,120}$/.test(assetId)) return NextResponse.json({ error: "ASSET_INVALID" }, { status: 400 });
      const preview = await getOwnedReusableAssetPreview(user.id, assetId);
      return new NextResponse(preview.file, { headers: { "content-type": preview.mimeType, "cache-control": "private, max-age=300", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(preview.name)}`, "x-content-type-options": "nosniff" } });
    }
    return NextResponse.json({ assets: await listReusableImageAssets(user.id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASSETS_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "ASSET_NOT_FOUND" ? 404 : /INVALID|MISMATCH/.test(code) ? 400 : 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const assetId = String(body.assetId ?? "");
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(assetId) || typeof body.hidden !== "boolean") return NextResponse.json({ error: "ASSET_VISIBILITY_INVALID" }, { status: 400 });
    return NextResponse.json({ asset: await setOwnedReusableAssetHidden(user.id, assetId, body.hidden) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASSET_VISIBILITY_FAILED";
    return NextResponse.json({ error: code }, { status: code === "ASSET_NOT_FOUND" ? 404 : /INVALID/.test(code) ? 400 : 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const form = await request.formData();
    const role = validAssetRole(form.get("role"));
    const referenceIntent = validReferenceIntent(form.get("referenceIntent"));
    const file = form.get("file");
    if (!role || !(file instanceof File)) return NextResponse.json({ error: "ASSET_INVALID" }, { status: 400 });
    if (form.get("referenceIntent") && !referenceIntent) return NextResponse.json({ error: "REFERENCE_INTENT_INVALID" }, { status: 400 });
    const isPrimary = form.get("isPrimary") === "true";
    const sortOrder = Number(form.get("sortOrder") ?? 0);
    const duty = String(form.get("duty") ?? "");
    return NextResponse.json({ asset: await saveUploadedAsset(user.id, role, file, { referenceIntent, isPrimary, sortOrder, duty }) }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASSET_UPLOAD_FAILED";
    const status = code.startsWith("ASSET_") ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
