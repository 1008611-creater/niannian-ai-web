# Post-coding review: Step01 server evidence and website import

Requested outcome: existing `001.mp4` must produce real server Step01 evidence and be visible from the website as subtitles, OCR, shot boundaries, and key frames without entering Step02-05.

Correct operating path: verify exact source hash on the Tencent Seoul Step01 host, reuse the existing Mimo/ForcedAligner/TransNet/native-frame outputs, run real Paddle API smart OCR, run strict evidence validation, create checkpoint and artifact ledger, run `finalize_step01_evidence.py`, then import only verified artifacts into the website protected Step01 view.

Changed files:

- `scripts/build-server-step01-bundle.mjs`
- `scripts/import-step01-evidence-for-web.mjs`
- `scripts/server-step01-runner.test.mjs`
- `deploy/step01/write-paddle-key-from-stdin.sh`
- `deploy/step01/run-paddle-smart-ocr.sh`
- `deploy/step01/finalize-step01-evidence.sh`

Generated or imported evidence:

- Tencent host `/home/hermes/workspace/niannian-step01/output/EP001/step01_evidence_manifest.json`
- Local website data `data/video-redraw-step01/NN-20260715083045-8120F5/step01-evidence-manifest.json`
- Local website artifact copies under `data/video-redraw-step01/NN-20260715083045-8120F5/artifacts/`

Review findings:

- The server bundle now includes `smart_selective_ocr.py` from the source-timeline skill; without this the finalizer's Paddle gate could never pass.
- Paddle secret injection uses stdin and redacts output. The script accepts either a raw token line or `PADDLEOCR_*=` env format and rewrites only the Paddle fields in `step01.env`.
- `run-paddle-smart-ocr.sh` calls the real Paddle API path with `engine=paddle-api`; it does not fall back to RapidOCR or local OCR.
- `finalize-step01-evidence.sh` runs the Skill validation before creating checkpoint/ledger, then delegates final acceptance to the strict Skill finalizer. It does not set Step02 completed.
- `import-step01-evidence-for-web.mjs` fail-closes unless the strict manifest is `status=verified`, `downstream_consumable=true`, the exact source hash/bytes match, and Step02/04/05/provider boundary flags are all false.

Verification performed:

- Server Paddle OCR completed: `candidate_frames=121`, `ocr_rows=34`, `errors=0`, `status=completed`.
- Server validation completed with `ok=true`; counts included 234 source frames, 37 TransNet shots, 111 shot triad rows, 74 legacy subtitle OCR rows, 34 Paddle smart OCR rows, 68 audio events, and 13 dialogue rows.
- Strict finalizer completed with `status=verified`, `downstream_consumable=true`, and no errors.
- Web importer completed with 10 verified artifacts.
- `npm run step01:bundle:build` passed.
- Remote `bash -n` passed for the three Step01 deploy scripts.
- `npm run test:step01-server` passed, 3/3.
- `npm run lint` passed.
- `npm run build` passed.
- Local Step01 result readback returned `status=completed` and 10 artifacts.
- Local Next server started on `http://127.0.0.1:3041`; `/step01` returned HTTP 200. Admin API returned HTTP 403 without login, as expected.

Not verified:

- Public production deployment was not changed.
- Step02-05, video generation, final MP4, COS delivery, and public user download were not run.
