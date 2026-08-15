import { stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { dbOne } from "@/lib/auth";
import { taskDownloadsRoot, VideoTaskRecord } from "@/lib/video-tasks";
import { mediaEdgeValidationReason } from "@/lib/media-edge";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const download = request.nextUrl.searchParams.get("download") === "1";
  const validation = mediaEdgeValidationReason(id, request.nextUrl.searchParams.get("exp"), request.nextUrl.searchParams.get("sig"), download);
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(id) || validation) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const task = await dbOne<VideoTaskRecord>("SELECT * FROM video_tasks WHERE id = ? LIMIT 1", [id]);
  if (!task || task.status !== "completed" || !task.output_path) return new NextResponse("Not Found", { status: 404 });
  const root = path.resolve(taskDownloadsRoot(task.id));
  let output = path.resolve(task.output_path);
  if (!output.startsWith(`${root}${path.sep}`)) return new NextResponse("Not Found", { status: 404 });
  try {
    await stat(output);
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
  // Playback prefers the bandwidth-capped stream derivative, then the lossless faststart copy.
  // Downloads must preserve the provider original.
  if (!download && path.extname(output).toLowerCase() === ".mp4") {
    const playbackCandidates = [
      output.replace(/\.mp4$/i, ".stream.mp4"),
      output.replace(/\.mp4$/i, ".playback.mp4"),
    ];
    for (const playback of playbackCandidates) {
      try {
        await stat(playback);
        output = playback;
        break;
      } catch {
        // Try the next playback form before falling back to the original.
      }
    }
  }
  const extension = path.extname(output).toLowerCase();
  return new NextResponse(null, {
    status: 200,
    headers: {
      "x-accel-redirect": `/_niannian_video/${task.id}/downloads/${encodeURIComponent(path.basename(output))}`,
      "content-type": extension === ".mp4" ? "video/mp4" : "application/octet-stream",
      "content-disposition": `${download ? "attachment" : "inline"}; filename=\"niannian-video-${task.id.slice(0, 10)}${extension || ".mp4"}\"`,
      // The URL is HMAC-signed and expires quickly. Cache only the playback
      // derivative so repeat opens can stay at the edge; downloads remain
      // private through the separate authenticated route.
      "cache-control": download ? "private, no-store" : "public, max-age=300, s-maxage=300, immutable",
      ...(download ? {} : { "cdn-cache-control": "public, max-age=300, immutable" }),
      "accept-ranges": "bytes",
      "access-control-allow-origin": "https://sd2.cauai.fun",
      "access-control-allow-headers": "Range, Content-Type",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
