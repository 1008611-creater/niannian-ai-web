---
name: commerce-video-redraw-router
description: "Route product commerce video redraw/remake work from a reference selling video into a target product production pipeline. Use for 带货转绘, 商品种草转绘, 汽车带货转绘, 原视频模板复刻, 参考视频拉片, ASR/OCR/timecode reconstruction, 口播/字幕/手部实拍模板迁移, product truth binding, provider execution QA handoff with Image2, Seedance2, 欢乐马, Tensor.Art, Navos, RunningHub, Hi-light, similar channels."
---

# Commerce Video Redraw Router

## Purpose

Route commerce redraw projects with the proven Mexico short-drama redraw contract, adapted to selling videos:

`Step01 source evidence -> Step02 source commerce template timeline -> Step03 target product truth/assets -> Step04 minimal replacement prompt package -> Step05 real provider execution/QA/delivery`.

This is template-based selling-video replication, not free-form ad ideation. If a reference video exists, the source template controls shot order, camera language, hand actions, speech/caption rhythm, transition logic, proof moments, and CTA shape unless the user explicitly asks to redesign it.

## Proven Pipeline Migration Contract

This router inherits the working short-drama redraw methodology. Do not improvise weaker OCR/ASR or skip upstream evidence.

- Step01 must be audio-first, then audio-guided frame extraction.
- Chinese ASR primary route is Mimo ASR text plus `Qwen/Qwen3-ForcedAligner-0.6B` SRT-grade timestamps on Mimo text.
- `Qwen3-ASR`, WhisperX, `faster-whisper`, SenseVoice, FunASR, and similar tools are fallback or comparison evidence only. In quality mode, do not silently replace Mimo with them.
- OCR primary route is Paddle API smart OCR: `PP-OCRv6` for normal subtitles/plain text and `PaddleOCR-VL-1.6` for difficult phone/screen/UI/comment/danmu/document/layout crops.
- Local OCR, tesseract, RapidOCR, or local PaddleOCR are not default fallback. Use only if the user explicitly accepts a downgrade and record it.
- Hard subtitles / verified visible text outrank ASR when they disagree.
- Raw OCR, raw ASR, UI chrome, hallucinated text, and unresolved speaker/copy candidates stay in sidecars, not in accepted deliverables.
- A downstream prompt package may not consume old drafts, rough prompt folders, or plan-only artifacts as accepted source truth.

When the task is automotive commerce redraw, also read `references/automotive-commerce-redraw.md`.

## Clean Contract Chain

### Step 01 Reference Commerce Evidence Extraction

Input: one reference commerce video and output folder.

Output: accepted evidence package containing:

- source video metadata: duration, fps, aspect, resolution, sha256;
- mono 16 kHz WAV and audio ledgers: VAD, dialogue, speech density, pauses, CTA/copy turns, performance timing;
- Mimo ASR raw/text output and Qwen3-ForcedAligner transcript/SRT/segments when available;
- explicit blocker if Mimo or timestamp alignment required but unavailable;
- TransNetV2 shot boundaries, optional comparison detector notes;
- unbounded native-resolution reference frames, not arbitrary low frame-count caps;
- shot start/mid/end supplements;
- Paddle API smart OCR candidate/ledger outputs for subtitles, captions, phone/UI/text, product plates, comments, visible offers, CTA text;
- hand/action evidence: pointing, touching, holding phone, opening product, showing detail, cockpit/console actions, before/after gestures;
- evidence manifest and validation report.

Do not write replacement product prompts in Step01.

Acceptance: evidence is complete enough to reconstruct shot-level template, copy timing, hand actions, visible text, and CTA. If primary ASR/OCR resources are missing, write a blocker such as `external_resource_failure:mimo_asr_unavailable` or `external_resource_failure:paddle_ocr_token_missing`; do not pretend the evidence chain is complete.

### Step 02 Source Commerce Template Timeline

Input: accepted Step01 evidence.

Output: clean original source-template timeline. It must describe the reference video as-is, before target-product replacement.

Required clean objects:

- `sourceRows`: one row per meaningful shot/camera state, with timecode, composition, camera motion, product part, hand/action state, visible text, speech/caption ids, marketing function, transition/CTA logic.
- `sourceActionAudits`: one row per hand/object-near-product moment, with exact seconds, hand side, contact object, concrete action verb, repetition count, entry/exit path, contact yes/no, evidence frame paths, confidence, and any correction note. ASR/OCR/contact sheets do not complete this; inspect source video or timecoded frames densely around possible contact windows.
- `copyBindings`: one complete spoken/caption utterance per id, with start/end time, exact source copy, evidence basis, subtitle/ASR/manual status, and owner such as offscreen narrator, visible host, on-screen caption, phone/UI text.
- `textBindings`: visible screen/caption/plate/comment/document/UI text, source time range, screen position, exact cleaned text, story/selling use, and whether to regenerate, post-add, or avoid.
- `commerceActionLedger`: product reveal order, proof moments, objections, benefit claims, demonstrations, hand actions, CTA beats.
- `hardSceneCandidates`: clips likely needing first-frame/image anchoring, such as readable UI/text, product plates, precise hand-product proof, screen-in-screen, complex showroom reflections, or dense live-commerce interfaces.
- `blockers`: unresolved copy, visible text, speaker/owner, product claim, or evidence gaps that prevent clean handoff.

Rules:

- Reconstruct the original template; do not replace product, invent shots, simplify into broad beats, or write final prompts.
- Use Mimo ASR plus Qwen3-ForcedAligner timestamps as trigger evidence, then reconcile with subtitles, Paddle OCR, native frame review, and manual video inspection.
- Dense sample around short captions, fast subtitles, CTA flashes, and user-flagged windows at 0.1-0.2 seconds when needed.
- Dense sample hand/object contact windows at 0.25-0.5 seconds. Distinct repeated touches, taps, presses, pats, pointing, opening, or holding actions must keep count and approximate seconds; these are template structure, not optional styling.
- Keep source timecode as the authority. Later Step04 video prompts may use relative seconds inside each clip, but accepted source rows keep original time.
- Do not deliver placeholders such as `未知`, `待确认`, `speaker_unknown`, `按原片`, `见抽帧`, or raw ASR/OCR garbage. Block and repair evidence instead.

### Step 03 Target Product Truth And Asset Authority

Input: target product, official/authorized URLs, user-provided images, product facts, usable asset permissions.

Output:

- `productTruthPack`: exact model/SKU/version, allowed claims, forbidden claims, visible identity locks, usage scenarios, compliance notes;
- `assetAuthorityManifest`: target images/videos/logos/packaging/product pages, path/url, sha256 when local, source/permission status, allowed use;
- `replacementPolicy`: what source-product facts can be replaced, what must stay generic, what source claims must be removed;
- `forbiddenClaimList`: exact price, discount, ranking, finance terms, specs, location, official endorsement, store/phone/license plate, or comparison data not verified.

If target product truth/assets are unclear, stop with `product_authority_required`; do not substitute guessed facts or generic product identity.

### Step 04 Template Adaptation Prompt Package

Input: accepted Step02 source template plus accepted Step03 product truth/assets.

Output: production prompt package, provider specs, QA checklist, and ledger entries.

The object chain is:

`sourceRows -> copyBindings/textBindings -> productBindings -> assetRegistry -> videoGroups -> providerSpecs -> QA checklist`.

Rules:

- Minimal replacement only: preserve source template timing, composition, camera, hand actions, copy rhythm, CTA shape, and transition logic; replace only the required source-product identity/facts/text with verified target-product material.
- Do not write prompts from raw OCR/ASR dumps or earlier rough prompt folders. Consume only accepted Step02/Step03 objects.
- Build grouped video prompts in 4-15 second clips unless the selected provider/user requires a different duration. For a longer source video, split by source logic and provider duration limits.
- Spoken copy should follow the source copy skeleton and fit the real clip duration. For 15-second product clips, default Chinese spoken copy is usually 50-100 characters unless the source template is intentionally sparse.
- If provider should generate speech/audio synchronously, put spoken copy into the provider spec and record it as provider-generated audio. Do not silently switch to a separate post voiceover path.
- Visible text policy must be explicit per binding: generate in model only when reliable, otherwise add in editing layer, provider caption layer, or remove if unsafe/unverified.
- Normal prompts should not say `按原片` or `参考原视频` as a substitute for concrete evidence. Convert source evidence into camera, composition, hand action, product part, lighting, and timing details.
- First-frame/image anchors are used only when hard-scene candidates or provider limitations require them, not for every shot.
- QA fail conditions must include source-template breakage, target identity drift, unverified claims, wrong hand/product action, malformed visible text, and provider artifact defects.


- If a product-redraw clip fails because the provider added unwanted subtitles/caption bars, the spoken copy drifted from the prompt, or a generic product first frame made motion unstable, do not keep tweaking the same video prompt. First create a true 9:16 video first frame / storyboard first frame from the source-template frame plus the verified target-product identity asset, QA that still as a single image, then submit video from the verified frame. The provider spec must distinguish allowed diegetic text from forbidden subtitles/overlays and require exact synchronous voiceover when the channel supports audio.

### Step 05 Provider Execution, QA, Delivery

Input: only verified Step04 prompts/assets/specs.

Output: real generated clips/images, provider logs, QA reports, artifact ledger updates, final edit/delivery manifest.

Execution rules:

- Use the selected channel skill/provider workflow; do not switch providers just because another is easier.
- Record account/channel, model, resolution, aspect, duration, upload method, prompt body, seed/settings if exposed, input asset paths, output paths, sha256, and QA status.
- Preserve accepted Step04 prompt bodies. Provider-specific metadata may be separate, but do not rewrite source-template/product-truth logic during execution.
- Generated is not verified. Only actual files that exist, are registered, and pass visual/content QA can be used downstream.
- Do not report done from provider status alone, plan-only runs, stale downloads, latest-file scans, or old prompt folders.

### Storyboard Image Route

If a commerce redraw project has accepted first frames and the user asks for `故事板`, route to `image2-storyboard-video` before provider video execution. In this context storyboard means an Image2-generated 16:9 production-board image that uses the accepted first frames as visual references. It is not a written shot table, not a prompt list, not the Step02 timeline, and not a contact sheet of first frames.

Provider video execution must be blocked with `storyboard_image_required` when the requested storyboard image is absent or not QA-passed. The storyboard image should lock hand/arm style, product or vehicle identity, scene/background continuity, camera route, 6-9 visual beats, lighting mood, audio/voiceover notes, and cinematography notes. Video prompts may reference the storyboard image as a visual authority, but must not carry internal production labels such as PV IDs, source timecodes, or source row names into model-facing prompts.

## Routing Rules

1. If user provides a reference video and asks redraw, replicate, reuse template, or "按原视频来", run Step01 then Step02 before any prompt writing.
2. If the user asks for prompts but no accepted source template timeline exists, create Step01/Step02 first.
3. If target product assets/facts are missing or uncertain, run Step03 and block on `product_authority_required` instead of inventing claims.
4. If a later step is requested without accepted upstream artifacts, run the missing previous step first.
5. If provider/channel is specified by user, use that channel's learned workflow.
6. If a provider output changes target product identity, body shape, logo, packaging, hand action, or source-template logic, mark it `qa_failed` and redo the segment.
7. If old drafts exist, treat them as diagnostic only unless they are explicitly accepted manifests from this contract.

## Layered Route Tree

Use this route tree for commerce redraw work:

```text
commerce-video-redraw-router
-> product/domain route
-> project/platform specialization
-> provider channel execution
```

Current automotive/Dongchedi branch:

```text
commerce-video-redraw-router
-> automotive-commerce-redraw-video
-> dongchedi-automotive-commerce-redraw
-> image2-storyboard-video for storyboard boards
-> ai-video-channel-router
   -> hilight-video-channel
   -> mimo-8001-video-channel
```

Routing rules for this branch:

- If user says 汽车带货转绘, 车辆种草转绘, BMW/宝马, 展厅看车, 手部实拍口播, use `automotive-commerce-redraw-video` after this total router.
- If user says 懂车帝, 懂车帝参考视频, 懂车帝车牌, 懂车帝风格, or current run is BMW3/Dongchedi, additionally use `dongchedi-automotive-commerce-redraw`.
- If user says 故事板 or the channel needs a stable image source, use `image2-storyboard-video` to create actual 16:9 storyboard boards before video generation.
- If user chooses Hi-light or Mimo, channel choice happens only after accepted storyboard boards and locked video prompts exist.

## Commerce Template Standard

Recover source video as a reusable selling template:

- Hook: first 3-8 seconds, exact promise, curiosity mechanism, pain point, or product reveal.
- Product sequence: reveal order, close-ups, comparison shots, hands-on demonstrations, detail inserts, usage scenario, proof moments, objections, final CTA.
- Camera language: handheld/static, push-in, pan, orbit, top-down, rack focus, mirror/self-shot, showroom/store/desk/car-cabin perspective.
- Human presence: hands, arms, body fragments, no-face host, voiceover, offscreen speaker, full presenter only if source/user requires it.
- Copy rhythm: speech density, sentence length, caption timing, repeated phrases, punchline placement, CTA wording.
- Text policy: visible source text must be classified as speech/caption/UI/product plate/document/CTA and assigned generate/post-add/remove handling.
- Commerce mechanics: lead capture, comment keyword, DM CTA, store visit CTA, product benefits, objections, proof moments, trust cues.

## Automotive Redraw Route

For cars, the reference video provides composition/action/copy rhythm only. Vehicle identity must come from official/authorized target-car images or user-approved assets.

- Keep original template if it is showroom hand-shot review: front-view hook, grille/light close-up, wheel/side profile, cockpit/console/seat touch, steering wheel/driver view, front-view CTA.
- Do not invent road-driving, racing, dealership claims, fake license plates, fake prices, discounts, financing, locations, or sales rankings unless both source template and product authority support them.
- Provider upload references are not an evidence dump. Each uploaded image must be target-safe for identity, scene, and camera; translate source-video layout/hand/camera evidence into the prompt unless the channel supports separate role-labeled references and the user approves that exact source frame.
- For Mimo/Seedance-style image-conditioned video, do not upload source video frames, official identity boards, standalone plate/logo crops, or contact sheets as video references by default. Use the verified target first frame(s) created from the template evidence.
- For BMW3/Dongchedi runs, Mimo/Hi-light video references must come from the current accepted storyboard board or verified target first frame registered by the Dongchedi route. Legacy `SB01_S01_firstframe.png` through `SB17_S17_firstframe.png` packs are valid only when the current run explicitly accepts that legacy pack.
- If only one image can be uploaded, first create a true first frame matching source template with target car, then use verified first-frame video.
- Hand demonstrations are allowed and often valuable. Faces/digital presenters are not added unless source template or user explicitly requires them.
- Avoid readable generated dashboard/license/store text unless controlled by product truth and provider reliability.
- QA fail any clip where car model, grille, lights, badge, wheel shape, cabin, body panels, hand action, or camera perspective breaks.

## Script And Voice Policy

Use the source video's copy skeleton and adapt only with verified target-product facts. Forbidden without evidence: exact price, discount, "lowest", "best in class", finance terms, fake store name, fake phone number, fake plate number, fake official endorsement, unverified specs, fake comparison data.

## Required Handoff

Return one of:

- selected step and why;
- missing upstream artifact required;
- current step checkpoint artifact paths;
- blocker exact failure code;
- final pass only after QA, ledger, and delivery manifest are verified.
