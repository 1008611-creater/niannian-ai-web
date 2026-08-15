# Post-Coding Review: Server Video Step01

## Requested outcome

The fixed short-drama source for `NN-20260715083045-8120F5` must yield server-owned ASR, alignment, OCR, shot-boundary, and original-resolution frame evidence that an authenticated website user can inspect. This review does not claim that outcome occurred.

## Correct path

The server runner must first validate the fixed source hash and bytes, then call the official Mimo ASR route through the deployed Step01 Skill bundle, followed by Qwen ForcedAligner, speaker second-pass, Paddle OCR, TransNetV2, native frames, and the Skill finalizer. It may accept Step01 only after every real artifact is bound to the fixed project/run/source and its bytes/SHA are reverified. The protected `/step01` page must only serve those accepted artifacts.

## Changed files reviewed

- `lib/video-redraw-step01.ts`: fixed identity constants, manifest validation, artifact hash verification, and public result projection.
- `scripts/server-step01-runner.mjs`: official Mimo API base/key-presence and deployed Skill-bundle preflight plus source-binding runner boundary; it fails closed and has no desktop/browser/local OCR fallback.
- `app/api/admin/video-redraw-step01/**` and `app/step01/page.tsx`: administrator-protected status and artifact readback.
- `scripts/server-step01-runner.test.mjs`, `package.json`, and `SERVER_VIDEO_STEP01.md`: validation entrypoints and documented contract.

## Evidence

- `npm run test:step01-server`: 2/2 passed, including missing-contract rejection and exact source/complete-artifact validation.
- `npm run lint`: passed.
- `npm run build`: passed and includes `/step01` plus protected Step01 routes.
- `npm run step01:server:preflight`: `MIMO_ASR_CREDENTIAL_REQUIRED`.
- `npm run step01:bundle:build`: passed; `runtime/server-step01-bundle/bundle-manifest.json` records SHA-256 values for the four required Python entrypoints and contains no credential material.
- Server readback: CPU-only `torch 2.7.1`, `qwen-asr 0.0.6`, `Qwen3ForcedAligner`, OpenCV, TransNetV2 and RapidOCR import/model-load checks passed; `pip check` reports no broken requirements. The fixed ForcedAligner snapshot was downloaded and `verify-server-step01-runtime.py` produced `STEP01_RUNTIME_MODEL_LOAD_PASS` without media or provider calls.
- Exact-source server run: source SHA/bytes and ffprobe matched the fixed project; 16 kHz mono WAV, `EP001_frame_manifest.json`, native reference frames, and TransNetV2 evidence were generated. TransNet accepted 37 shots and wrote all 111 required start/mid/end frames with zero failures.
- Cross-platform repair: `extract_episode_frames.py` no longer fails on the Windows-only Microsoft YaHei font path when running under the restricted Linux service account; it selects an available Linux font or Pillow's default evidence font. The repaired bundle SHA was independently matched after deployment.

## Completion boundary

The exact source is now present on the isolated server and non-provider evidence has been generated. No Mimo or Paddle provider was contacted. The sole earliest blocker is `SECURE_MIMO_CREDENTIAL_INJECTION_REQUIRED`: the server does not yet expose a private Mimo API key to the Step01 runtime, and the user forbids interactive/front-window SSH. Until a non-interactive server-side secret channel is used, Mimo ASR, ForcedAligner inference on Mimo text, Paddle smart OCR, the final verified manifest, and website acceptance remain unexecuted. Step02 remains locked.
