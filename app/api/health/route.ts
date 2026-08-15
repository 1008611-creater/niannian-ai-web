import { NextResponse } from "next/server";
import { releaseIdentity } from "@/lib/release-version";

export function GET() {
  return NextResponse.json({
    status: "ok",
    app: "niannian-ai-video-workbench",
    release: releaseIdentity,
    providers: "admin-only",
  });
}
