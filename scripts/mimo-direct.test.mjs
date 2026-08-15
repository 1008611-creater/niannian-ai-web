import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mimoDirectConfigured, runMimoDirectTask, selectMimoUploadReferences } from "./mimo-direct.mjs";

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test("Mimo direct runner submits mixed references then holds downloaded output for QA", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-mimo-direct-"));
  let uploadCount = 0;
  let submitted = null;
  const mock = await listen(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/api/auth/login") return response.end(JSON.stringify({ code: 200, data: { token: "mock-token", credits: 8 } }));
    if (url.pathname === "/api/video/upload") {
      uploadCount += 1;
      return response.end(JSON.stringify({ code: 200, data: uploadCount === 1 ? { imageUri: "image://one", imageUrl: "https://image.example/one" } : { vid: "video://two" } }));
    }
    if (url.pathname === "/api/video/generate") {
      submitted = JSON.parse(body);
      return response.end(JSON.stringify({ code: 200, data: { id: "provider-task-1" } }));
    }
    if (url.pathname === "/api/video/batch-status") {
      return response.end(JSON.stringify({ code: 200, data: [{ taskId: "provider-task-1", status: 1, videoUrl: `${mock.base}/video.mp4` }] }));
    }
    if (url.pathname === "/api/video/proxy-token") return response.end(JSON.stringify({ code: 200, data: { token: "unused" } }));
    if (url.pathname === "/api/video/proxy-video") {
      response.setHeader("content-type", "video/mp4");
      return response.end(Buffer.from("mock-video"));
    }
    if (url.pathname === "/video.mp4") {
      response.setHeader("content-type", "video/mp4");
      return response.end(Buffer.from("mock-video"));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: 404 }));
  });
  try {
    const imagePath = path.join(temporary, "first-frame.png");
    const videoPath = path.join(temporary, "motion.mp4");
    await writeFile(imagePath, "image");
    await writeFile(videoPath, "video");
    const spec = {
      task_id: "task-1",
      prompt: "一名人物在室内自然移动，保持服装和场景一致。",
      prompt_sha256: "prompt-sha",
      duration: "5s",
      aspect_ratio: "16:9",
      references: [
        { path: imagePath, role: "video_first_frame_anchor", chinese_duty: "人物首帧", actual_video_input: true },
        { path: videoPath, role: "support_asset_ref", chinese_duty: "动作参考", actual_video_input: true },
      ],
      output_paths: {
        events: path.join(temporary, "events"),
        downloads: path.join(temporary, "downloads"),
        ledger: path.join(temporary, "ledger"),
      },
    };
    const env = { MIMO_BASE_URL: mock.base, MIMO_USERNAME: "demo", MIMO_PASSWORD: "secret" };
    assert.equal(mimoDirectConfigured(env), true);
    const submittedResult = await runMimoDirectTask({ task: { id: "task-1", provider_task_id: null }, spec, env, probe: async () => 5.01 });
    assert.equal(submittedResult.status, "running");
    assert.equal(submittedResult.providerTaskId, "provider-task-1");
    assert.equal(uploadCount, 2);
    assert.equal(submitted.images.length, 1);
    assert.equal(submitted.videos.length, 1);
    const completedResult = await runMimoDirectTask({ task: { id: "task-1", provider_task_id: "provider-task-1" }, spec, env, probe: async () => 5.01 });
    assert.equal(completedResult.status, "blocked");
    assert.equal(completedResult.blocker, "awaiting_content_qa");
    assert.equal(completedResult.mediaProbePassed, true);
    assert.equal(await readFile(completedResult.outputPath, "utf8"), "mock-video");
    assert.equal(JSON.parse(await readFile(completedResult.ledgerPath, "utf8")).contentQa, "pending_admin_review");
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Mimo selection keeps all authority references but uploads only the planned twelve", () => {
  const references = Array.from({ length: 14 }, (_, index) => ({
    ref_key: `reference-${index + 1}`,
    actual_video_input: true,
    upload_eligible: true,
    user_confirmation: "confirmed",
  }));
  const selected = selectMimoUploadReferences({
    references,
    channel_reference_plan: {
      mimo: {
        channel: "mimo",
        max_upload_references: 12,
        selections: references.map((reference, index) => ({ ref_key: reference.ref_key, selected: index < 12 })),
      },
    },
  });
  assert.equal(references.length, 14);
  assert.equal(selected.length, 12);
  assert.deepEqual(selected.map((reference) => reference.ref_key), references.slice(0, 12).map((reference) => reference.ref_key));
});
