import { spawn } from "node:child_process";

export function validateNativeAudioMediaProbe(probe, expected = {}) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video || !video.codec_name) throw new Error("MEDIA_VIDEO_STREAM_INVALID");
  if (!audio || !audio.codec_name) throw new Error("native_audio_missing");
  if (expected.width && Number(video.width) !== Number(expected.width)) throw new Error("MEDIA_WIDTH_MISMATCH");
  if (expected.height && Number(video.height) !== Number(expected.height)) throw new Error("MEDIA_HEIGHT_MISMATCH");
  const duration = Number(probe?.format?.duration || video.duration || 0);
  const wanted = Number(expected.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("MEDIA_PROBE_DURATION_INVALID");
  if (wanted > 0 && Math.abs(duration - wanted) > Math.max(1, wanted * 0.2)) throw new Error("MEDIA_DURATION_MISMATCH");
  return { duration, video: { codec: video.codec_name, width: Number(video.width), height: Number(video.height) }, audio: { codec: audio.codec_name, channels: Number(audio.channels || 0), sampleRate: Number(audio.sample_rate || 0) } };
}

export async function probeNativeAudioMedia(outputPath, expected, ffprobeBin = "ffprobe") {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(ffprobeBin, ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.once("error", () => reject(new Error("FFPROBE_NOT_AVAILABLE")));
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`MEDIA_PROBE_FAILED:${stderr.replace(/\s+/g, " ").trim()}`)));
  });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("MEDIA_PROBE_JSON_INVALID"); }
  return validateNativeAudioMediaProbe(parsed, expected);
}
