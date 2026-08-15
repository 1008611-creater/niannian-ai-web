import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { findOwnedVideoTask, hasDeliverableOutput, taskDownloadsRoot } from "@/lib/video-tasks";
import { readVerifiedVideoCosDelivery, signedVideoCosUrl } from "@/lib/video-cos";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
};

function validTaskId(value: string) {
  return /^[A-Za-z0-9_-]{12,120}$/.test(value);
}

function byteRange(value: string | null, size: number) {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return "invalid" as const;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return "invalid" as const;
  if (!startRaw) {
    const length = Number(endRaw);
    if (!Number.isInteger(length) || length <= 0) return "invalid" as const;
    return { start: Math.max(size - length, 0), end: size - 1 };
  }
  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return "invalid" as const;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { id } = await context.params;
    if (!validTaskId(id)) return NextResponse.json({ error: "VIDEO_TASK_INVALID" }, { status: 400 });
    const task = await findOwnedVideoTask(user.id, id);
    if (!task) return NextResponse.json({ error: "VIDEO_TASK_NOT_FOUND" }, { status: 404 });
    if (!(await hasDeliverableOutput(task)) || !task.output_path) {
      return NextResponse.json({ error: "OUTPUT_NOT_READY" }, { status: 409 });
    }

    const spec = JSON.parse(await readFile(task.task_spec_path, "utf8")) as Record<string, unknown>;
    const cosDelivery = readVerifiedVideoCosDelivery(spec);
    if (cosDelivery) {
      const url = await signedVideoCosUrl(cosDelivery, { download: request.nextUrl.searchParams.get("download") === "1" });
      return NextResponse.redirect(url, 307);
    }

    const downloadsRoot = path.resolve(taskDownloadsRoot(task.id));
    const outputPath = path.resolve(task.output_path);
    if (!outputPath.startsWith(`${downloadsRoot}${path.sep}`)) {
      return NextResponse.json({ error: "OUTPUT_PATH_INVALID" }, { status: 409 });
    }
    const info = await stat(outputPath);
    const range = byteRange(request.headers.get("range"), info.size);
    if (range === "invalid") {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${info.size}`, "cache-control": "private, no-store" } });
    }
    const extension = path.extname(outputPath).toLowerCase();
    const fileName = `niannian-video-${task.id.slice(0, 10)}${extension || ".mp4"}`;
    const asDownload = request.nextUrl.searchParams.get("download") === "1";
    // Nginx adds this trusted request header on production. Authorization has
    // already completed above; delegating only the verified local file lets
    // Nginx serve Range requests with sendfile instead of streaming MP4 bytes
    // through the Next.js process.
    if (request.headers.get("x-niannian-accel") === "1") {
      const internalPath = `/_niannian_video/${task.id}/downloads/${encodeURIComponent(path.basename(outputPath))}`;
      return new NextResponse(null, {
        status: 200,
        headers: {
          "x-accel-redirect": internalPath,
          "content-type": contentTypes[extension] ?? "application/octet-stream",
          "content-disposition": `${asDownload ? "attachment" : "inline"}; filename=\"${fileName}\"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const contentLength = range ? range.end - range.start + 1 : info.size;
    const body = Readable.toWeb(createReadStream(outputPath, range ? { start: range.start, end: range.end } : undefined)) as ReadableStream<Uint8Array>;

    return new NextResponse(body, {
      status: range ? 206 : 200,
      headers: {
        "content-type": contentTypes[extension] ?? "application/octet-stream",
        "content-length": String(contentLength),
        "content-disposition": `${asDownload ? "attachment" : "inline"}; filename=\"${fileName}\"`,
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${info.size}` } : {}),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "OUTPUT_UNAVAILABLE" }, { status: 503 });
  }
}
