declare module "@/lib/video-output-gate.mjs" {
  export function isPathInside(rootPath: string, targetPath: string): boolean;
  export function probeVideoDuration(outputPath: string, ffprobeBin?: string): Promise<number>;
  export function validateOutputFile(input: { outputPath: string; downloadsRoot: string }): Promise<void>;
  export function validateOutputLedger(input: { ledgerPath: string; ledgerRoot: string }): Promise<void>;
  export function validateOutputDuration(input: { outputPath: string; expectedDuration: number }): Promise<{ probedDuration: number; durationTolerance: number | null }>;
  export function validateCompletedOutput(input: {
    outputPath: string;
    ledgerPath: string;
    downloadsRoot: string;
    ledgerRoot: string;
    contentQaPassed: boolean;
    expectedDuration: number;
  }): Promise<{ probedDuration: number; durationTolerance: number | null }>;
}
