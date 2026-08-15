---
name: mx-shortdrama-01-frame-extract
description: "Step 01 for Chinese short-drama redraw to Mexico: extract and enhance a production-complete evidence package from one episode video, including native-resolution reference frames without a fixed frame-count cap, 60-second chunk manifests for long episodes, shot-level start/mid/end frame supplements, TransNetV2 shot segmentation, Paddle API smart hard-subtitle/text QA, Mimo ASR audio handoff with Qwen3-ForcedAligner timestamps, and evidence-pack alignment before source timeline reconstruction and shot prompt production. Use when the user provides a domestic short-drama video and asks for frame extraction, key frames, shot frames, subtitle frames, source evidence frames, OCR, shot detection, or evidence before timeline/prompt reconstruction."
---

# MX Shortdrama 01 Frame Extract

## Normative Contract v2

Read `../mx-shortdrama-00-router/references/full-chain-dag-contract.md` first. This skill owns only `step01_evidence`. It must produce a complete `step01_evidence_manifest.json` with exact paths/SHA and a resumable checkpoint; Step02 may consume only that manifest. Step01 evidence never becomes final dialogue, speaker, screen-text, Step04 prompt, Step05 image, or provider truth by itself. Missing original-resolution frames, shot start/mid/end coverage, audio ledger, profile declaration, or manifest is `blocked_evidence_incomplete`; never silently downgrade `hq_full`.

## Purpose

Build the accepted Step 01 evidence package for one episode before any timeline writing, localization, or shot prompt writing. This step must gather six evidence layers: audio-first dialogue/performance ledgers, hard-subtitle OCR, shot segmentation, dense native-resolution frame evidence, shot-level start/mid/end frame supplements, and audio/ASR handoff. Prior workflow failures often came from extracting too few frames or treating performance timing as an afterthought; for redraw work, missing camera states and missing dialogue/emotion timing are worse than extra evidence frames.

The default order is audio-first, then audio-guided frame extraction. Run `scripts/build_audio_evidence.py` before final frame selection; it extracts mono 16 kHz WAV, builds VAD/dialogue/performance ledgers with the best locally available tools, records unavailable optional tools as blockers, and writes `EPXXX_audio_event_ledger.csv`. Feed that ledger back into frame extraction with `--audio-events` so subtitle changes, offscreen speech, breath, silence, and emotional turns can request visual evidence. Do not generate, tag, or carry forward post-added sound effects or background music for redraw production.

Default pairing for the current Step 01 is the quality-first full chain. Do not treat Mimo ASR text recovery, Qwen3-ForcedAligner timestamp alignment, Paddle API OCR, or the speaker second-pass as optional for redraw episodes unless the user explicitly selects `stable_batch` for speed:

1. `ffmpeg` or `imageio_ffmpeg` for source audio extraction.
2. `build_audio_evidence.py --quality-profile hq_full` for VAD/dialogue/audio-event ledgers. Use Silero VAD when installed; otherwise use the built-in energy VAD fallback as a timing cue. Run Mimo ASR as the production Chinese transcript source, then run `Qwen/Qwen3-ForcedAligner-0.6B` for SRT-grade timestamps on the Mimo text. `Qwen3-ASR-1.7B`, faster-whisper, and older local ASR are forbidden in this route; if Mimo ASR or timestamp output fails, write the blocker and fail the strict quality gate before downstream steps pretend the audio chain is complete.
3. `extract_episode_frames.py --audio-events EPXXX_audio_event_ledger.csv` for audio-guided unbounded frame extraction.
4. `enhance_episode_evidence.py --skip-ocr` for the stable Step01 evidence pack, then run Step02 `smart_selective_ocr.py --engine paddle-api --paddle-model auto --paddle-concurrency 8` on triggered subtitle/text windows. Paddle API smart routing uses PP-OCRv6 for normal subtitles/plain text and PaddleOCR-VL-1.6 for difficult phone/screen/UI/comment/danmu/document/layout crops. Both are async Paddle jobs and can be submitted concurrently. Local OCR is not a default fallback.
5. `validate_episode_evidence.py --require-audio-ledger` for acceptance checks.

The production ForcedAligner entrypoint is `scripts/qwen3_forced_aligner_worker.py`. It accepts only an exact Mimo transcript-row JSON/CSV plus the source WAV and invokes `Qwen3ForcedAligner.align`; it never invokes Qwen3-ASR. `build_audio_evidence.py` calls this worker automatically after Mimo in `hq_full`. A VAD/chunk-character timing estimate, a Qwen3-ASR transcript, or an SRT without a valid `EPXXX_qwen3_forced_aligner_receipt.json` is not timestamp evidence and must hard-fail the hq gate.

The final acceptance entrypoint is `scripts/finalize_step01_evidence.py`. It creates and verifies `step01_evidence_manifest.json`, hashes the exact source and every declared artifact, checks every native PNG against the source `ffprobe` width/height, checks exact TransNet start/mid/end coverage, validates Mimo/ForcedAligner and Paddle smart-OCR receipts, and binds the current checkpoint and Artifact Ledger. Only `status=verified` plus `downstream_consumable=true` may enter Step02. A blocked manifest remains useful for recovery but is not a completed node.

Use Mimo ASR, Qwen3-ForcedAligner, CapsWriter timestamp/SRT comparison outputs, WhisperX, pyannote.audio, sherpa-onnx/WeSpeaker speaker passes, emotion2vec, Paddle API OCR, and OmniShotCut as quality layers. `Qwen3-ASR-1.7B` is not a production or comparison layer in this skill and must never be downloaded or invoked. The default `hq_full` route runs the installed high-value audio layers by default and records explicit blockers/warnings when a layer cannot produce evidence. PANNs, CLAP, BEATs, or other sound/music taggers are outside the default redraw workflow because post-added sound effects and background music are not production deliverables. The high-quality audio helper is enabled by default through `build_audio_evidence.py --quality-profile hq_full`; on this machine that runs the pinned `shortdrama_hq310` environment for Silero VAD and optional performance checks, while Qwen3-ForcedAligner is delegated to the configured aligner runtime through `--asr-python`. If the user explicitly chooses `--quality-profile stable_batch`, the script may continue with available ledgers and record unavailable tools as blockers/warnings, but it still may not replace Mimo text with another ASR.

The frame set must be production-complete, not capped. It should preserve enough visual and audio-timed evidence to support later asset prompts, source timelines, and grouped all-purpose reference image-to-video prompts. If the optional `$mx-shortdrama-frame-anchor-addon` is explicitly active, the same evidence can also support generated `首帧`, `关键帧`, and `尾帧` image prompts. Original-quality PNG frames are the only valid redraw references; contact sheets are preview-only.

If a full episode is too large or risks timing out, process it in 60-second chunks and label each chunk as that episode's `第几分钟内容`; then merge the manifests and keep the chunk manifests for Step 02-04 review.

Always create a separate shot-level supplement for redraw episodes: extract each detected shot's start, middle, and end frame into `shotlevel_start_mid_end_frames/` and write `shotlevel_start_mid_end_manifest.csv/json`. This supplement is required for timeline reconstruction and prompt anchoring; it does not replace `reference_frames_original/`.

Use two profiles:

- `hq_full`: default for redraw. Use WAV extraction, Silero/energy VAD, Mimo ASR text recovery, Qwen3-ForcedAligner-0.6B timestamps on Mimo text, speaker second-pass attempt, audio-guided unbounded frames, TransNetV2, Paddle API smart OCR QA, validation, and Step04 prewrite gates. Strict quality gate blocks if primary Mimo transcript/timestamp evidence is missing.
- `stable_batch`: explicit speed fallback only. Use TransNetV2 + audio handoff, and record unavailable Mimo/ForcedAligner/speaker/OCR layers as blockers/warnings. Do not use it for quality-first reruns unless the user explicitly accepts the downgrade.

## Routing / Activation

Use this step only to create or repair the source evidence package for one episode. After validation, route forward to Step 02 through the router; do not localize, write prompts, or generate asset images inside Step 01.

## Required Input

```text
Episode video path:
Episode ID:
Output directory:
```

## Evidence Coverage Policy

- Do not impose a fixed frame-count cap for short-drama redraw. Step 01 is accepted by evidence completeness, source-resolution fidelity, sorted manifests, audio/ASR handoff, and downstream usefulness, not by staying inside 80-100 frames or any other preset range.
- Default extraction is `unbounded_evidence_coverage`. Export every shot start/mid/end, sharp mid-shot candidate, subtitle change, key visual change, and dense motion interval needed to reconstruct the episode and later write frame/video prompts.
- Use 60-second chunking when the episode has too much content for one pass. Treat each chunk as `第1分钟内容`, `第2分钟内容`, etc.; write per-chunk manifests under `minute_chunks/`, then merge them into the episode manifest.
- Keep repeated near-identical frames only when they clarify subtitle timing, acting change, hand/object motion, screen readability, or transition handoff. Do not drop real shot changes simply to satisfy an old frame budget.
- Use `--bounded` only for legacy review packets or when the user explicitly asks for a fixed frame-count package. Bounded mode is not the accepted production evidence mode for redraw.
- Step 01 is not accepted if the exported reference set is sparse enough to hide camera cuts, reaction chains, prop inserts, readable documents/UI, subtitle changes, transition states, or audio/dialogue handoffs.
- The shot-level start/mid/end supplement is required by default and may add evidence beyond the main manifest. Missing this supplement is a validation failure unless the user explicitly waives shot-level prompt production.

## Extraction Rules

- Extract each complete shot's start, middle, and end frame.
- For static shots with repeated frames, keep the clearest sharp frame as the primary middle frame.
- For motion shots, extract enough intermediate frames to show the full movement state without hiding camera or actor path changes.
- Around complex cut chains, reaction-shot exchanges, prop close-ups, readable documents/UI, and white-flash or stylized transitions, prefer dense coverage and preserve transition/tail states that will matter to later frame prompts.
- When visible subtitles change, extract subtitle frames in order.
- When key people, props, documents, UI, signage, or readable text appear, extract additional evidence frames.
- If a single pass becomes too large or times out, split by 60-second chunks instead of deleting evidence. Only remove truly duplicate frames that add no subtitle, action, prop, camera, or continuity information.
- Save original-quality frames in sequential filename order under `reference_frames_original/`. Do not resize, crop, JPEG-compress, or use the contact sheet as generation reference.
- Do not treat every audible line as main-character dialogue. Mark ambient/procedural dialogue candidates separately when the speaker is off-screen, a background worker, or another couple in the scene.

## Tool Layers

Use the best available tool for each layer:

1. Audio-first layer:
   - Always extract mono 16k WAV first with `scripts/build_audio_evidence.py`.
   - Build `EPXXX_audio_event_ledger.csv/json`, `EPXXX_dialogue_ledger.csv/json`, and `EPXXX_vad_segments.csv/json` before frame extraction.
   - Feed `EPXXX_audio_event_ledger.csv` into `extract_episode_frames.py --audio-events`.
   - Treat Mimo ASR as the only production Chinese ASR text layer and Qwen3-ForcedAligner-0.6B as the only local timestamp layer for `EPXXX_transcript.srt`. Qwen3-ASR-1.7B is forbidden; do not add it as a fallback, comparison, default model, or automatic download.
   - Mimo keys are shared globally from `C:\Users\lsb\.codex\redraw-secrets\mimo_keys_selected_cn.txt` and `C:\Users\lsb\.codex\redraw-secrets\mimo_keys.txt` when no runtime `--mimo-api-key` is passed. The script can use a key pool with `--mimo-concurrency N`; invalid keys are recorded by fingerprint and retried with the next key, never written in plain text. Endpoint routing is automatic by key type: `sk-` keys use the official docs endpoint `https://api.xiaomimimo.com/v1`, and `tp-` keys use `https://token-plan-cn.xiaomimimo.com/v1`. Current calibration: the official `sk-` endpoint passed 2/3/5-way small-audio parallel tests, so only `sk-` keys are allowed into the Mimo ASR thread pool. `tp-` token-plan keys are treated as non-parallel and forced to serial/global-lock use unless explicitly retested.
   - CapsWriter can be used as a practical Qwen3-based timestamp/SRT reference layer when its offline package is installed; do not rely on it for speaker diarization unless a separate speaker module is configured.
   - Use pyannote.audio, sherpa-onnx diarization/speaker identification, or WeSpeaker as a second-pass speaker layer only when available. Do not accept diarization blindly; verify speaker identity against visible cuts, subtitles, and mouth movement.
   - Use emotion/voice tools only for dialogue performance, breath, silence, hesitation, crying/laughing/gasping, and emotional turn candidates. Do not run SFX/music taggers for normal redraw production.
   - Preferred candidates are listed in `references/audio-evidence-tool-stack.md`: Mimo ASR for Chinese transcript text, Qwen3-ForcedAligner for SRT timestamps, CapsWriter only for timestamp comparison when explicitly requested, WhisperX / whisper-timestamped only for isolated timing diagnostics, pyannote.audio, sherpa-onnx, WeSpeaker, or NeMo for speaker passes, and Silero VAD for speech activity. No alternate ASR may replace Mimo in the production handoff.
   - Audio evidence drives where to look; it does not override visible frames, hard subtitles, or manual review by itself.
2. Hard-subtitle layer:
   - Preferred: Paddle API smart routing via `scripts/smart_selective_ocr.py --engine paddle-api --paddle-model auto --paddle-concurrency 8`.
   - Model split: PP-OCRv6 for normal subtitles/plain text; PaddleOCR-VL-1.6 for difficult targeted crops, user-flagged phone/screen/UI/comment/danmu/document/layout text, or comparison when PP-OCRv6 is insufficient.
   - Both Paddle OCR models are asynchronous job APIs. Concurrent job submission is allowed; do not add a local global Paddle submit lock unless a real provider throttle is observed and documented.
   - Local OCR such as RapidOCR/RapidVideOCR/local PaddleOCR is not the default fallback; use it only when the user explicitly accepts a non-API downgrade or for comparison evidence.
   - Daily credential rule: after local date changes past 00:00 Asia/Shanghai, open `https://aistudio.baidu.com/paddleocr`, authenticate through Weixin if needed, re-extract the current-day Paddle OCR token, and set it only in runtime env as `PADDLEOCR_AISTUDIO_TOKEN` / `PADDLEOCR_API_TOKEN`. In the PP-OCRv6 and PaddleOCR-VL-1.6 API snippets, only `Authorization: bearer <TOKEN>` / `TOKEN = "..."` refreshes daily; keep `JOB_URL`, `MODEL`, and each model's `optionalPayload` unchanged. Do not store this token in the skill, objective files, or generated artifacts. If the token is missing or expired, block the Paddle OCR step instead of using local OCR or stale credentials.
   - EP007 calibration result: ASR alone missed short subtitles and timing-sensitive office voices; smart-trigger API OCR must check the ASR timestamp window instead of relying on local OCR or broad timeline prose.
   - Hard subtitles outrank ASR when they disagree.
3. Dialogue/audio layer:
   - Always extract audio for ASR handoff.
   - Local alignment is optional only when the strict gate records a blocker. Use Mimo ASR as the production transcript source and `Qwen/Qwen3-ForcedAligner-0.6B` as the timestamp layer when a compatible environment exists. Never use Qwen3-ASR, faster-whisper, FunASR, or SenseVoice to replace Mimo text.
   - Speaker attribution is a separate pass. For unknown speakers, run diarization/clustering; sherpa-onnx speaker identification requires enrollment examples and does not by itself discover speakers in a mixed episode.
   - If no ASR is available, keep OCR subtitles and audio paths, and mark ASR pending instead of inventing dialogue.
4. Shot layer:
   - Stable default: TransNetV2 via `transnetv2-pytorch`, then export shot start/end times and shot keyframes.
   - High-quality comparison: OmniShotCut in `clean_shot` or `default` mode. If OmniShotCut and TransNetV2 disagree, inspect the affected native frames before changing the selected reference set.
   - EP001 calibration result: OmniShotCut detected 81 shots and TransNetV2 detected 80; 78 Omni boundaries were within 5 frames of TransNetV2. Use OmniShotCut as QA or sensitivity layer, not a blind replacement.
   - Secondary comparison: PySceneDetect `detect-content` or `detect-adaptive`.
   - Fallback: the bundled OpenCV detector in `scripts/extract_episode_frames.py`.
5. Visual layer:
   - Use Codex/GPT visual拉片 directly from native-resolution reference frames and TransNetV2 shot keyframes.
   - Do not route Step 01 or Step 02 visual understanding to Gemini, Qwen, or other external VLMs unless the user explicitly asks.
6. Frame layer:
   - Always output the complete accepted evidence frame set sorted by `timecode` at native video resolution, plus `minute_chunks/` when chunking is used.
   - When audio ledgers exist, pass them to `scripts/extract_episode_frames.py --audio-events <ledger>` so frame candidates include dialogue starts/ends, silence/reaction moments, breath, and emotion turns. Post-added SFX and background music must not drive extraction.
7. Evidence QA layer:
   - `scripts/enhance_episode_evidence.py` writes both JSONL and SQLite evidence packages.
   - `scripts/validate_episode_evidence.py` verifies manifest, native PNGs, OCR, TransNetV2, SQLite row counts, audio handoff, and optional ASR. Treat validation failure as a hard stop before Step 02.

## Procedure

1. Confirm video metadata: duration, fps, resolution, aspect ratio.
2. Run `scripts/build_audio_evidence.py` immediately to create the source audio path/timecode basis, VAD ledger, dialogue ledger, audio-event ledger, tool-status JSON, and ASR blocker if needed.
3. Attempt ASR/VAD/diarization and optional emotion/performance tooling through the audio evidence script or the high-quality add-on. If tools are blocked, write the blocker and continue with audio handoff instead of inventing performance cues.
4. Use default unbounded evidence coverage unless the user explicitly asks for `--bounded`. Do not use 80-100 frames as the normal redraw budget.
5. Run shot segmentation and write the shot list.
6. Run `scripts/extract_episode_frames.py` to export complete evidence frames and per-minute chunk manifests. Pass `EPXXX_audio_event_ledger.csv` with `--audio-events`.
7. Check that `frame_count` and `shotlevel_start_mid_end_manifest` are dense enough for Step 04 prompt anchoring. In default unbounded mode, coverage completeness matters more than a target count.
8. Run `scripts/enhance_episode_evidence.py --skip-ocr` to create TransNetV2 shots, `EPXXX_evidence_pack.jsonl`, and `EPXXX_evidence_pack.sqlite`; run Step02 Paddle API smart OCR on triggered subtitle/text windows.
9. Run Step02's `smart_selective_ocr.py` as an evidence helper when the hq profile requires Paddle QA. Its `EPXXX_smart_ocr_receipt.json` must show zero errors, a non-empty ledger, and terminal coverage for every selected candidate-region task. This helper explicitly sets `step02_completed=false`; it cannot accept or complete Step02 source truth.
10. Run `scripts/validate_episode_evidence.py --video <exact-source> --require-source-ffprobe --require-audio-ledger`. Treat failure as a hard stop before Step 02.
11. Confirm `reference_frames_original/` exists, has the same frame count as the manifest, and every image matches the source resolution.
12. Review the contact sheet for missing dialogue, prop, text, movement, silence/reaction, breath, or emotion evidence. Use it only as a preview, never as generation reference.
13. Confirm the TransNet-derived `shotlevel_start_mid_end_manifest.csv/json` contains exactly `start`, `mid`, and `end` for every accepted TransNet shot. `enhance_episode_evidence.py` regenerates this supplement from the accepted TransNet table; an older OpenCV shot supplement cannot satisfy this gate by row count alone.
14. Run `scripts/finalize_step01_evidence.py` with exact Paddle receipt, checkpoint, and Artifact Ledger paths. Do not create Step02 truth until its verifier returns `downstream_consumable=true`.
15. Output only evidence artifacts and a short summary. Do not write the plot, localize, or create asset prompts in this step.

## High-Quality Add-On Procedure

Run this only after the stable evidence package exists.

1. Confirm `reference_frames_original/` contains native PNGs and the manifest has `frame_index`, `time_sec`, and `path`.
2. Run OmniShotCut on the source video and compare its shot boundaries against TransNetV2.
3. Generate subtitle-region crops from OCR-positive native frames and run RapidVideOCR on those crops.
4. Run Paddle API smart routing on the same crops as the primary smart-OCR text source; use PP-OCRv6 for normal subtitles/plain text and PaddleOCR-VL-1.6 for targeted difficult crops. Only run local OCR as explicit comparison evidence.
5. Run Mimo ASR on `audio/EPXXX_16k_mono.wav`, then Qwen3-ForcedAligner on the Mimo text via the configured aligner runtime. If either stage fails, write the blocker and do not create a substitute transcript; timing-only comparison tools stay in an isolated diagnostic directory and never enter the accepted handoff.
6. Write a trial summary that selects the default evidence source for each layer and lists disagreement frames or phrases.
7. Update downstream Step 02 source timeline from the selected evidence source plus explicit disagreement notes.

## Commands

```powershell
& "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" <skill_dir>\scripts\build_audio_evidence.py `
  --video "D:\path\episode.mp4" `
  --episode-id "EP001" `
  --out-dir "D:\path\output\EP001_frames" `
  --quality-profile hq_full `
  --asr-backend mimo `
  --mimo-api-base auto `
  --mimo-auth-header "api-key" `
  --mimo-concurrency 2 `
  --asr-aligner-model "Qwen/Qwen3-ForcedAligner-0.6B" `
  --asr-fallback none `
  --asr-python "C:\Users\lsb\anaconda3\envs\qwen3_asr312\python.exe" `
  --asr-timeout-sec 1200 `
  --model-cache-dir "D:\codex-work\aaa\tools\model_cache\huggingface" `
  --asr-language zh `
  --speaker-backend auto `
  --strict-quality-gate

& "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" <skill_dir>\scripts\extract_episode_frames.py `
  --video "D:\path\episode.mp4" `
  --episode-id "EP001" `
  --out-dir "D:\path\output\EP001_frames" `
  --unbounded `
  --chunk-sec 60 `
  --audio-events "D:\path\output\EP001_frames\EP001_audio_event_ledger.csv"

& "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" <skill_dir>\scripts\enhance_episode_evidence.py `
  --video "D:\path\episode.mp4" `
  --episode-id "EP001" `
  --out-dir "D:\path\output\EP001_frames"

& "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" <skill_dir>\scripts\validate_episode_evidence.py `
  --video "D:\path\episode.mp4" `
  --episode-id "EP001" `
  --out-dir "D:\path\output\EP001_frames" `
  --require-source-ffprobe `
  --require-audio-ledger

& "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" <skill_dir>\scripts\finalize_step01_evidence.py `
  --source-video "D:\path\episode.mp4" `
  --episode-id "EP001" `
  --out-dir "D:\path\output\EP001_frames" `
  --quality-profile hq_full `
  --paddle-receipt "D:\path\output\EP001_step02\smart_ocr\EP001_smart_ocr_receipt.json" `
  --checkpoint "D:\path\output\EP001_frames\checkpoint.json" `
  --artifact-ledger "D:\path\output\EP001_frames\artifact_ledger.json"

& "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" <skill_dir>\scripts\run_high_quality_trials.py `
  --video "D:\path\episode.mp4" `
  --episode-id "EP001" `
  --out-dir "D:\path\output\EP001_frames" `
  --project-root "D:\path\output" `
  --hq-python "C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe" `
  --paddle-python "C:\Users\lsb\anaconda3\envs\shortdrama_paddle310\python.exe" `
  --omnishotcut-dir "D:\codex-work\aaa\tools\shortdrama_hq\OmniShotCut"
```

## Output Files

- `EPXXX_frame_manifest.csv`
- `EPXXX_frame_manifest.json`
- `EPXXX_contact_sheet.jpg`
- `reference_frames_original/EPXXX_001_HH-MM-SS.mmm_reason.png`
- `EPXXX_shot_list.csv`
- `EPXXX_shot_list.json`
- `transnet_shots/EPXXX_transnet_shots.csv`
- `transnet_shots/EPXXX_transnet_shots.json`
- `transnet_shots/keyframes/*.png`
- `subtitle_ocr/EPXXX_subtitle_ocr.csv`
- `subtitle_ocr/EPXXX_subtitle_ocr.json`
- `subtitle_ocr/EPXXX_subtitle_ocr_dedup.srt`
- `EPXXX_evidence_pack.jsonl`
- `EPXXX_evidence_pack.sqlite`
- `EPXXX_evidence_pack_summary.json`
- `EPXXX_evidence_validation.json`
- `audio/EPXXX_16k_mono.wav` when `ffmpeg` is available
- `EPXXX_audio_tool_status.json`
- `EPXXX_hq_audio_status.json` when `--run-hq-audio` is enabled
- `EPXXX_hq_audio.log` when `--run-hq-audio` is enabled
- `EPXXX_silero_vad_segments.csv/json` when the HQ Silero layer runs
- `EPXXX_mimo_asr_raw.json` when Mimo ASR runs
- No `EPXXX_qwen3_asr_raw.json` is a valid production output; its presence is a route-violation signal and must not be consumed.
- `EPXXX_transcript.srt` when timestamped ASR runs
- `EPXXX_qwen3_forced_aligner_receipt.json` binding exact Mimo transcript + WAV to real ForcedAligner timestamps
- `EPXXX_qwen3_forced_aligner_tokens.json`
- `EPXXX_audio_evidence_summary.md`
- `EPXXX_vad_segments.csv/json`
- `EPXXX_dialogue_ledger.csv/json`
- `EPXXX_audio_event_ledger.csv/json`
- `EPXXX_asr_blocker.json` when ASR was attempted but unavailable or failed
- `EPXXX_transcript_segments.csv/json` when local ASR is run
- `EPXXX_speaker_ledger.csv/json` when diarization is available
- `EPXXX_asr_handoff.md` with recommended ASR command or tool and transcript status
- `tool_trials/omnishotcut_EPXXX/*` when high-quality OmniShotCut QA is run
- `tool_trials/rapid_videocr_EPXXX/*` and `tool_trials/paddleocr_EPXXX/*` when OCR comparison is run
- `tool_trials/asr_EPXXX/*` when ASR comparison is run
- `tool_trials/EPXXX_high_quality_trial_summary.json`
- original-resolution extracted PNG frames named with sequence number, timecode, and reason
- `minute_chunks/EPXXX_minute_chunks_index.json` and per-minute CSV/JSON manifests when chunking is enabled
- `EPXXX_extraction_summary.md`
- accepted production evidence coverage with no fixed frame-count cap; bounded counts are only for explicitly requested legacy review packets
- required `shotlevel_start_mid_end_frames/*.png`, `shotlevel_start_mid_end_manifest.csv`, and `shotlevel_start_mid_end_manifest.json` for dense shot-level timeline reconstruction and prompt anchoring
- `step01_evidence_manifest.json`; only the verified hq_full form is Step02-consumable

For exact columns, read `references/frame-manifest-schema.md`.
For audio tool selection and ledger columns, read `references/audio-evidence-tool-stack.md`.
