import assert from "node:assert/strict";
import test from "node:test";
import { runLegacyMimoDeliveryBackfill } from "../lib/legacy-mimo-delivery-backfill.mjs";

function recorder() {
  const events = [];
  return { events, recordStage: async (event) => { events.push(event); } };
}

test("legacy Mimo backfill records every validated delivery stage without any submit operation", async () => {
  const { events, recordStage } = recorder();
  const result = await runLegacyMimoDeliveryBackfill({
    recordStage,
    validateOutputPath: async () => {},
    validateLedger: async () => {},
    probeAndValidate: async () => ({ probedDuration: 5.04, durationTolerance: 1 }),
    uploadAndVerify: async (onStage) => {
      await onStage("upload", { byteSize: 1234, sha256: "a".repeat(64) });
      await onStage("verify", { byteSize: 1234, sha256: "a".repeat(64) });
      return { object_key: "video-workbench/outputs/user/task/file.mp4" };
    },
  });
  assert.equal(result.evidence.probedDuration, 5.04);
  assert.deepEqual(events.map((event) => `${event.stage}:${event.outcome}`), [
    "validate_output_path:succeeded",
    "validate_ledger:succeeded",
    "ffprobe:succeeded",
    "cos_upload:succeeded",
    "cos_verify:succeeded",
  ]);
  assert.equal(events.some((event) => event.stage === "provider_submit"), false);
});

test("legacy Mimo backfill persists one safe diagnostic at the first failed validation stage", async () => {
  const { events, recordStage } = recorder();
  let uploadCalled = false;
  await assert.rejects(
    () => runLegacyMimoDeliveryBackfill({
      recordStage,
      validateOutputPath: async () => {},
      validateLedger: async () => { throw new Error("LEDGER_FILE_NOT_FOUND:/private/path/should-not-leak"); },
      probeAndValidate: async () => ({ probedDuration: 5, durationTolerance: 1 }),
      uploadAndVerify: async () => { uploadCalled = true; return null; },
    }),
    /LEDGER_FILE_NOT_FOUND/,
  );
  assert.equal(uploadCalled, false);
  assert.deepEqual(events, [
    { stage: "validate_output_path", outcome: "succeeded" },
    { stage: "validate_ledger", outcome: "failed", code: "LEDGER_FILE_NOT_FOUND" },
  ]);
});

test("COS verification failures are attributable to verification after a successful upload", async () => {
  const { events, recordStage } = recorder();
  await assert.rejects(
    () => runLegacyMimoDeliveryBackfill({
      recordStage,
      validateOutputPath: async () => {},
      validateLedger: async () => {},
      probeAndValidate: async () => ({ probedDuration: 5, durationTolerance: 1 }),
      uploadAndVerify: async (onStage) => {
        await onStage("upload", { byteSize: 1234, sha256: "b".repeat(64) });
        throw new Error("VIDEO_COS_OBJECT_VERIFY_MISMATCH: internal details");
      },
    }),
    /VIDEO_COS_OBJECT_VERIFY_MISMATCH/,
  );
  assert.deepEqual(events.map((event) => `${event.stage}:${event.outcome}:${event.code ?? ""}`), [
    "validate_output_path:succeeded:",
    "validate_ledger:succeeded:",
    "ffprobe:succeeded:",
    "cos_upload:succeeded:",
    "cos_verify:failed:VIDEO_COS_OBJECT_VERIFY_MISMATCH",
  ]);
});
