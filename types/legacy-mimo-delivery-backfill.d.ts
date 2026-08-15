declare module "@/lib/legacy-mimo-delivery-backfill.mjs" {
  export type LegacyMimoDeliveryStage = "validate_output_path" | "validate_ledger" | "ffprobe" | "cos_upload" | "cos_verify" | "final_db_state";

  export type LegacyMimoDeliveryStageEvent = {
    stage: LegacyMimoDeliveryStage;
    outcome: "succeeded" | "failed";
    code?: string;
    skipped?: boolean;
    probedDuration?: number;
    durationTolerance?: number | null;
    byteSize?: number;
    sha256?: string;
  };

  export function safeLegacyDeliveryError(error: unknown): string;
  export function runLegacyMimoDeliveryBackfill(input: {
    recordStage: (event: LegacyMimoDeliveryStageEvent) => void | Promise<void>;
    validateOutputPath: () => void | Promise<void>;
    validateLedger: () => void | Promise<void>;
    probeAndValidate: () => Promise<{ probedDuration: number; durationTolerance: number | null }>;
    uploadAndVerify: (onStage: (stage: "upload" | "verify", detail?: { byteSize: number; sha256: string }) => void | Promise<void>) => Promise<unknown>;
  }): Promise<{ evidence: { probedDuration: number; durationTolerance: number | null }; cosDelivery: unknown }>;
}
