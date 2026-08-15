import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { providerDescriptors } from "@/lib/provider-contract";
import { listZiyuModels, ZiyuApiError, ziyuConfigured } from "@/lib/ziyu-api";

export async function GET(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const configured = ziyuConfigured();
  let models: Awaited<ReturnType<typeof listZiyuModels>> = [];
  let state: "ready" | "not_configured" | "unavailable" = configured ? "ready" : "not_configured";
  let error: string | undefined;
  if (configured) {
    try {
      models = await listZiyuModels();
    } catch (cause) {
      state = "unavailable";
      error = cause instanceof ZiyuApiError ? cause.message : "紫域模型目录暂时不可用";
    }
  }
  const clientModels = models.map((model, index) => ({
    ...model,
    name: model.modes.every((mode) => mode === "t2i") ? `图像渠道 ${String(index + 1).padStart(2, "0")}` : `视频渠道 ${String(index + 1).padStart(2, "0")}`,
  }));
  return NextResponse.json({
    providers: providerDescriptors.map((provider) => provider.id === "ziyu" ? { ...provider, label: "智能视频渠道", purpose: "实时可用的视频与图片生成渠道", configured, state, models: clientModels } : provider),
    ziyu: { configured, state, models: clientModels, ...(error ? { error } : {}) },
  });
}
