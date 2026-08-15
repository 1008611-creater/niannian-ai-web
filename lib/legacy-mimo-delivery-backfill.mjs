const STAGE_CODES = new Set([
  "validate_output_path",
  "validate_ledger",
  "ffprobe",
  "cos_upload",
  "cos_verify",
  "final_db_state",
]);

export function safeLegacyDeliveryError(error) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/[A-Z][A-Z0-9_]{2,127}/)?.[0] ?? "LEGACY_DELIVERY_BACKFILL_FAILED";
}

async function runStage(recordStage, stage, work, detail = () => ({})) {
  if (!STAGE_CODES.has(stage)) throw new Error("LEGACY_DELIVERY_STAGE_INVALID");
  try {
    const value = await work();
    await recordStage({ stage, outcome: "succeeded", ...detail(value) });
    return value;
  } catch (error) {
    const code = safeLegacyDeliveryError(error);
    await recordStage({ stage, outcome: "failed", code });
    const safeError = new Error(code);
    safeError.cause = error;
    throw safeError;
  }
}

// This runner has no provider-submit capability. It only validates an existing
// receipt/output, verifies COS delivery, then lets the caller persist completion.
export async function runLegacyMimoDeliveryBackfill({
  recordStage,
  validateOutputPath,
  validateLedger,
  probeAndValidate,
  uploadAndVerify,
}) {
  await runStage(recordStage, "validate_output_path", validateOutputPath);
  await runStage(recordStage, "validate_ledger", validateLedger);
  const evidence = await runStage(recordStage, "ffprobe", probeAndValidate, (value) => ({
    probedDuration: value.probedDuration,
    durationTolerance: value.durationTolerance,
  }));

  let cosUploadRecorded = false;
  let cosVerifyRecorded = false;
  let currentCosStage = "cos_upload";
  let cosDelivery;
  try {
    cosDelivery = await uploadAndVerify(async (stage, detail = {}) => {
      currentCosStage = stage === "verify" ? "cos_verify" : "cos_upload";
      if (currentCosStage === "cos_upload") cosUploadRecorded = true;
      if (currentCosStage === "cos_verify") cosVerifyRecorded = true;
      await recordStage({ stage: currentCosStage, outcome: "succeeded", ...detail });
      // Once COS has accepted the upload, every remaining COS failure belongs
      // to readback verification, even if getObject itself never returns.
      if (currentCosStage === "cos_upload") currentCosStage = "cos_verify";
    });
    // COS may be intentionally disabled in a local/test environment. Keep the
    // event explicit so a missing delivery object cannot look like a verified one.
    if (!cosUploadRecorded) await recordStage({ stage: "cos_upload", outcome: "succeeded", skipped: true });
    if (!cosVerifyRecorded) await recordStage({ stage: "cos_verify", outcome: "succeeded", skipped: true });
  } catch (error) {
    const code = safeLegacyDeliveryError(error);
    await recordStage({ stage: currentCosStage, outcome: "failed", code });
    const safeError = new Error(code);
    safeError.cause = error;
    throw safeError;
  }

  return { evidence, cosDelivery };
}
