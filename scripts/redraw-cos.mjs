export function cosClientOptions(env = process.env) {
  for (const name of ["TENCENT_COS_SECRET_ID", "TENCENT_COS_SECRET_KEY", "TENCENT_COS_BUCKET", "TENCENT_COS_REGION"]) {
    if (!env[name]) throw new Error("COS_NOT_CONFIGURED");
  }
  return {
    SecretId: env.TENCENT_COS_SECRET_ID,
    SecretKey: env.TENCENT_COS_SECRET_KEY,
    ...(env.TENCENT_COS_SECURITY_TOKEN ? { SecurityToken: env.TENCENT_COS_SECURITY_TOKEN } : {}),
  };
}

export function redrawCosKey({ userId, jobId, artifactId, extension }, env = process.env) {
  const prefix = String(env.TENCENT_COS_PREFIX || "redraw").trim().replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("COS_PREFIX_INVALID");
  for (const value of [userId, jobId, artifactId, extension]) {
    if (typeof value !== "string" || !value || /[\\/\\\\]/.test(value)) throw new Error("COS_OBJECT_KEY_INVALID");
  }
  return `${prefix}/${userId}/${jobId}/${artifactId}.${extension}`;
}
