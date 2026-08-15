import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { createZiyuJob, listZiyuJobs, listZiyuModels, ZiyuApiError } from "@/lib/ziyu-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return NextResponse.json(await listZiyuJobs(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_JOBS_LIST_FAILED" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  if (!(await sessionFromToken(request.cookies.get(authCookie)?.value))) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    const mode = body?.mode;
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!["i2v", "t2v", "t2i"].includes(mode) || !prompt || prompt.length > 10000) return NextResponse.json({ error: "JOB_REQUEST_INVALID" }, { status: 400 });
    if (body.modelId) {
      const model = (await listZiyuModels()).find((item) => item.id === body.modelId);
      if (!model || !model.modes.includes(mode)) return NextResponse.json({ error: "MODEL_MODE_NOT_ALLOWED" }, { status: 400 });
      if (body.duration && model.allowedDurations.length && !model.allowedDurations.includes(Number.parseInt(String(body.duration), 10))) return NextResponse.json({ error: "DURATION_NOT_ALLOWED" }, { status: 400 });
      if (body.ratio && model.allowedRatios.length && !model.allowedRatios.includes(String(body.ratio))) return NextResponse.json({ error: "RATIO_NOT_ALLOWED" }, { status: 400 });
      const requestedAssets = body.assets && typeof body.assets === "object" ? body.assets as Record<string, unknown> : {};
      const assetTypes = ["image", "video", "audio"] as const;
      if (mode === "t2v" && assetTypes.some((type) => Array.isArray(requestedAssets[type]) && requestedAssets[type].length > 0)) {
        return NextResponse.json({ error: "TEXT_TO_VIDEO_DOES_NOT_ACCEPT_ASSETS" }, { status: 400 });
      }
      for (const type of assetTypes) {
        const entries = Array.isArray(requestedAssets[type]) ? requestedAssets[type] : [];
        if (entries.length && !model.allowedAssetTypes.includes(type)) return NextResponse.json({ error: `ASSET_TYPE_NOT_ALLOWED:${type}` }, { status: 400 });
        const limit = model.assetLimits[type];
        if (typeof limit === "number" && entries.length > limit) return NextResponse.json({ error: `ASSET_LIMIT_EXCEEDED:${type}` }, { status: 400 });
      }
    }
    const result = await createZiyuJob({ modelId: typeof body.modelId === "string" ? body.modelId : undefined, mode, prompt, ratio: typeof body.ratio === "string" ? body.ratio : undefined, duration: typeof body.duration === "string" ? body.duration : undefined, assets: body.assets });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const status = error instanceof ZiyuApiError && [400, 402, 403, 429].includes(error.status) ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_JOB_CREATE_FAILED" }, { status });
  }
}
