import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { linkProjectAsset, listProjectAssets, ownedProject } from "@/lib/project-workspace";
import { saveUploadedAsset, validAssetRole, validReferenceIntent } from "@/lib/video-tasks";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ assets: await listProjectAssets(user.id, id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROJECT_ASSETS_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "PROJECT_NOT_FOUND" ? 404 : 503 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try {
    await ownedProject(user.id, id);
    const form = await request.formData();
    const role = validAssetRole(form.get("role"));
    const file = form.get("file");
    const referenceIntent = validReferenceIntent(form.get("referenceIntent"));
    if (!role || !(file instanceof File)) throw new Error("ASSET_INVALID");
    if (form.get("referenceIntent") && !referenceIntent) throw new Error("REFERENCE_INTENT_INVALID");
    const asset = await saveUploadedAsset(user.id, role, file, {
      referenceIntent,
      isPrimary: form.get("isPrimary") === "true",
      sortOrder: Number(form.get("sortOrder") ?? 0),
      duty: String(form.get("duty") ?? ""),
    });
    await linkProjectAsset(user.id, id, asset.id);
    return NextResponse.json({ asset: { ...asset, previewUrl: `/api/assets?id=${encodeURIComponent(asset.id)}` } }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROJECT_ASSET_UPLOAD_FAILED";
    return NextResponse.json({ error: code }, { status: code.startsWith("ASSET_") || code === "REFERENCE_INTENT_INVALID" ? 400 : code === "PROJECT_NOT_FOUND" ? 404 : 503 });
  }
}
