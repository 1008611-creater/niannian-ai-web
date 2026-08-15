import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getProductRouting, setProductRoute, validProductRoute } from "@/lib/product-routing";
import { validVideoChannel } from "@/lib/video-tasks";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  return NextResponse.json({ routing: await getProductRouting() });
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const product = validProductRoute(body.product);
    const channel = body.channel === null ? null : validVideoChannel(body.channel);
    if (!product || (body.channel !== null && !channel)) return NextResponse.json({ error: "PRODUCT_ROUTE_INVALID" }, { status: 400 });
    return NextResponse.json({ routing: await setProductRoute(product, channel) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PRODUCT_ROUTE_UPDATE_FAILED" }, { status: 400 });
  }
}
