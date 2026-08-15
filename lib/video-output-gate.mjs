import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

export function isPathInside(rootPath, targetPath) {
  if (!rootPath || !targetPath || !path.isAbsolute(rootPath) || !path.isAbsolute(targetPath)) return false;
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function probeVideoDuration(outputPath, ffprobeBin = process.env.FFPROBE_BIN || "ffprobe") {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(ffprobeBin, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      outputPath,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", (error) => reject(new Error(`FFPROBE_UNAVAILABLE:${clean(error.message)}`)));
    child.on("close", (code) => {
      code === 0 ? resolve(stdout) : reject(new Error(`MEDIA_PROBE_FAILED:${clean(stderr)}`));
    });
  });
  const duration = Number(JSON.parse(output).format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("MEDIA_PROBE_DURATION_INVALID");
  return duration;
}

export async function validateOutputFile({ outputPath, downloadsRoot }) {
  if (!outputPath || !path.isAbsolute(outputPath)) throw new Error("OUTPUT_PATH_INVALID");
  if (!isPathInside(downloadsRoot, outputPath)) throw new Error("OUTPUT_OUTSIDE_TASK_DOWNLOADS");
  try {
    await access(outputPath);
  } catch {
    throw new Error("OUTPUT_FILE_NOT_FOUND");
  }
}

export async function validateOutputLedger({ ledgerPath, ledgerRoot }) {
  if (!ledgerPath || !path.isAbsolute(ledgerPath)) throw new Error("LEDGER_PATH_REQUIRED");
  if (!isPathInside(ledgerRoot, ledgerPath)) throw new Error("LEDGER_OUTSIDE_TASK_DIRECTORY");
  try {
    await access(ledgerPath);
  } catch {
    throw new Error("LEDGER_FILE_NOT_FOUND");
  }
}

export async function validateOutputDuration({ outputPath, expectedDuration }) {
  const probedDuration = await probeVideoDuration(outputPath);
  const duration = Number(expectedDuration);
  const durationTolerance = Number.isFinite(duration) && duration > 0 ? Math.max(1, duration * 0.2) : null;
  if (durationTolerance !== null && Math.abs(probedDuration - duration) > durationTolerance) {
    throw new Error("MEDIA_DURATION_MISMATCH");
  }
  return { probedDuration, durationTolerance };
}

export async function validateCompletedOutput({
  outputPath,
  ledgerPath,
  downloadsRoot,
  ledgerRoot,
  contentQaPassed,
  expectedDuration,
}) {
  await validateOutputFile({ outputPath, downloadsRoot });

  if (!contentQaPassed) throw new Error("CONTENT_QA_REQUIRED");
  await validateOutputLedger({ ledgerPath, ledgerRoot });

  return validateOutputDuration({ outputPath, expectedDuration });
}
