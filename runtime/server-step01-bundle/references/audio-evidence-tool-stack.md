# Audio Evidence Tool Stack

Use this stack when Step 01 needs audio-first extraction before visual frame selection. The purpose is not to create a final sound mix and not to design post-added sound effects or background music. The purpose is to build a dialogue/performance timecode ledger that drives frame extraction, source timeline writing, localized performance notes, asset prompts, and Seedance2 reference-video prompts.

## Recommended Order

1. Extract mono 16 kHz WAV from the source video.
2. Run `scripts/build_audio_evidence.py` to build speech activity, dialogue, silence, and audio-peak timecode tables with the best installed local tools.
3. Transcribe speech with word or short-utterance timestamps when ASR is available; otherwise write `EPXXX_asr_blocker.json` and keep VAD timing.
4. Add speaker labels when feasible, but only treat them as candidate labels until visual/subtitle review confirms them.
5. Add emotion, breath, silence, offscreen speech, and story-relevant information-cue candidates when the relevant model is installed. Do not add post-added sound effects, audio peaks, music hits, or background music candidates to the redraw workflow.
6. Feed `EPXXX_audio_event_ledger.csv` back into frame extraction with `extract_episode_frames.py --audio-events <ledger>`.

## Best Current Pairing

Use this quality-first default for redraw episodes:

| Role | Default | Why |
| --- | --- | --- |
| Audio extraction | `ffmpeg` or `imageio_ffmpeg` | Deterministic 16 kHz mono WAV, no model dependency. |
| Speech timing | Silero VAD if installed; built-in energy VAD fallback otherwise | Provides dialogue/reaction timing before visual frame selection. |
| Primary ASR text | Mimo ASR | Required primary Chinese transcript source in `hq_full`; route `sk-` keys to the official endpoint `https://api.xiaomimimo.com/v1` and allow them in the parallel pool, while `tp-` token-plan keys use `https://token-plan-cn.xiaomimimo.com/v1` in serial mode unless explicitly retested. |
| Primary timestamps | Qwen3-ForcedAligner-0.6B on Mimo text | Produces SRT-grade timing on the Mimo transcript when the model/runtime is available. |
| Timestamp/SRT reference | CapsWriter | Practical offline Qwen3-based transcription package that can output `.srt`, `.txt`, and word/character timestamp JSON for comparison. |
| Alternate ASR | None in production | Never replace Mimo text with another ASR. User-requested diagnostics must be isolated and cannot enter the accepted handoff. |
| Speaker split | sherpa-onnx / WeSpeaker / pyannote.audio | Run as a second pass. Speaker identification needs enrolled speakers; unknown-speaker episodes need diarization or clustering plus visual confirmation. |
| Hard subtitles / visible text | Paddle API smart routing: PP-OCRv6 + PaddleOCR-VL-1.6 | PP-OCRv6 handles normal burned-in subtitles/plain text. PaddleOCR-VL-1.6 handles phone/screen/UI/comment/danmu/document/layout-heavy or otherwise difficult crops. Both are async Paddle jobs and may be submitted concurrently; local OCR is comparison only. |
| Shot cuts | TransNetV2 via `enhance_episode_evidence.py` | Stable shot table and keyframes. |
| Emotion/performance QA | emotion2vec/SpeechBrain performance candidates | Candidate tags only; use them to request review frames for acting turns, not as final evidence. |

Default redraw mode is `hq_full`: run the high-value installed layers by default, fail the quality gate if Mimo transcript recovery or ForcedAligner timestamp output is missing, and record speaker-pass blockers/warnings instead of silently pretending speaker ID is solved. Use `stable_batch` only when the user explicitly accepts a speed downgrade.

The exact timestamp adapter is `scripts/qwen3_forced_aligner_worker.py --audio <WAV> --transcript <Mimo rows JSON/CSV> --transcript-origin mimo_asr`. It uses `Qwen3ForcedAligner.align(audio, text, language)` and writes `EPXXX_qwen3_forced_aligner_receipt.json`, aligned token JSON, canonical transcript CSV/JSON, and SRT. The receipt must state `transcript_origin=mimo_asr`, `timing_basis=qwen3_forced_aligner_model_inference`, `timestamps_are_forced_alignment=true`, `asr_model_invoked=false`, exact model `Qwen/Qwen3-ForcedAligner-0.6B`, and exact path/SHA/bytes for the WAV, Mimo transcript input, and outputs. Qwen3-ASR transcription, VAD-window interpolation, chunk-character splitting, or an approximate SRT cannot satisfy this receipt.

## Local Installation Status And Use Policy

Use these Python environments on this machine:

| Environment | Path | Use |
| --- | --- | --- |
| Main audio/video evidence env | `C:\Users\lsb\anaconda3\envs\shortdrama_hq310\python.exe` | Step 01 audio evidence, Mimo orchestration, speaker pass import checks, Silero VAD, PANNs availability probe, Qwen2-Audio runtime-class checks, OpenCV frame extraction. Delegates only Qwen3-ForcedAligner to the configured aligner runtime. |
| ForcedAligner env | `C:\Users\lsb\anaconda3\envs\qwen3_asr312\python.exe` | Dedicated Python 3.12 environment for `Qwen/Qwen3-ForcedAligner-0.6B` only. It must not load or download Qwen3-ASR. |
| Paddle OCR env | `C:\Users\lsb\anaconda3\envs\shortdrama_paddle310\python.exe` | PaddleOCR comparison only. Keep it separate because PaddleOCR's pinned NumPy/Paddle stack conflicts with the main audio environment. |
| CLAP experiment env | `C:\Users\lsb\anaconda3\envs\shortdrama_clap310\python.exe` | Isolated LAION-CLAP experiment environment only. Keep it out of `shortdrama_hq310` because CLAP's current NumPy constraints conflict with WhisperX/pyannote. |

Current installed/default status:

| Tool | Status | Reasonable use |
| --- | --- | --- |
| `imageio_ffmpeg` / bundled ffmpeg | Installed and used by scripts | Default audio extraction. Do not require system `ffmpeg` on PATH. |
| `silero-vad` | Installed and verified on EP002 | Default speech-activity timing inside `build_audio_evidence.py`; falls back to energy VAD when it fails. |
| Built-in energy VAD | Always available | Non-blocking fallback for speech/silence candidates; enough to drive frame extraction even when models fail. |
| Mimo ASR | Available through shared redraw secrets | Preferred transcript backend. Use Mimo ASR text recovery first, then run `Qwen/Qwen3-ForcedAligner-0.6B` on the Mimo text for timestamp/SRT output. Shared key files can be used as a pool; only official `sk-` keys enter the parallel chunk pool, while `tp-` keys stay serial/non-parallel. |
| `qwen-asr` | Installed only for the ForcedAligner runtime | Used only to align exact Mimo transcript text. Qwen3-ASR transcription is forbidden. |
| CapsWriter | External app/package, not detected as a Python module | Useful reference path for Qwen3-based SRT/timestamp output; not a speaker diarization solution by itself. |
| `faster-whisper` | Installed | Isolated diagnostic only when the user explicitly asks for a comparison; never use it to replace Mimo or create the accepted transcript ledger. |
| WhisperX | Installed | High-quality word/segment timing and optional alignment/diarization trials. Use for calibration or hero episodes, not every batch by default. |
| FunASR / SenseVoice | Retired from this redraw ASR route on 2026-06-22 | Do not use as default, fallback, or deliverable evidence. Re-download only if the user explicitly asks for historical comparison against old runs. |
| sherpa-onnx | Installed as workspace vendor packages for Python 3.10 and 3.12 on 2026-06-22 | Candidate second-pass speaker identification/diarization framework. The package is importable, but speaker identification still needs enrolled speaker examples/model paths; unknown-speaker episodes need diarization/clustering first. |
| WeSpeaker | GitHub install attempted on 2026-06-22; blocked by local Git schannel credentials and GitHub timeouts | Candidate speaker embedding/recognition model family; still needs repository install plus either diarization/clustering or enrollment data to label speakers. |
| pyannote.audio | Package imports | Speaker diarization candidate only. Gated pipelines require `HF_TOKEN`, `HUGGINGFACE_TOKEN`, or `PYANNOTE_AUTH_TOKEN` plus model access approval; token is not assumed. |
| PANNs | Package imports in `shortdrama_hq310`; no checkpoint required for the default probe | Availability/status probe only for Step 01. Do not use broad music/SFX labels for normal redraw production. |
| LAION-CLAP | Installed only in `shortdrama_clap310`; practical model/resource verification pending | Isolated experiment only. Do not use for normal redraw production because it mainly helps audio-text retrieval over sound/music and conflicts with the main NumPy stack. |
| BEATs | Not installed by default | Not part of the default redraw workflow. Do not install unless a specific non-music, performance-relevant QA problem justifies it. |
| Qwen2-Audio | `transformers` runtime class available; model weights not loaded | Optional audio-understanding QA only when it helps clarify dialogue/performance. Not a timestamp source and not a default batch dependency. |
| SALMONN / Audio Flamingo / AudioSep | Not installed by default | Research/heavy add-ons. Use only after the stable evidence package exists and when the user explicitly asks for audio-understanding or source-separation QA. Do not use them to create BGM/SFX instructions. |

Practical rule: the accepted Step 01 default path is `WAV -> Silero/energy VAD -> Mimo ASR transcript -> Qwen3-ForcedAligner timestamps via the configured aligner runtime -> speaker second-pass attempt -> audio_event_ledger -> audio-guided unbounded frame extraction`. No alternate ASR may replace Mimo. Heavy audio-language models can add review notes about dialogue or performance, but they must not replace timestamped ledgers, native frames, hard subtitles, or manual shot review. High-quality audio calibration is part of `build_audio_evidence.py --quality-profile hq_full`; `stable_batch` only records a real blocker and does not authorize alternate ASR substitution. Post-added sound effects and background music are excluded.

## Candidate Tools

| Layer | Tool | Link | Best use | Caveat |
| --- | --- | --- | --- | --- |
| Chinese ASR text | Mimo ASR | `sk-`: https://api.xiaomimimo.com/v1; `tp-`: https://token-plan-cn.xiaomimimo.com/v1 | Preferred Chinese transcript source for redraw. | Requires valid shared Mimo key; `sk-` official keys are the parallel path, `tp-` token-plan keys are serial unless explicitly retested. Do not expose tokens in artifacts. |
| Chinese timestamp alignment | Qwen3-ForcedAligner | https://github.com/QwenLM/Qwen3-ASR | Preferred timestamp path on top of Mimo transcript text for SRT output. | Needs `qwen-asr`, model weights, and enough GPU/CPU resources. |
| Offline timestamp comparison | CapsWriter | https://github.com/HaujetZhao/CapsWriter-Offline | Isolated timestamp comparison only when explicitly requested; never a production transcript source. | README does not make it a speaker diarization system; use separate speaker pass. |
| Word-level ASR + diarization | WhisperX | https://github.com/m-bain/whisperX | Word-level timestamps, VAD, speaker diarization through pyannote, good baseline ledger. | Diarization is useful but not perfect; Chinese names and short interjections still need visual/subtitle QA. |
| Word-level ASR fallback | whisper-timestamped | https://github.com/linto-ai/whisper-timestamped | Word-level timestamps and confidence when WhisperX install is blocked. | No full audio-event or emotion layer. |
| Legacy historical comparison only | SenseVoice / FunASR | https://github.com/FunAudioLLM/SenseVoice / https://github.com/modelscope/FunASR | Only compare against old failed runs when explicitly requested. | Retired from the default redraw ASR route; do not use as fallback evidence or prompt-generation input. |
| Speaker diarization | pyannote.audio | https://github.com/pyannote/pyannote-audio | Speaker activity, change, overlapped speech, embeddings, diarization. | Some pipelines require Hugging Face model access and agreements. |
| Speaker identification / diarization framework | sherpa-onnx | https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html | Speaker identification after enrollment, and separate diarization workflows when configured. | Identification is not the same as diarization; unknown speakers need clustering/diarization first. |
| Speaker embeddings / recognition | WeSpeaker | https://github.com/wenet-e2e/wespeaker | Speaker embedding/recognition experiments and possible second-pass speaker labeling. | Needs model setup and either enrollment speakers or a clustering pipeline. |
| Speaker diarization / ASR framework | NVIDIA NeMo | https://github.com/NVIDIA-NeMo/NeMo | Strong speech AI framework for ASR and diarization when GPU/runtime is available. | Heavier than pyannote for quick episode runs. |
| VAD | Silero VAD | https://github.com/snakers4/silero-vad | Lightweight speech/non-speech segmentation before ASR or dense frame windows. | Does not identify speakers or transcribe. |
| Sound/music taggers | PANNs / BEATs / CLAP | Various | Outside the default redraw workflow. | Do not run for normal episodes because post-added sound effects and background music are not useful Step 04 deliverables. |
| General audio understanding | Qwen2-Audio | https://github.com/QwenLM/Qwen2-Audio | Audio-language reasoning when dialogue/performance needs human-readable QA. | Use as a QA/caption layer, not the only source of exact timecodes; do not use for BGM/SFX instructions. |
| General audio/video understanding | SALMONN | https://github.com/bytedance/SALMONN | Optional caption-like interpretation and QA. | Research stack; not a replacement for timestamped ledgers; do not use for BGM/SFX instructions. |
| Long/general audio understanding | Audio Flamingo | https://github.com/NVIDIA/audio-flamingo | Optional audio-language understanding over longer audio. | Check license and model branch before use; only for dialogue/performance QA. |
| Text-query sound isolation | AudioSep | https://github.com/Audio-AGI/AudioSep | Optional source-separation QA only when the user explicitly asks. | Not part of normal redraw production and not for creating BGM/SFX prompts. |

## Ledger Schema

Write CSV/JSON rows with as many of these columns as available:

```text
event_id
start_sec
end_sec
timecode
layer              # dialogue | silence | breath | emotion | roomtone | offscreen | information_cue
speaker
text
emotion
event
confidence
source_tool
notes
```

## How Audio Drives Frame Extraction

- Dialogue starts and ends add frame candidates for mouth movement, reaction shots, subtitle cards, and speaker/listener cuts.
- Story-relevant information cues may add frame candidates only when they affect visible performance or plot comprehension, such as a character reacting to an on-screen phone prompt. Do not add post-added SFX, audio peaks, music hits, or background music candidates.
- Emotion shifts such as suppressed anger, crying breath, laugh, shock gasp, silence, or hesitation add reaction-frame candidates.
- Offscreen speech must be marked as offscreen; it should not automatically become the visible character's line.
- Audio-only evidence never overrides visible frame evidence by itself. It tells the extractor where to look.

## Acceptance

Step 01 audio evidence is accepted when the output includes:

- source WAV path;
- `EPXXX_audio_event_ledger.csv/json`;
- `EPXXX_dialogue_ledger.csv/json`;
- `EPXXX_vad_segments.csv/json`;
- dialogue/ASR ledger or explicit `EPXXX_asr_blocker.json`;
- `EPXXX_audio_tool_status.json`;
- speaker/diarization ledger when available;
- emotion/performance candidate ledger when available;
- note showing whether audio ledgers were fed back into frame extraction with `--audio-events`.
