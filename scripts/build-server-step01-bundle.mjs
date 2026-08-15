import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const skillRoot = process.env.STEP01_SOURCE_SKILL_ROOT || "C:/Users/lsb/.codex/skills/mx-shortdrama-01-frame-extract";
const timelineSkillRoot = process.env.STEP02_SOURCE_SKILL_ROOT || path.join(path.dirname(skillRoot), "mx-shortdrama-02-source-timeline");
const outputRoot = path.join(process.cwd(), "runtime", "server-step01-bundle");
const required = [
  "scripts/build_audio_evidence.py",
  "scripts/qwen3_forced_aligner_worker.py",
  "scripts/extract_episode_frames.py",
  "scripts/finalize_step01_evidence.py",
  "scripts/smart_selective_ocr.py",
];

async function digest(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(path.join(skillRoot, "scripts"), path.join(outputRoot, "scripts"), { recursive: true, filter: (source) => source.endsWith(".py") || !path.extname(source) });
await cp(path.join(skillRoot, "references"), path.join(outputRoot, "references"), { recursive: true });
await cp(path.join(skillRoot, "SKILL.md"), path.join(outputRoot, "SKILL.md"));
await cp(
  path.join(timelineSkillRoot, "scripts", "smart_selective_ocr.py"),
  path.join(outputRoot, "scripts", "smart_selective_ocr.py"),
);
const files = [];
for (const relative of required) {
  const target = path.join(outputRoot, relative);
  files.push({ path: relative.replaceAll("\\", "/"), sha256: await digest(target) });
}
await writeFile(path.join(outputRoot, "bundle-manifest.json"), JSON.stringify({ schema: "niannian.server_step01_bundle.v1", source_skill: "mx-shortdrama-01-frame-extract", files, prohibited: ["credentials", "browser_profile", "desktop_gui", "local_pixel_edit"] }, null, 2));
console.log(JSON.stringify({ outputRoot, files: files.length }));
