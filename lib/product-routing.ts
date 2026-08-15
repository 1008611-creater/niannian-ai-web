import { dbAll, dbRun, timestamp } from "@/lib/auth";
import { VideoChannel, validVideoChannel } from "@/lib/video-tasks";

export const productRoutes = ["video_s", "video_smini", "image_g"] as const;
export type ProductRoute = (typeof productRoutes)[number];

export const productLabels: Record<ProductRoute, string> = {
  video_s: "全能视频 S",
  video_smini: "全能视频 Smini",
  image_g: "全能图片 G",
};

const defaults: Record<ProductRoute, VideoChannel | null> = {
  video_s: "mimo",
  video_smini: "astorie",
  image_g: null,
};

export function validProductRoute(value: unknown): ProductRoute | null {
  return typeof value === "string" && productRoutes.includes(value as ProductRoute) ? value as ProductRoute : null;
}

export type ProductRouting = Record<ProductRoute, VideoChannel | null>;

export async function getProductRouting(): Promise<ProductRouting> {
  const rows = await dbAll<{ product_code: string; channel: string | null }>(
    "SELECT product_code, channel FROM product_routing",
  );
  const routing: ProductRouting = { ...defaults };
  for (const row of rows) {
    const product = validProductRoute(row.product_code);
    const channel = validVideoChannel(row.channel);
    if (product) routing[product] = channel;
  }
  return routing;
}

export async function setProductRoute(product: ProductRoute, channel: VideoChannel | null) {
  if (product === "image_g" && channel !== null) throw new Error("IMAGE_PRODUCT_CHANNEL_UNAVAILABLE");
  if (product !== "image_g" && !channel) throw new Error("PRODUCT_CHANNEL_REQUIRED");
  const updatedAt = timestamp();
  await dbRun(
    "INSERT INTO product_routing (product_code, channel, updated_at) VALUES (?, ?, ?) ON CONFLICT(product_code) DO UPDATE SET channel = excluded.channel, updated_at = excluded.updated_at",
    [product, channel, updatedAt],
  );
  return getProductRouting();
}
