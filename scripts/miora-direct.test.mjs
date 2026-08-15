import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mioraDirectConfigured, runMioraDirectTask } from "./miora-direct.mjs";

test("Miora direct runner refuses an unauthorized spec before opening CDP", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "niannian-miora-direct-"));
  try {
    const referencePath = path.join(temporary, "reference.png");
    const reference = Buffer.from("reference-bytes");
    await writeFile(referencePath, reference);
    const prompt = "人物自然回头，镜头缓慢推进，保持场景和服装一致。";
    const spec = {
      prompt,
      prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
      references: [{ path: referencePath, sha256: createHash("sha256").update(reference).digest("hex"), actual_video_input: true, upload_eligible: true }],
      allowed_channels: ["miora"],
      submit_allowed: false,
      cost_gate: { authorized: false },
    };
    assert.equal(mioraDirectConfigured({ MIORA_CDP_URL: "http://127.0.0.1:9415" }), true);
    await assert.rejects(
      runMioraDirectTask({ task: { resolution: "720P", duration_seconds: 15, provider_task_id: null }, spec }),
      /MIORA_SUBMIT_NOT_AUTHORIZED/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Miora direct adapter locks the verified canvas UI path", async () => {
  const source = await readFile(new URL("./miora-direct.mjs", import.meta.url), "utf8");
  assert.match(source, /\[aria-label="视频容器"\]/);
  assert.match(source, /portal-generator-dialog/);
  assert.match(source, /从本地上传图片/);
  assert.match(source, /button:has\(svg\.arrow-run\)/);
  assert.match(source, /\/api\/ai\/media-generate\/video/);
  assert.match(source, /\/api\/ai\/media-generate\/progress/);
  assert.match(source, /prepareMioraFaceLineReferences/);
  assert.match(source, /MIORA_CREDITS_NOT_AVAILABLE/);
  assert.match(source, /await page\.evaluate\(installRecorder\)/);
  assert.match(source, /disconnectMioraCdp/);
  assert.doesNotMatch(source, /finally\s*\{\s*await browser\.close\(\)/);
  assert.doesNotMatch(source, /\.model-select-btn/);
});
