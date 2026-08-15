import assert from "node:assert/strict";
import test from "node:test";
import { readVerifiedVideoCosDelivery, signedVideoCosUrl, videoCosConfigured, videoCosObjectKey, videoCosPrefix, videoCosRequired } from "../lib/video-cos.ts";

const env = {
  TENCENT_COS_SECRET_ID: "test-id",
  TENCENT_COS_SECRET_KEY: "test-key",
  TENCENT_COS_BUCKET: "bucket-123",
  TENCENT_COS_REGION: "ap-beijing",
  TENCENT_COS_PREFIX: "video-workbench",
};

test("COS configuration and required mode are explicit", () => {
  assert.equal(videoCosConfigured(env), true);
  assert.equal(videoCosConfigured({ ...env, TENCENT_COS_SECRET_KEY: "" }), false);
  assert.equal(videoCosConfigured({ TENCENT_COS_BUCKET: env.TENCENT_COS_BUCKET, TENCENT_COS_REGION: env.TENCENT_COS_REGION, TENCENT_COS_CVM_ROLE: "true" }), true);
  assert.equal(videoCosRequired({ VIDEO_DELIVERY_COS_REQUIRED: "true" }), true);
  assert.equal(videoCosRequired({ VIDEO_DELIVERY_COS_REQUIRED: "false" }), false);
});

test("object keys stay inside the configured task prefix", () => {
  const sha256 = "a".repeat(64);
  assert.equal(videoCosPrefix(env), "video-workbench");
  assert.equal(videoCosObjectKey({ userId: "user_1", taskId: "task-1", sha256 }, env), `video-workbench/outputs/user_1/task-1/${sha256}.mp4`);
  assert.throws(() => videoCosPrefix({ ...env, TENCENT_COS_PREFIX: "../escape" }), /VIDEO_COS_PREFIX_INVALID/);
  assert.throws(() => videoCosObjectKey({ userId: "../escape", taskId: "task-1", sha256 }, env), /VIDEO_COS_USER_ID_INVALID/);
});

test("only verified scoped delivery metadata is accepted", () => {
  const delivery = {
    provider: "tencent_cos",
    bucket: "bucket-123",
    region: "ap-beijing",
    object_key: `video-workbench/outputs/user/task/${"b".repeat(64)}.mp4`,
    etag: "etag",
    sha256: "b".repeat(64),
    byte_size: 1234,
    content_type: "video/mp4",
    uploaded_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  };
  assert.deepEqual(readVerifiedVideoCosDelivery({ completion_evidence: { cos: delivery } }), delivery);
  assert.equal(readVerifiedVideoCosDelivery({ completion_evidence: { cos: { ...delivery, verified_at: undefined } } }), null);
  assert.equal(readVerifiedVideoCosDelivery({ completion_evidence: { cos: { ...delivery, object_key: "outside/file.mp4" } } }), null);
});

test("playback and download use short-lived signed COS URLs", async () => {
  const delivery = {
    provider: "tencent_cos",
    bucket: env.TENCENT_COS_BUCKET,
    region: env.TENCENT_COS_REGION,
    object_key: `video-workbench/outputs/user/task/${"c".repeat(64)}.mp4`,
    etag: "etag",
    sha256: "c".repeat(64),
    byte_size: 1234,
    content_type: "video/mp4",
    uploaded_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  };
  const playback = await signedVideoCosUrl(delivery, { download: false }, env);
  const download = await signedVideoCosUrl(delivery, { download: true }, env);
  assert.match(playback, /^https:\/\/bucket-123\.cos\.ap-beijing\.myqcloud\.com\//);
  assert.match(playback, /q-signature=/);
  assert.match(playback, /response-content-disposition=inline/);
  assert.match(download, /response-content-disposition=attachment/);

  const edgePlayback = await signedVideoCosUrl(delivery, { download: false }, { ...env, TENCENT_COS_PUBLIC_HOST: "media.sd2.cauai.fun" });
  assert.match(edgePlayback, /^https:\/\/media\.sd2\.cauai\.fun\//);
  assert.match(edgePlayback, /q-signature=/);
  await assert.rejects(
    () => signedVideoCosUrl(delivery, { download: false }, { ...env, TENCENT_COS_PUBLIC_HOST: "https://invalid.example" }),
    /VIDEO_COS_PUBLIC_HOST_INVALID/,
  );
});
