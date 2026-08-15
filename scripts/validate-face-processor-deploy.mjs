#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

const LOCAL_IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_DIGEST = /^niannian-face-processor@sha256:[a-f0-9]{64}$/;

export function validateImmutableFaceProcessorImageReference(value) {
  const reference = String(value || "");
  if (!LOCAL_IMAGE_ID.test(reference) && !REPOSITORY_DIGEST.test(reference)) {
    throw new Error("FACE_PROCESSOR_IMAGE_REFERENCE_INVALID");
  }
  return reference;
}

// Kept as an export for callers written before local content-addressed image
// IDs were permitted. It now validates either accepted immutable form.
export function validateImmutableFaceProcessorDigest(value) {
  try {
    return validateImmutableFaceProcessorImageReference(value);
  } catch {
    throw new Error("FACE_PROCESSOR_IMAGE_DIGEST_INVALID");
  }
}

export async function validateFaceProcessorDeploymentCandidate({ imageReference = process.env.FACE_PROCESSOR_IMAGE_REFERENCE } = {}) {
  const resolvedImageReference = validateImmutableFaceProcessorImageReference(imageReference);
  const compose = await readFile(path.join(root, "deploy", "face-processor-app-override.yml"), "utf8");
  if (!compose.includes("image: ${FACE_PROCESSOR_IMAGE_REFERENCE:?FACE_PROCESSOR_IMAGE_REFERENCE must be an immutable image content address}")) throw new Error("FACE_PROCESSOR_IMAGE_REFERENCE_CONTRACT_INVALID");
  if (/\n\s*ports:\s*[\s\S]*9093/.test(compose) || !compose.includes("internal: true")) throw new Error("FACE_PROCESSOR_NETWORK_CONTRACT_INVALID");
  if (/FACE_PROCESSOR_TOKEN:/.test(compose) || !compose.includes("FACE_PROCESSOR_TOKEN_FILE: /run/secrets/face_processor_token")) throw new Error("FACE_PROCESSOR_SECRET_CONTRACT_INVALID");
  if (!compose.includes('FACE_PROCESSOR_ENABLED: "false"')) throw new Error("FACE_PROCESSOR_DISABLED_FLAG_REQUIRED");
  return {
    ok: true,
    image: resolvedImageReference,
    imageIdentityType: LOCAL_IMAGE_ID.test(resolvedImageReference) ? "local_image_id" : "repository_digest",
    publicPort9093: false,
    secretMode: "file_only",
    processingEnabled: false,
    rollbackEvidenceRequired: [
      "pre_release_compose_sha256",
      "prior_app_container_id",
      "prior_app_image_id",
      "prior_face_processor_image_reference_or_absent",
      "released_face_processor_image_reference",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateFaceProcessorDeploymentCandidate().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; },
  );
}
