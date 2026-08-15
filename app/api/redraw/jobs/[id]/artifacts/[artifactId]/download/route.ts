import { createHash } from "node:crypto";
import COS from "cos-nodejs-sdk-v5";
import { NextRequest, NextResponse } from "next/server";
import { authCookie, dbOne, sessionFromToken } from "@/lib/auth";

type Artifact = { id: string; object_key: string; mime_type: string; sha256: string };

function client() {
  if (!process.env.TENCENT_COS_SECRET_ID || !process.env.TENCENT_COS_SECRET_KEY || !process.env.TENCENT_COS_BUCKET || !process.env.TENCENT_COS_REGION) throw new Error("COS_NOT_CONFIGURED");
  return new COS({ SecretId: process.env.TENCENT_COS_SECRET_ID, SecretKey: process.env.TENCENT_COS_SECRET_KEY });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; artifactId: string }> }) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id, artifactId } = await context.params;
  const artifact = await dbOne<Artifact>("SELECT a.id,a.object_key,a.mime_type,a.sha256 FROM redraw_artifacts a JOIN redraw_jobs j ON j.id=a.job_id WHERE a.id=? AND a.job_id=? AND a.user_id=? AND j.status='completed' LIMIT 1", [artifactId, id, user.id]);
  if (!artifact) return NextResponse.json({ error: "REDRAW_ARTIFACT_NOT_FOUND" }, { status: 404 });
  try {
    const data = await new Promise<{ Body?: Buffer }>((resolve, reject) => client().getObject({ Bucket: process.env.TENCENT_COS_BUCKET!, Region: process.env.TENCENT_COS_REGION!, Key: artifact.object_key }, (error, result) => error ? reject(error) : resolve(result as { Body?: Buffer })));
    if (!data.Body) throw new Error("COS_OBJECT_BODY_MISSING");
    const body = Buffer.from(data.Body);
    if (createHash("sha256").update(body).digest("hex") !== artifact.sha256) throw new Error("COS_OBJECT_SHA256_MISMATCH");
    const asDownload = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(body), { headers: { "content-type": artifact.mime_type, "content-length": String(body.length), "x-content-sha256": artifact.sha256, "content-disposition": `${asDownload ? "attachment" : "inline"}; filename=niannian-redraw` } });
  } catch {
    return NextResponse.json({ error: "REDRAW_ARTIFACT_UNAVAILABLE" }, { status: 503 });
  }
}
