import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { createVideoTask, listVideoTasks, publicVideoTask } from "@/lib/video-tasks";
import { publicMimoWorkerAvailability } from "@/lib/mimo-windows-worker";
import { getProductRouting, validProductRoute } from "@/lib/product-routing";
import { linkProjectTask, listProjectVideoTasks, ownedProject } from "@/lib/project-workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const projectId = request.nextUrl.searchParams.get("projectId");
    const [tasks, mimoWorker] = await Promise.all([projectId ? listProjectVideoTasks(user.id, projectId) : listVideoTasks(user.id), publicMimoWorkerAvailability()]);
    return NextResponse.json({
      tasks: await Promise.all(tasks.map((task) => publicVideoTask(task, { mimoReadyToClaim: mimoWorker.readyToClaim }))),
      execution: { mimoWorker },
    });
  } catch (error) {
    console.error("VIDEO_TASKS_UNAVAILABLE", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "VIDEO_TASKS_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;
    if (projectId) await ownedProject(user.id, projectId);
    if (!Array.isArray(body.assetIds)) return NextResponse.json({ error: "VIDEO_TASK_INVALID" }, { status: 400 });
    const product = validProductRoute(body.product);
    if (!product) return NextResponse.json({ error: "PRODUCT_INVALID" }, { status: 400 });
    if (product === "image_g") return NextResponse.json({ error: "IMAGE_PRODUCT_NOT_READY" }, { status: 409 });
    const requestedChannel = (await getProductRouting())[product];
    if (!requestedChannel) return NextResponse.json({ error: "PRODUCT_ROUTE_NOT_CONFIGURED" }, { status: 503 });
    const durationSeconds = Number(body.durationSeconds);
    const aspectRatio = String(body.aspectRatio ?? "9:16");
    const model = requestedChannel === "higgsfield"
      ? "Cinematic Studio Video 3.5"
      : requestedChannel === "astorie"
      ? "Seedance 2.0 Mini"
      : process.env.NIANNIAN_VIDEO_MODEL?.trim() || "Seedance 2.0";
    const task = await createVideoTask({
      userId: user.id,
      executionMode: requestedChannel === "higgsfield" || requestedChannel === "miora" ? "server_auto" : "codex_skill",
      channel: requestedChannel,
      serviceMode: "automatic",
      autoSubmitAuthorized: true,
      // AStorie provider credits are read from its authenticated canvas at
      // execution time. Do not reserve an unrelated internal price table.
      chargeCredits: requestedChannel !== "astorie" && requestedChannel !== "higgsfield",
      prompt: String(body.prompt ?? ""),
      model,
      resolution: "720P",
      durationSeconds,
      aspectRatio,
      assetIds: body.assetIds.map(String),
    });
    if (projectId) await linkProjectTask(user.id, projectId, task.id);
    return NextResponse.json({ task: await publicVideoTask(task) }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "VIDEO_TASK_CREATE_FAILED";
    const status = /INVALID|NOT_FOUND|PREFLIGHT|CREDITS|QUOTE|LIMIT|UNSUPPORTED/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
