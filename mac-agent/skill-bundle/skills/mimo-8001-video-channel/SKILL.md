---
name: mimo-8001-video-channel
description: Operate the Mimo AI video channel at https://fd.aancn.cn for real Seedance 2.0 video generation. Use when the user mentions Mimo, fd.aancn.cn, AI 视频生成, this channel, direct upload/generate/poll/download, or wants to avoid slow manual canvas operation while preserving account, credit, artifact ledger, and QA boundaries.
---

# Mimo 8001 Video Channel

Use this channel only for real provider execution. Do not fake outputs, do not mark generated clips verified before media probe plus visual QA, and do not print passwords, tokens, cookies, or verification codes.

## Channel Facts

- Base URL: `https://fd.aancn.cn`
- Previous Mimo origins are historical only and must not route current login, upload, submit, poll, or download work.
- Frontend title: `AI 视频生成`
- Visible model label: `Seedance 2.0 · AI 视频生成`
- Auth: `Authorization: Bearer <token>` from `/api/auth/login` or an already stored token.
- Supported duration options from frontend: `2` through `15` seconds.
- Supported aspect ratios from frontend: `9:16`, `1:1`, `16:9`, `4:3`, `3:4`.
- Upload limit from frontend: max 12 materials; audio max 3.
- Task statuses: `50` queued, `20` or `60` generating, `1` completed, `40` failed.

## Preferred Workflow

Prefer the API client over hand-clicking the UI. The UI source contains an `autoCancel` behavior that can call `/api/video/cancel` when a queued task enters generation; the API client intentionally never calls cancel.

1. Prepare one approved source image and one locked 50-100 Chinese character voiceover prompt per 15s shot.
   - If native voice/audio is requested, include a concrete voice persona block in the prompt, not only "自然口播": speaker role, Mandarin/accent, timbre, phone-capture/mic feel, speed, emotion, delivery style, and negative voice constraints such as not ad-announcer, not AI-synthetic, not news-reading.
   - Approved 9:16 input means a true vertical first frame with useful composition: generate or edit a real target-world vertical first frame when the source evidence is horizontal.
   - If the only asset is horizontal, upload it only as identity/structure evidence and request `aspectRatio: "9:16"`, or first create a real vertical first frame through an image-generation/editing workflow.
   - For reference redraw / 转绘 work, write the prompt so the uploaded image locks identity, product structure, lighting, material, and camera direction, while the video body describes the real scene to generate. Do not ask the model to copy a storyboard, poster, catalog image, or padded layout.
2. Authenticate with an existing token or username/password from the approved account source. Never echo secrets.
3. Upload image references through the official frontend-compatible `upload-apply -> object storage -> upload-commit` route. The bundled client uses this for images by default; use `--upload-strategy legacy_api` only for a verified compatibility rollback. Video and audio material uploads retain their supported channel payloads.
4. Submit with `POST /api/video/generate`:

```json
{
  "prompt": "...",
  "duration": 15,
  "aspectRatio": "9:16",
  "images": [{ "imageUri": "...", "imageUrl": "..." }]
}
```

5. Poll `POST /api/video/batch-status` with `{ "taskIds": ["..."] }` every 10 seconds until status `1` or `40`.
6. Download the completed video:
   - If `videoUrl` is a direct TOS URL, fetch it directly.
   - Otherwise call `POST /api/video/proxy-token` with `{ "url": videoUrl }`, then fetch `/api/video/proxy-video?token=<token>` without printing the token.
7. Probe with `ffprobe`: require vertical 9:16, target 15s, audio stream present if the task required native voice/audio.
8. Visual QA before `verified`: BMW identity, no wrong car model, no fake text, no fake plate, no unwanted people/face, stable wheels/body/interior, no ratio failure.

## Reference Image Preflight For Redraw

Mimo treats every uploaded image in `images[]` as active video reference. A wrong extra image can poison vehicle identity, scene, and camera result.

For redraw/remake work:

- Upload approved target first-frame image(s) for the exact shot as the primary anchor. For redraw/remake, original source frames/contact sheets are evidence only; first create a clear redrawn target-world first frame through image generation/editing, obtain user confirmation, then upload that image.
- When the visual fact ledger names material-critical props that text alone will not reliably generate, prepare supporting prop references before submission. Examples: couple acrylic photo frame, white earpiece at the ear, beige ring box with deep-blue lining, white paper document handoff.
- Every supporting reference must have one written duty in `mimo_reference_plan.json`: identity, prop structure, hand action, material/color, or unreadable-text policy. Text-bearing props should be clear physical objects with unreadable abstract layout. The prompt must repeat those duties in positive language.
- 转绘一致性要求：只提交已确认职责的参考图。主角身份图、关系合影/相框图、剧情关键道具图，必须先得到用户最终确认，才能进入 Mimo 上传图片列表。候选图、旧图、临时图、派生图都不自动算最终图。用户否决人物图时，撤出该图和所有由它派生的关系图，设置 `submit_allowed=false`，并写一致性确认请求。
- Mimo 提交前必须读取中文最终参考图确认单；每个上传图片必须有 `最终文件路径`、`中文职责`、`用户确认状态=已确认`、`可上传状态=是`。没有确认单或任一行未确认时，不得生成提交命令。
- 正确执行顺序：读取最终参考图确认单 -> 只上传已确认图片 -> 在提示词里按中文职责引用每张图 -> 提交生成 -> 下载成片 -> 做画面质量检查。不能从候选文件夹或旧包里自动挑图。
- Mimo upload count stays within the frontend limit of 12 materials. Fewer, clearer references beat many mixed references.
- For people, use target identity references first. A source crop may be active only when it is cleaned, subtitle-free, and role-limited to structure/action/prop; contact sheets stay inspection-only unless the user explicitly approves exact file submission.
- Do not upload source-template frames, reference video screenshots, official product identity images, standalone logos/plates/crops, contact sheets, or prompt screenshots as video references unless the user explicitly approves that exact file for that exact submission.
- If using visible CDP, clear/refresh the page before the next shot so old uploaded materials cannot carry over.
- Visible staging fast path: when the user needs to see Mimo before submitting, do not waste time on in-app Browser file chooser or `setInputFiles`; it does not support uploads. Use the already open Chrome/Edge CDP target for `fd.aancn.cn`, set prompt/duration/aspect in the visible page, then call CDP `DOM.setFileInputFiles` on `input[type=file]` with the approved first-frame image and fixed voice-reference audio. Dispatch `input` and `change`, click only the upload button, wait until the visible material count matches expectation, and stop before `生成视频` unless the user explicitly approves submission.
- Before Generate or API submit, list the absolute image paths, count, and filenames in the run checkpoint/ledger; if any path or filename is unexpected, stop with `mimo_reference_mismatch`.
- If generation returns provider error `图片中包含人物` or any human-portrait/person/privacy reference blocker for an approved first frame, record `provider_policy` blocker. The user-approved retry is to process only the blocked upload reference through `http://127.0.0.1:9093/face`, record original/processed path and sha in `face_preprocess_manifest.json`, create a derived spec or run manifest entry, and retry Mimo image-to-video with the locked prompt. Do not default to text-to-video or regenerate a non-person first frame for this blocker unless the user separately asks for that degraded route.
- If user approval is required or user said they will submit, prepare materials/prompt/settings visibly and stop before Generate.

BMW 3 Series Dongchedi rule:

Current default source image is the accepted storyboard board provided by `dongchedi-automotive-commerce-redraw`, not the old SB first-frame set. The uploaded image path must match the current shot's accepted Stage B storyboard board and must be registered in the run ledger as `verified_by_user_acceptance` or equivalent accepted status.

Historical compatibility only:

- Approved folder: `C:\Users\lsb\Pictures\ai视频\懂车帝\转绘宝马3\06_正式证据链_20260704\05_故事板首帧\images`
- Approved filenames: `SB01_S01_firstframe.png` through `SB17_S17_firstframe.png`.
- Legacy mapping is one image per shot only when the current run explicitly accepts this pack: S01 -> `SB01_S01_firstframe.png`, S02 -> `SB02_S02_firstframe.png`, continuing through S17.
- Multiple references are allowed only when the user explicitly asks for consecutive target first frames such as "前三张" or "连续参考"; then use only consecutive `SBxx_Sxx_firstframe.png` files from the approved folder.
- Never replace the SB image with `shot_*.png`, official BMW identity assets, standalone Dongchedi plate crops, outdoor scene images, or any other asset class by convenience.

## Script

Use `scripts/mimo_client.mjs` for direct operation:

```powershell
node C:\Users\lsb\.codex\skills\mimo-8001-video-channel\scripts\mimo_client.mjs `
  --base https://fd.aancn.cn `
  --token-env MIMO_TOKEN `
  --image "C:\path\shot.jpg" `
  --prompt-file "C:\path\S01_prompt.txt" `
  --duration 15 `
  --aspect-ratio 9:16 `
  --out "C:\path\S01_mimo.mp4" `
  --manifest "C:\path\S01_mimo_manifest.json"
```

Alternative login flags are `--username-env MIMO_USERNAME --password-env MIMO_PASSWORD`. Prefer environment variables over command-line literal secrets.

For an existing task:

```powershell
node C:\Users\lsb\.codex\skills\mimo-8001-video-channel\scripts\mimo_client.mjs `
  --token-env MIMO_TOKEN `
  --task-id "<task-id>" `
  --out "C:\path\clip.mp4"
```

## Project Ledger Rules

For every real submission, record:

- account identifier without password/token;
- uploaded material local path, sha256, and returned `imageUri`/`imageUrl`;
- task id, duration, aspect ratio, prompt file path and sha256;
- output path, sha256, ffprobe result, QA status.

If auth fails, quota is insufficient, upload fails, generation fails, download fails, or QA fails, write the blocker to `checkpoint.json` and do not mark the clip verified.
## 2026-07-08 Dongchedi BMW3 Guard
For Dongchedi BMW3/Mimo formal reruns:
- Upload the accepted first-frame/storyboard image only after the upstream route records visual scene continuity. A correct folder path alone is not enough for full batch submission.
- If native voice used, upload approved voice reference audio material and submit the frontend-compatible shape `audio: [{ "imageUri": "<uploaded-audio-imageUri>", "imageUrl": "<uploaded-audio-imageUrl>" }]`; record `audio_count` and `audio_payload_shape=imageUri_imageUrl` in submitted manifest. If `audio_count=0`, status `voice_timbre_unlocked`.
- Mimo integer duration for spoken shots must be `ceil(source_duration_seconds)`. Examples: `7.53 -> 8`, `8.26 -> 9`, `8.4 -> 9`.


## 2026-07-09 Audio Payload Correction

When native voice is used, upload the approved voice reference audio material and submit the frontend-compatible shape `audio: [{ "audioVid": "<uploaded-audio-vid>" }]`. Audio uploads may also return `imageUri/imageUrl`, but Mimo frontend maps audio materials to `audioVid`; sending audio as image fields can be ignored by provider. Record `audio_count`, uploaded audio `vid`, and `audio_payload_shape=audioVid` in submitted manifest. If `audio_count=0` or submitted payload lacks `audioVid`, status `voice_timbre_unlocked`.
