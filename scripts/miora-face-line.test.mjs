import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMioraFaceLineReferences } from "./miora-face-line.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Miora face-line adapter stages only a 9093-style service result with source and derived lineage", async () => {
  const source = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), Buffer.alloc(512, 7)]);
  const derived = Buffer.concat([Buffer.from("\xff\xd8\xff"), Buffer.alloc(640, 9)]);
  const server = createServer((request, response) => {
    if (request.url === "/admin/api/face/status") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ready: true }));
      return;
    }
    if (request.url === "/admin/api/face/process" && request.method === "POST") {
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, output_url: "/admin/api/face/output/mock-face.jpg", result: { output_name: "mock-face.jpg", faces_detected: 1 } }));
      });
      return;
    }
    if (request.url === "/admin/api/face/output/mock-face.jpg") {
      response.setHeader("content-type", "image/jpeg");
      response.end(derived);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "niannian-miora-face-line-"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    assert.ok(address && typeof address === "object");
    const sourcePath = path.join(root, "source.png");
    const ledger = path.join(root, "ledger");
    await writeFile(sourcePath, source);
    const result = await prepareMioraFaceLineReferences({
      task: { id: "miora-face-line-test" },
      spec: {
        face_line: { required: true, authorization: "current_miora_task_goal", line_color: "white", line_thickness: 2 },
        output_paths: { ledger },
      },
      references: [{ path: sourcePath, sha256: sha256(source), reference_type: "image", ref_key: "asset_1" }],
      env: { MIORA_FACE_LINE_URL: `http://127.0.0.1:${address.port}/face` },
    });
    assert.equal(result.references.length, 1);
    assert.notEqual(result.references[0].path, sourcePath);
    assert.equal(result.references[0].original_path_before_face_line, sourcePath);
    assert.equal(result.references[0].original_sha256_before_face_line, sha256(source));
    assert.equal(result.references[0].sha256, sha256(derived));
    assert.equal(result.references[0].face_line_preprocessed, true);
    assert.deepEqual(await readFile(result.references[0].path), derived);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.references[0].originalSha256, sha256(source));
    assert.equal(manifest.references[0].derivedSha256, sha256(derived));
    assert.equal(manifest.references[0].facesDetected, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Miora face-line adapter refuses an unapproved preprocessing request", async () => {
  await assert.rejects(
    prepareMioraFaceLineReferences({ task: { id: "x" }, spec: {}, references: [] }),
    /MIORA_FACE_LINE_AUTHORIZATION_REQUIRED/,
  );
});
