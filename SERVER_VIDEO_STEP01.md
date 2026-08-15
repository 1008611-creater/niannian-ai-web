# Server Video Redraw Step01

This is a fixed, server-owned analysis path for `NN-20260715083045-8120F5` only. It is not a replacement for the existing image redraw runtime or the legacy Mac task worker.

Run the no-media preflight with `npm run step01:server:preflight`. Mimo ASR calls the official endpoint directly; do not create an extra Mimo adapter.

| Service | Required contract |
| --- | --- |
| Mimo ASR (`mimo-v2.5-asr`) | `https://api.xiaomimimo.com/v1` for official `sk-` credentials; `https://token-plan-cn.xiaomimimo.com/v1` for `tp-` credentials |

The runner requires a private `MIMO_API_KEY` (or compatible Mimo key environment name), an approved official API base, and a deployed copy of the fixed Step01 Skill scripts. It does not fall back to a desktop, browser session, local OCR, or local ASR. A completed manifest is accepted only when it binds the fixed project, run, source SHA/bytes, and all five evidence roles: ASR, alignment, OCR, shot boundaries, and original-resolution frames.

The protected result page is `/step01`. It is restricted to configured administrators and verifies artifact bytes and SHA before serving an evidence file. No API key, provider request body, signed URL, local path, or provider task ID is exposed by that page.
