import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateFaceProcessorDeploymentCandidate, validateImmutableFaceProcessorDigest, validateImmutableFaceProcessorImageReference } from "./validate-face-processor-deploy.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("private processor compose topology exposes no public 9093 and attaches only app to the private network", async () => {
  const compose = await readFile(path.join(root, "deploy", "face-processor-app-override.yml"), "utf8");
  assert.match(compose, /niannian-face-processor:/);
  assert.doesNotMatch(compose, /app:\n\s+depends_on:/);
  assert.doesNotMatch(compose, /ports:\s*[\s\S]*9093/);
  assert.match(compose, /image: \$\{FACE_PROCESSOR_IMAGE_REFERENCE:\?FACE_PROCESSOR_IMAGE_REFERENCE must be an immutable image content address\}/);
  assert.match(compose, /FACE_PROCESSOR_URL: http:\/\/niannian-face-processor:9093\/face/);
  assert.doesNotMatch(compose, /FACE_PROCESSOR_TOKEN:/);
  assert.match(compose, /face-private:\n\s+internal: true/);
  assert.match(compose, /app:[\s\S]*?networks:\n\s+- default\n\s+- face-private/);
  const processor = compose.slice(compose.lastIndexOf("\n  niannian-face-processor:"), compose.indexOf("\nsecrets:\n"));
  assert.match(processor, /networks:\n\s+- face-private/);
  assert.doesNotMatch(processor, /- default/);
});

test("bridge client accepts only the designated private processor and a secret file", async () => {
  const [client, readme] = await Promise.all([
    readFile(path.join(root, "lib", "private-face-processor.mjs"), "utf8"),
    readFile(path.join(root, "services", "face-processor", "README.md"), "utf8"),
  ]);
  assert.match(client, /url\.hostname === "niannian-face-processor"/);
  assert.match(client, /FACE_PROCESSOR_TOKEN_FILE/);
  assert.match(client, /FACE_PROCESSOR_TOKEN_ENV_FORBIDDEN/);
  assert.match(client, /readFile\(tokenFile, "utf8"\)/);
  assert.doesNotMatch(client, /https:\/\//);
  assert.match(readme, /FACE_PROCESSOR_TOKEN_FILE/);
  assert.match(readme, /FACE_PROCESSOR_TOKEN` is rejected/);
  assert.match(readme, /--mount type=bind,src=\/etc\/niannian-ai\/face_processor_token,dst=\/run\/secrets\/face_processor_token,readonly/);
  assert.match(readme, /-e FACE_PROCESSOR_TOKEN_FILE=\/run\/secrets\/face_processor_token/);
  assert.doesNotMatch(readme, /`FACE_PROCESSOR_TOKEN` or/);
});

test("local deployment validator accepts only immutable repository digests or local image IDs", () => {
  assert.equal(validateImmutableFaceProcessorDigest(`sha256:${"a".repeat(64)}`), `sha256:${"a".repeat(64)}`);
  assert.equal(validateImmutableFaceProcessorImageReference(`niannian-face-processor@sha256:${"b".repeat(64)}`), `niannian-face-processor@sha256:${"b".repeat(64)}`);
  for (const invalid of ["", "niannian-face-processor:latest", "niannian-face-processor:face-white-2px-v1", `sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(63)}`, `other@sha256:${"b".repeat(64)}`]) {
    assert.throws(() => validateImmutableFaceProcessorDigest(invalid), /FACE_PROCESSOR_IMAGE_DIGEST_INVALID/);
    assert.throws(() => validateImmutableFaceProcessorImageReference(invalid), /FACE_PROCESSOR_IMAGE_REFERENCE_INVALID/);
  }
});

test("candidate reports immutable local image identity and required rollback evidence", async () => {
  const imageReference = `sha256:${"c".repeat(64)}`;
  const result = await validateFaceProcessorDeploymentCandidate({ imageReference });
  assert.equal(result.image, imageReference);
  assert.equal(result.imageIdentityType, "local_image_id");
  assert.deepEqual(result.rollbackEvidenceRequired, [
    "pre_release_compose_sha256",
    "prior_app_container_id",
    "prior_app_image_id",
    "prior_face_processor_image_reference_or_absent",
    "released_face_processor_image_reference",
  ]);
});

test("candidate starts health-only and the processor refuses work until explicitly enabled", async () => {
  const [compose, service] = await Promise.all([
    readFile(path.join(root, "deploy", "face-processor-app-override.yml"), "utf8"),
    readFile(path.join(root, "services", "face-processor", "service.py"), "utf8"),
  ]);
  assert.match(compose, /FACE_PROCESSOR_ENABLED: "false"/);
  assert.match(service, /PROCESSING_ENABLED = os\.environ\.get\("FACE_PROCESSOR_ENABLED", "false"\)\.lower\(\) == "true"/);
  const disabledGate = service.indexOf('if not PROCESSING_ENABLED:');
  const bodyRead = service.indexOf('source = self.rfile.read(length)');
  assert.ok(disabledGate >= 0, "service must reject /face while disabled");
  assert.ok(bodyRead >= 0 && disabledGate < bodyRead, "disabled gate must precede image-byte reads");
  assert.match(service, /self\.send_json\(503, \{"error": "PROCESSING_DISABLED"\}\)/);
  assert.match(service, /if self\.path == "\/healthz":/);
  assert.match(service, /if self\.path == "\/readyz":/);
});

test("processor reads a file-only root secret during bootstrap then drops privileges before serving", async () => {
  const [compose, dockerfile, service] = await Promise.all([
    readFile(path.join(root, "deploy", "face-processor-app-override.yml"), "utf8"),
    readFile(path.join(root, "services", "face-processor", "Dockerfile"), "utf8"),
    readFile(path.join(root, "services", "face-processor", "service.py"), "utf8"),
  ]);
  assert.match(compose, /user: "0:0"/);
  assert.match(dockerfile, /USER root:root/);
  assert.doesNotMatch(compose, /FACE_PROCESSOR_TOKEN:/);
  assert.match(service, /FACE_PROCESSOR_TOKEN_ENV_FORBIDDEN/);
  assert.match(service, /def drop_privileges_after_secret_bootstrap\(\) -> None:/);
  assert.match(service, /os\.setgroups\(\[\]\)/);
  assert.match(service, /os\.setgid\(RUNTIME_GID\)/);
  assert.match(service, /os\.setuid\(RUNTIME_UID\)/);
  const tokenRead = service.indexOf('TOKEN = Path(TOKEN_FILE).read_text');
  const privilegeDrop = service.lastIndexOf('drop_privileges_after_secret_bootstrap()');
  const serverStart = service.indexOf('server = ThreadingHTTPServer');
  assert.ok(tokenRead >= 0 && tokenRead < privilegeDrop, "secret must be read before dropping privileges");
  assert.ok(privilegeDrop >= 0 && privilegeDrop < serverStart, "privileges must be dropped before serving HTTP");
});
