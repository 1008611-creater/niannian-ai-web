# Post-coding review — 念念AI Web

## 2026-07-12 real BMW demo video with TK captions

### Requested outcome

Use the user-provided `3.mp4` as the public homepage proof asset, first adding restrained TikTok/CapCut-style burned-in Chinese captions without overwriting the source video.

### Correct operating path

1. Probe the user source and preserve it unchanged.
2. Transcribe the real audio, correct obvious ASR errors against the automotive subject, and create phrase-level Chinese ASS/SRT captions with selected keyword highlights and zero overlap.
3. Burn subtitles into a new MP4, preview hook/middle/closing frames, probe and fully decode the output, then copy the accepted artifact into `public`.
4. Replace the static hero image with a real HTML5 video: muted autoplay, loop, inline playback, native controls, and ordinary metadata outside the media.
5. Verify desktop/mobile playback locally, deploy only the intended files, rebuild only the app container, and read production playback state back from the browser.

### Source, generated artifacts, and changed files

- Source preserved: user-provided `3.mp4`, 720×1280, 30fps, H.264/AAC stereo, 12.003991 seconds, 2,472,024 bytes.
- `output/tk-subtitles-3/3_transcript_reviewed.json`: ASR draft plus manually corrected six-phrase transcript.
- `output/tk-subtitles-3/3_tk_reviewed.ass`: phrase-level Chinese TK captions with Microsoft YaHei Bold, white text, black outline, and selected yellow highlights.
- `output/tk-subtitles-3/3_tk_reviewed.srt`: reusable plain caption track.
- `output/tk-subtitles-3/3_tk_captioned.mp4`: captioned review master.
- `public/demo-bmw3-tk.mp4`: exact copy of the accepted captioned master for the public homepage.
- `app/page.tsx`: replaces the generated hero image with a real video element and accessible fallback.
- `app/globals.css`: uses a restrained 9:16 work-sample frame rather than stretching or cropping the vertical video.

### Verification evidence

- Transcript corrected to six phrases: `近看前脸…`, `双肾格栅…`, `灯组线条…`, `车头不会用力过猛`, `但你走近看`, `运动感和精致感都在`.
- ASS contains six phrase events and the reviewed timing contract records `overlaps: 0`; no per-word karaoke effect was used.
- Hook, middle, and closing caption frames were extracted and visually inspected. Text stayed in the lower-third safe area, remained readable over black bodywork, and highlighted only key selling terms.
- Captioned master: 720×1280, 30fps, H.264 High yuv420p + original AAC stereo, 12.003991 seconds, 3,214,244 bytes.
- `ffmpeg -v error -i 3_tk_captioned.mp4 -f null -` completed with exit code 0.
- `npm run build` and `npm run lint` passed locally; the production Docker build also passed.
- Local desktop browser: video autoplay advanced, `paused=false`, `muted=true`, duration read as 12.003991, media error null, and page width matched viewport width.
- Local 375px mobile browser: video autoplay advanced at 345×613 CSS pixels with no horizontal overflow or media error.
- Production browser: the video loaded without console warnings/errors; after media readiness, playback advanced to 0.56637 seconds with `paused=false`, error null, and correct duration.
- Local/production SHA-256 matched for `app/page.tsx`, `app/globals.css`, and `public/demo-bmw3-tk.mp4` before rebuilding the app-only container.

### Stops-too-early and residual risk

- The task did not stop at subtitle files or a build: the burned video was decoded, frame-reviewed, integrated, deployed, and observed playing in production.
- Whisper Tiny produced obvious Chinese homophone errors; those were not shipped verbatim. The final transcript was manually corrected from the automotive context and sentence meaning. A second human listener did not independently confirm every syllable.
- The user supplied and explicitly requested public use of the video. This review does not independently verify third-party trademark, music, footage, or voice rights.

## 2026-07-12 homepage hero realism correction

### Requested outcome

Correct the visual direction after the first Image2 hero was judged too AI-generated, replacing explanatory AI imagery with a believable finished-commerce-video frame.

### Correct operating path

1. Treat the first generated image as a rejected visual candidate, not as an accepted production authority.
2. Remove the failed visual vocabulary: floating cards, light trails, glow frames, pink haze, idealized beauty-ad skin, and an image that tries to diagram generation.
3. Generate a new full raster remotely through the approved primary Krill `gpt-image-2` channel; do not locally patch or composite the rejected candidate.
4. Present the new image as a restrained real work sample. Keep product explanation in HTML, outside the image, with no overlay glow or floating UI.
5. Verify the integrated page locally at desktop and mobile widths, deploy app-only, and read the production image and layout back in a browser.

### Generated asset and changed files

- `public/hero-commerce-image2-v2.png`: a fresh Krill `gpt-image-2` high-quality 1536×1024 generation, 1,956,220-byte PNG. It depicts a naturally lit clothing-store commerce-film frame with an unposed model and a clearly readable navy jacket. No local raster editing was used.
- `app/page.tsx`: switches the active homepage source to V2, uses a concrete commerce-film alt description, and replaces the overlaid AI caption with a restrained note below the image.
- `app/globals.css`: removes the active glow/gradient-overlay treatment, reduces radius and shadow, and styles the note as ordinary product metadata rather than an AI-tech label.

### Verification evidence

- V2 was opened and inspected before integration: no floating UI, light trails, generated text, logos, neon, beauty-ad glow, or impossible composition; garment construction, skin, store surfaces, and lighting evidence are materially more natural.
- `npm run build`: passed locally and in the production Docker image.
- `npm run lint`: passed (`tsc --noEmit`).
- Local desktop browser: image loaded through Next Image, the note was not overlaid, and page `scrollWidth` equaled `viewportWidth` at 1265px.
- Local 375px mobile browser: image loaded at 347px width and the page had no horizontal overflow.
- Production browser: V2 URL loaded, note remained outside the image, page width matched viewport width, and browser warnings/errors were empty.
- Local/production SHA-256 matched for `app/page.tsx`, `app/globals.css`, and V2 before the app-only rebuild.
- Krill succeeded; OOC and RunningHub were not used. No video quota was consumed.

### Stops-too-early and residual risk

- The first generated visual is explicitly recorded as rejected and is no longer referenced by runtime code; it was not silently treated as an accepted success.
- The new direction is intentionally quieter. It proves believable output quality instead of explaining all platform inputs in one image; the surrounding HTML continues to explain the workflow.
- The current desktop and 375px mobile layouts were verified, but visual taste remains subjective and should continue to follow user feedback.

## 2026-07-12 Krill Image2 homepage hero release

### Requested outcome

Replace the low-quality CSS wireframe illustration on the public homepage with a genuinely high-quality Image2 visual and show the integrated result.

### Correct operating path

1. Generate a new production asset remotely with Krill `gpt-image-2`, using RunningHub only if Krill fails.
2. Inspect the generated raster directly before accepting it; do not locally retouch, composite, patch, or upscale it.
3. Save the accepted image under the project `public` directory, render it through Next Image, and keep all conversion copy and calls to action as real HTML.
4. Verify local desktop and mobile layouts, deploy only the intended source and asset files, rebuild only the app container, and verify the production image actually loads.

### Generated asset and changed files

- `public/hero-commerce-image2.png`: generated by Krill `gpt-image-2`, high quality, 1536×1024 request, 1,822,802-byte PNG. It visualizes person, product, scene, and motion references converging into a vertical commerce-video result. No local pixel editing was used.
- `app/page.tsx`: replaces the fake workflow window with the generated visual, accessible alt text, responsive Next Image sizing, and a small HTML caption.
- `app/globals.css`: adds the image frame, restrained gradient/caption treatment, responsive sizing, and mobile caption rules.

### Verification evidence

- Generated file was opened and visually inspected before integration: coherent subject, product, scene, motion-card structure, no generated text/logo/watermark, and palette matches the site accent.
- `npm run build`: passed locally and again inside the production Docker image.
- `npm run lint`: passed (`tsc --noEmit`).
- Local desktop browser: image loaded, measured 611×408 CSS pixels, page `scrollWidth` equaled `viewportWidth` at 1265px.
- Local mobile browser: image loaded at 347×232 CSS pixels; `scrollWidth` equaled `viewportWidth` at 375px.
- Production browser at `https://sd2.cauai.fun/`: the new visual existed and loaded, page width matched viewport width, and console warnings/errors were empty.
- Local/production SHA-256 matched for `app/page.tsx`, `app/globals.css`, and the PNG before the app-only Docker rebuild.
- No video-generation task or video quota was used. OOC and RunningHub were not called; Krill succeeded on the primary route.

### Stops-too-early and residual risk

- This review did not treat a standalone image as completion: the accepted asset was integrated, built, deployed, and read back from the production page.
- The original CSS demo styles remain inert because their markup was removed. They are a future cleanup opportunity but do not enter the runtime path.
- The visual was checked at the current desktop viewport and 375px mobile width; additional device/browser combinations were not exhaustively tested.

## 2026-07-12 production completed-video playback repair

### Requested outcome

Restore reliable in-page playback for a completed customer video on `/home`, while keeping the existing download path and avoiding any new provider generation or quota use.

### Correct operating path

1. The completed task renders its MP4 inside a full-width task output block.
2. The video endpoint supplies browser-compatible H.264/AAC MP4 data with byte-range support.
3. A visible playback button calls the native video element; if an embedded/mobile browser rejects audible playback, the same click retries muted playback and leaves the native controls available for unmuting.
4. The play state changes the button to `暂停视频`, the timeline advances, and the download link remains below the player.

### Root cause and changed files

- `app/globals.css`: the selector `.generator-task-list article > div` was too broad and forced the nested output container into a horizontal flex row. It was narrowed to `.generator-task-head`; the video output now has its own grid layout and action row.
- `app/home/page.tsx`: the task heading received the matching class; completed results now use `TaskVideoPlayer`, which provides a visible play/pause control, friendly failure feedback, and a muted retry for restrictive browser media policies.

### Verification evidence

- `npm run build`: passed locally and again inside the production Docker image.
- `npm run lint`: passed (`tsc --noEmit`).
- Local and production SHA-256 hashes matched for both deployed source files before rebuilding the app-only container.
- Authenticated production browser test on `https://sd2.cauai.fun/home`: output layout computed as `grid`, action row as `flex`, exactly one `播放视频` button and one download link were present.
- The initial audible attempt reproduced the embedded-browser rejection without a media decoding error. After the compatibility retry was deployed, playback was `paused: false`, `muted: true`, error code was null, time advanced from `0.340947` to `4.423929`, and exactly one `暂停视频` button was present.
- No video-generation task was submitted and no provider quota was consumed.

### Stops-too-early and residual risk

- The review did not stop at a successful build or a loaded first frame; it clicked the production control and read the live media timeline after deployment.
- Audible playback still depends on each browser's media policy. Restrictive browsers begin muted and the viewer can unmute with the retained native controls. The MP4 endpoint, download behavior, and playback on browsers outside the in-app browser were not re-tested in this repair pass.

## 2026-07-12 production worker release review

### Requested outcome

Make the deployed 念念AI视频工作台 production-capable: remove unstable entry redirects and ensure an administrator-authorized customer task can travel through channel M submission, provider polling, download, technical media checks, and a final content-QA delivery gate.

### Correct operating path

1. An unauthenticated visitor reaches `/login` directly from `/`, while protected pages independently enforce their own access boundary.
2. A customer task stores the locked prompt plus confirmed first-frame and motion references.
3. An administrator records cost/credit readback and explicitly authorizes the task.
4. The Docker `video-worker` selects the Mimo direct runner only when channel M credentials exist in its server-only environment.
5. The runner authenticates, uploads only approved references, submits once, stores the provider task ID, polls on later worker cycles, downloads the completed file, and runs `ffprobe`.
6. A successfully downloaded file remains `awaiting_content_qa`; the administrator must confirm content before the shared output/ledger gate marks it `completed` and exposes delivery.

### Changed files and generated artifact

- `app/page.tsx`, `components/SiteHeader.tsx`, `app/api/health/route.ts`, `app/error.tsx`, `app/not-found.tsx`, and `app/globals.css`: deterministic entry routing, accurate public health semantics, and recovery pages.
- `scripts/mimo-direct.mjs`, `scripts/video-task-worker.mjs`, `lib/video-tasks.ts`, `lib/admin.ts`, `app/admin/page.tsx`, and `docker-compose.yml`: Mimo direct execution, confirmed motion-reference upload, worker configuration, and the admin delivery gate.
- `scripts/mimo-direct.test.mjs`, `scripts/manual-task.integration.mjs`, and `package.json`: local mock provider coverage plus production-base-url test targeting.
- `README.md` and `PROJECT_MANIFEST.json`: durable deployment and channel behavior documentation.
- `E:\codex\aisp\aidaihuo\niannian-ai-video-workbench-deploy-20260712.zip`: deployment package; verified to exclude local environment files, database data, build output, node modules, and old deployment archives.

### Evidence

- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:mimo-direct`: passed with mock login, image/video upload, submit, poll, proxy download, and probe handoff.
- `NIANNIAN_TEST_BASE_URL=http://127.0.0.1:3030 npm run test:manual-task:integration`: passed with motion reference input, cost authorization, media/ledger gates, and the new provider-output review completion path.
- `npm run test:delivery-route:integration`: passed.
- Local production smoke: `/` returned a single `307` to `/login`; `/api/health` returned `200` and `providers: admin-only`; unknown pages returned the branded `404`; desktop/mobile browser checks had no console warnings or errors.

### Remaining blocker

The new package has not yet been uploaded to the Tencent Cloud instance, so this review does not claim a production channel-M submission. The exact remaining step is the user-visible file transfer of the prepared ZIP, followed by an app/worker-only Docker rebuild and a non-quota Mimo readiness preflight. A real provider generation remains intentionally unrun in this release review because it spends account credit and requires a released server configuration.

日期：2026-07-10

## 请求结果

在本地做出一个参考 `https://video.jurilu.com/` 公开视觉与导航结构的“念念AI”网站，部署到可访问端口，并把真实模型与技术实现留成安全、可替换的接入层。

## 正确运行链路

1. 参考站只作为公开视觉和信息架构输入。
2. Next.js 真实组件实现首页、项目、作品、指引、工作台、团队和模型配置页。
3. `lib/provider-contract.ts` 与 `lib/shortdrama-contract.ts` 定义模型与真人短剧转绘任务协议；真实供应商、密钥、队列、存储暂不伪造。
4. `npm run build` 生成生产构建。
5. `npm run start` 在 `3026` 启动生产服务器。
6. `/api/health`、`/api/providers`、`/api/workflow` 与 `/api/team` 提供本地演示状态和安全边界读回。
7. 工作台依次选择阶段与镜头，使用选中镜头的时长与提示词标识构造待提交任务单；只有任务规范、参考资产、配额/费用读回和用户授权均满足时，才可能开放真实提交。
8. Playwright 在桌面与移动视口检查页面、导航、创建项目、工作台、团队邀请草稿与模型配置，并保存证据截图。

## 实际变更

- 应用与配置：`package.json`、`package-lock.json`、`next.config.mjs`、`tsconfig.json`、`next-env.d.ts`。
- 页面：`app/page.tsx`、`app/projects/page.tsx`、`app/showcase/page.tsx`、`app/guide/page.tsx`、`app/team/page.tsx`、`app/settings/page.tsx`、`app/workspace/[id]/page.tsx`。
- API：`app/api/health/route.ts`、`app/api/providers/route.ts`、`app/api/workflow/route.ts`、`app/api/team/route.ts`。
- 组件与样式：`components/*`、`app/globals.css`、`app/icon.svg`。
- 模型与工作流边界：`lib/provider-contract.ts`、`lib/shortdrama-contract.ts`、`lib/demo-data.ts`。
- 持久文档：`README.md`、`DESIGN.md`、`PROJECT_MANIFEST.json`、本复核文件。
- 浏览器证据：`output/playwright/*-final.png`。

## 本次回归修复

- 工作台此前在点击 S02 / S03 后只更新提交单标题，时长和提示词仍保留 S01 的值。
- `app/workspace/[id]/page.tsx` 现为每个演示镜头定义 `promptId`，并从 `activeShot` 派生 `selectedShot`；提交单的时长和提示词均读取该选中镜头。
- Playwright 实测：S02 显示 `16:9 · 3.8s` 与 `shot-s02-prompt-v2`；S03 显示 `16:9 · 2.6s` 与 `shot-s03-prompt-v1`；控制台为 0 错误、0 警告。

## 本次首页视觉调整

- `app/page.tsx` 根路由不再显示登录/注册卡片，改为深色的 AI 视频创作工作台：首页首屏包含创作提示词、可选参考素材、本地时长和比例选择、预览区与最近任务。
- 原有登录、注册、验证码和密码重置交互仍由同一受测组件提供；`/login` 作为入口跳转到显式认证状态，受保护页面的未登录重定向也已更新至该入口。
- 页面参考 `video.jurilu.com` 的公开工作台信息层级和深色界面方向重新实现，未复制对方品牌、图像、文案或其他受保护资产。
- 不使用图片背景，也没有生成、修改或合成任何生产图片；上传和生成仅为本地交互演示。
- 历史任务被选中后会使用该任务自己的比例和时长显示预览；清空任务会取消未完成的演示计时器，避免清空后出现错误完成状态。
- 本次验证以本复核文件更新后的 lint、生产构建、HTTP 与浏览器检查结果为准。

## 复核结论

- 生产构建和 TypeScript 检查通过。
- 生产服务器在 `http://localhost:3026` 可访问，健康接口返回 `status: ok`。
- 首页改版后实测桌面与 `390 × 844` 移动视口：创作输入、预览和任务历史均存在，移动端宽度 `375px`、桌面宽度 `961px` 时页面 `scrollWidth` 均等于 `clientWidth`，没有横向溢出。
- 浏览器实测提示词输入会启用生成按钮；生成任务先进入“生成中”，随后变为“已完成”。生成后立刻清空并等待 2.5 秒，任务列表保持为 0，未再错误变为完成。
- 浏览器实测 `/login?mode=register` 跳转至 `/?mode=register`，注册标签和完整邮箱/密码表单可用；控制台错误为 0。
- “首页 → 项目管理”“新建命名项目”“项目 → 工作台”“工作台阶段/镜头选择”“团队邀请草稿弹窗”真实交互通过。
- `/api/workflow` 返回七个工作流节点和 `submission.submitAllowed: false`；`/api/team` 返回四个演示成员并明确 `auth: not-implemented`。
- 项目卡不再嵌套交互按钮，品牌链接具备可访问名称。
- npm 生产依赖审计为 0 漏洞。

## Stops-too-early 检查

- 没有把设计计划当成网站：生产服务器、页面与截图都真实存在。
- 没有把模型占位当成生成完成：配置页、工作台和健康接口均明确显示未配置。
- 镜头选择不会只更新展示标题：任务单会随选中镜头更新时长和提示词标识；仍不会提交模型任务。
- 团队邀请只生成界面草稿，不会发送邮件或写入成员数据。
- 没有截图热点页面：首页与所有操作均由真实 HTML/CSS/React 组件构成。
- 没有“最新文件”扫描或发送路径；证据文件在 manifest 中使用明确路径记录。

## 尚未验证或尚未实现

- 真实账号、短信、验证码、数据库、对象存储、任务队列和模型供应商调用。
- 真实视频播放与成片导出。
- axe/pa11y 自动无障碍审计、Lighthouse/Core Web Vitals、公开域名与 HTTPS。
- 真实表单目的地、分析埋点、隐私/用户协议正文。

该历史结论已被 2026-07-11 的 Mimo 真实回归取代：费用/额度读回、真实提交、轮询、下载、媒体探测、内容 QA、账本与完成回写均已验证。当前外部阻塞仅为 ArtFlash 的 `login_required`，不影响已经验证的 Mimo 备用路径。

## 2026-07-11 项目持久化与视频工作台复核

### 请求结果
把念念AI本地站从静态演示推进为可登录、可持久化创建项目、可进入真实项目工作台，并提供与参考站一致方向的三栏 AI 视频生成界面。

### 正确运行链路
1. 用户通过邮箱验证码注册或密码登录，服务端在 PostgreSQL 中校验会话。
2. 登录后进入 /home，上传人物、商品、场景和动作参考，填写提示词并检查模型参数；真实生成前必须等待供应商接口、配额读回和用户确认。
3. /projects 通过受保护 API 读取当前用户项目；创建后写入 PostgreSQL 并跳转 /workspace/[id]。
4. 工作台按项目 ID 从 API 读取归属项目，不存在或越权时返回项目列表或登录页。
5. 删除项目必须通过登录会话和同源校验，完成后同步刷新界面。

### 实际变更
- 认证数据库共享查询与 projects 表：lib/auth.ts。
- 项目数据模型：lib/projects.ts。
- 项目 API：app/api/projects/route.ts、app/api/projects/[id]/route.ts。
- 项目管理与工作台绑定：app/projects/page.tsx、app/workspace/[id]/page.tsx。
- 登录访问保护：components/SiteHeader.tsx。
- 参考站方向的视频生成工作台：app/home/page.tsx、app/globals.css。
- 本地 PostgreSQL 稳定启动配置：.env.local（机密值未写入本文档）。

### 验证证据
- npm run lint：通过。
- npm run build：通过。
- 生产服务重启后 /api/health 返回 200，错误日志为 0 字节。
- 登录态项目 API：列表 200、创建 201、读取 200、删除 200；错误 Origin 被 403 拒绝。
- 浏览器全链路：创建项目后跳转工作台并显示真实项目名，返回项目页可见，删除后消失。
- 视频工作台：桌面 3 个主卡片、4 个素材入口；390px 移动端无横向溢出，控制台 0 错误。
- 测试会话和测试项目均已清理；生产代码未发现本地认证、SMTP 或数据库机密值。

### Stops-too-early 检查
- 项目创建不再只改 React 内存，已真实写入 PostgreSQL。
- 工作台不再固定显示演示项目名，已按 URL 项目 ID 读取。
- 生成按钮未伪造成功结果；供应商接口未配置时明确停在提交门禁。

### 未验证与阻塞
- external_resource_failure：尚未获得 Seedance 2.0 或其他视频供应商的 API 地址、密钥、计费/配额接口与回调协议，因此真实视频任务提交、轮询、下载和扣费仍保持禁用。
- 未执行任何会消耗图片或视频额度的生成测试。

## 2026-07-11 管理后台与首页恢复复核

### 请求结果
完成念念AI管理员控制台，并恢复被意外覆盖的 `/home` 生成工作台源码，保证管理员账户可从首页进入后台，普通用户不能读取后台数据。

### 正确运行链路
1. 登录会话由 `/api/auth/session` 返回当前用户和 `isAdmin`。
2. `/home` 读取登录态、视频任务和浏览器草稿；素材先上传到 `/api/assets`，再由 `/api/video-tasks` 创建持久化任务。
3. 三种执行方式分别进入人工代做、Skill 自动和服务器自动队列；真实渠道提交继续受成本读回与用户授权门禁控制。
4. 管理员从首页进入 `/admin`，读取用户、项目、任务、渠道状态和审计事件。
5. `/api/admin/overview` 服务端校验管理员邮箱；非管理员请求返回 403。
6. 生产构建完成后重启 `next start -p 3026`，再执行 HTTP、权限和桌面/移动浏览器检查。

### 根因与修复
- `app/home/page.tsx` 曾在 PowerShell 替换中误用了只读变量 `$HOME`，文件被覆盖为本机用户目录文本，源码只剩 14 字节。
- 运行中的旧构建暂时掩盖了该问题，但下一次构建会直接失败。
- 本次从现有生产编译产物恢复完整 React/TypeScript 源码，并加入管理员可见的“管理后台”入口。
- 素材预览对象 URL 改为只在替换素材或组件卸载时释放，避免新增第二项素材时把仍在使用的第一项预览提前撤销。

### 实际变更
- 恢复并修正：`app/home/page.tsx`。
- 已完成且复核：`lib/admin.ts`、`app/api/admin/overview/route.ts`、`app/admin/page.tsx`、`app/api/auth/session/route.ts`、`components/SiteHeader.tsx`、`app/globals.css`。
- 浏览器证据：`output/playwright/home-restored-desktop.png`、`home-restored-mobile.png`、`admin-restored-desktop.png`、`admin-restored-mobile.png`。
- 持久状态：`PROJECT_MANIFEST.json` 与本复核文件。

### 验证证据
- `npm run lint`：通过。
- `npm run build`：通过，`/home`、`/admin`、`/api/admin/overview` 均进入生产构建。
- 服务重启后 `/api/health` 返回 200；`/`、`/home`、`/admin` 均返回 200。
- 管理员 API 返回 200；临时普通用户会话访问管理员 API 返回 403；临时会话和用户已清理。
- `/home` 桌面 1280px 与移动 390px 均无横向溢出，管理员入口存在，标题和生成工作台可见。
- `/admin` 桌面与移动视口均无横向溢出，管理员控制台、任务中心、用户管理、渠道状态和审计记录可见。
- 浏览器控制台 0 错误、0 警告。
- 前端源码未发现 SMTP、数据库、会话密钥、OTP pepper、用户密码或授权码。

### Stops-too-early 检查
- 没有把仍在运行的旧构建当作源码正常；已恢复源文件、重新构建并重启。
- 没有只验证静态路由 200；已使用真实测试会话检查管理员入口、后台数据加载和 403 权限隔离。
- 没有把任务入队当作真实视频生成；供应商提交继续保持成本与授权门禁。
- 没有消耗任何图片或视频生成额度。

### 尚未验证
- Mimo 的真实提交、轮询、成片下载和完成回写已经验证；ArtFlash 仍需有效登录态、额度读回和一次独立提交后才能标记为已验证渠道。
- 未进行 Lighthouse、axe/pa11y 和公开域名 HTTPS 验收。

## 2026-07-11 视频执行器与完成门禁复核

### 请求结果
把念念AI从“任务只入库”推进为可持续领取已授权任务、调用 Skill 或独立服务器、同步渠道状态、下载验收成片并回写管理员后台的真实执行底座，同时保证人工与自动路径都不能伪造完成。

### 正确运行链路
1. 用户上传人物/商品/场景/动作素材并创建任务，系统写入 PostgreSQL、锁定提示词文件和 `video_task_spec.json`。
2. 管理员读取成本或额度并明确授权后，任务才同时打开 `submit_allowed` 与 `cost_gate.authorized`。
3. 后台执行器使用数据库行锁领取任务；`codex_skill` 调用本机已登录 Codex 与指定渠道 Skill，`server_auto` 调用受控服务端地址。
4. 已有渠道任务 ID 时只做同步，不重复提交；中断的领取状态会被恢复。
5. 只有任务专属 `downloads` 成片、真实 `ffprobe`、时长容差、内容 QA 和任务专属 `ledger` 账本全部通过，任务才可进入 `completed`。
6. 管理员人工代做只能完成 `manual_in_progress` 任务，并经过同一输出验证门禁；自动任务不能由后台任意填写路径绕过执行器。

### 实际变更
- 执行器与协议：`scripts/video-task-worker.mjs`、`scripts/video-task-result.schema.json`。
- 自动化验证：`scripts/video-task-worker.test.mjs`、`scripts/video-task-worker.integration.mjs`。
- 共享完成门禁：`lib/video-output-gate.mjs`、`types/video-output-gate.d.ts`。
- 任务规范与管理员链路：`lib/video-tasks.ts`、`lib/admin.ts`、`app/admin/page.tsx`。
- 运行与部署：`package.json`、`Dockerfile`、`docker-compose.yml`、`.env.example`、`.env.docker.example`、`README.md`。
- 浏览器证据：`output/playwright/admin-worker-online.png`、`output/playwright/admin-worker-online-mobile.png`。

### 验证证据
- `node --check lib/video-output-gate.mjs`：通过。
- `node --check scripts/video-task-worker.mjs`：通过。
- `npm run lint`：通过。
- `npm run test:video-worker`：7/7 通过，包含授权门禁、渠道锁定、Codex 交接和输出目录逃逸检查。
- `npm run test:video-worker:integration`：输出 `VIDEO_WORKER_INTEGRATION_PASS`；任务先保持未授权状态，再通过真实管理员 API 写入成本读回并同时打开数据库与任务规范门禁，随后由本地模拟服务完成提交、同步、下载、媒体探测、时长校验、内容 QA、账本和数据库完成状态回写；测试用户、管理员测试会话、任务和文件均由脚本验证清理。
- `npm run test:manual-task:integration`：输出 `MANUAL_TASK_INTEGRATION_PASS`；真实调用本地认证、素材上传、任务、管理员接单与完成 API，验证非法输出目录和缺少内容 QA 均被拒绝，合法 5 秒测试视频通过 `ffprobe`、时长和账本门禁后完成，并清理全部临时状态。
- `docker compose --env-file .env.docker.local config --quiet`：通过；最终镜像清单已显式复制执行器依赖的 `lib/video-output-gate.mjs`。
- 临时集成任务、用户和输出文件已清理；持续执行器已重启并保持新鲜心跳。
- `/api/health` 返回 200；桌面与 390×844 移动视口的管理员“渠道状态”可见执行器在线、Skill 可用、服务器配置状态，无横向溢出，控制台无错误或警告。

### Stops-too-early 检查
- 不再把“任务入队”当作生成完成；完成状态需要成片、媒体探测、时长、内容 QA 和账本。
- 不再允许管理员给自动任务填写任意路径后直接标记完成。
- 人工代做也不能只凭文字确认完成；路径必须属于当前任务目录，服务端会读取文件并执行 `ffprobe`。
- 已有渠道任务 ID 的任务进入同步路径，避免执行器重启后重复扣费提交。
- 集成验证使用本地模拟服务与临时黑色视频，不消耗任何真实图片或视频渠道额度。

### 尚未验证与阻塞
- ArtFlash 当前属于 `external_resource_failure / login_required`：客户侧不展示具体渠道，默认优先 ArtFlash、Mimo 备选；真实 ArtFlash 提交仍需要该账户完成登录后单独验证。
- `server_auto` 的通用 HTTP 合约已实现并通过本地模拟端到端验证，但正式执行服务器 URL/令牌仍需部署方提供。
- Docker Compose 配置已验证；本次实际镜像构建因 Docker Hub 授权地址网络连接失败，未能下载/确认 `node:24-alpine` 基础镜像，因此没有把“静态 Dockerfile 正确”误报为“镜像已成功构建”。
- 未进行公开域名、HTTPS、对象存储、Lighthouse 与 axe/pa11y 验收。

## 2026-07-11 Mimo 真实渠道回归

### 请求结果
验证一单念念AI任务不止能在本地模拟完成，而且能从本地素材与任务规范进入真实渠道、取得真实 provider task、下载真实 MP4、通过媒体与画面质检后回写 `completed`。

### 正确运行链路
用户授权成本使用 -> ArtFlash 登录态预检 -> ArtFlash 不可用时按任务允许顺序回退 Mimo -> 本地任务创建/接单/成本读回 -> 锁定提示词与确认参考图 -> 真实上传/提交/轮询 -> 下载 -> `ffprobe` -> 证据帧 QA -> 任务专属 ledger -> 管理员完成门禁回写。

### 实际变更
- `lib/video-tasks.ts`：给每个参考素材写入 `ref_key`、职责和 `actual_video_input`；动作视频保留在任务证据中，但不再被 ArtFlash/Mimo 图生视频路径误当成外部图片引用。
- `scripts/video-task-worker.mjs`、`scripts/video-task-worker.test.mjs`：只对实际视频输入执行上传资格门禁，并覆盖动作支撑素材不会成为 provider 输入。
- `lib/admin.ts`、`app/admin/page.tsx`、`scripts/manual-task.integration.mjs`：人工任务接单后可读取成本、登记 provider task ID，同时仍保持可验收的人工状态。
- `scripts/run-real-mimo-app-task.mjs`：新增受 `--authorized` 保护的 Mimo 真实回归执行器；凭据只从环境变量读取。

### 验证证据
- `node --check scripts/run-real-mimo-app-task.mjs`、`npm run lint`、`npm run test:video-worker`（8/8）、`npm run test:manual-task:integration`、`npm run build`：全部通过。
- 真实 Mimo：额度读回 510；真实 provider task `712394135042` 完成，输出为 5.06195 秒、1280x720、16:9 MP4。
- 任务 `15r93hxjvXgsN6LsM0bI9TPU` 已通过任务专属 `downloads`、`ffprobe`、两张仅供质检的证据帧、内容 QA 与 task-local ledger，管理员 API 回写 `completed`。
- ArtFlash 预检跳转到登录页，未伪称为已提交或已验证。

### 剩余风险
- 本次只验证 Mimo 备用通道；ArtFlash 仍需有效登录态、余额 readback 和一次独立真实提交/下载/QA 才能标记可用。
- 仍未完成公开域名、HTTPS、支付、对象存储、Lighthouse 与自动化无障碍验收。

## 2026-07-12 Mac Codex 商业生产控制面复核

### 请求结果
把念念 AI 的客户自动任务从不具备完整生产权限的 Windows/Docker 执行器迁移到 Mac 上的 Codex 独立员工，同时保留商业网站的客户隔离、积分、成本授权、真实产物校验、管理员内容验收和客户下载闭环。

### 正确运行链路
1. 客户登录、上传素材并创建自动任务；服务端固定写入 `execution_mode=mac_codex`、`queued_mac`、任务规范和积分预留。
2. 管理员完成渠道成本/额度读回并授权后，任务才进入 `approved_for_execution`；Windows/Docker 辅助执行器的模式集合不包含 `mac_codex`。
3. 只有持有专用 bearer token 的 Mac worker 可以领取任务；领取后才能按当前任务下载素材，且 Mac 逐文件复算 SHA-256。
4. `run-once` 为任务启动一个新的 Mac Codex CLI 员工。父级工作器在 Codex 执行期间持续发送心跳，渠道仍运行时保存 provider task ID 并进入仅同步/下载/QA 的后续周期，不能重复提交。
5. Mac 上传真实媒体与 JSON ledger 后，网站服务器重新执行 `ffprobe` 和时长容差检查，只将任务推进到 `awaiting_content_qa`，不直接交付。
6. 管理员检查人物、商品、场景和动作后执行内容 QA；服务端再次验证任务专属输出和账本，随后才进入 `completed`，客户才可预览或下载。

### 实际变更
- 路由与状态：`lib/video-tasks.ts`、`app/api/video-tasks/route.ts`、`lib/admin.ts`、`app/api/admin/overview/route.ts`、`app/admin/page.tsx`。
- Mac 控制面：`lib/mac-codex-worker.ts` 与 `app/api/internal/mac-codex/**` 五个受保护接口。
- Mac 正式员工：`mac-agent/niannian-mac-worker.mjs`、`mac-agent/worker-result.schema.json`、`mac-agent/install-macos.sh`、`mac-agent/README.md`。
- 自动化验证：`scripts/mac-codex-worker.test.mjs`、`scripts/mac-worker-api.integration.mjs`。
- 执行器隔离与部署：`scripts/video-task-worker.mjs`、`docker-compose.yml`、`.env.example`、`.env.docker.example`、`package.json`、`README.md`、`PROJECT_MANIFEST.json`。

### 验证证据
- `node --check`：Mac worker、单元测试、API 集成脚本均通过；`worker-result.schema.json` 与 `PROJECT_MANIFEST.json` 可解析。
- `bash -n mac-agent/install-macos.sh`：通过；安装器把 agent token 写入 macOS Keychain，不写入 plist、日志或任务包。
- `npm run lint`：TypeScript 通过。
- `npm run test:mac-worker`：2/2 通过；覆盖任务领取、素材 SHA 校验、结果 multipart 回传，以及 fresh Codex employee 从 `running` 保存 provider ID 后进入下一同步周期并最终上传产物。
- `npm run test:video-worker`：9/9 通过；旧执行器授权、渠道锁定、任务规范和目录逃逸门禁无回归。
- `npm run test:mimo-direct`：1/1 通过；Mimo 下载结果仍停在内容 QA 门。
- `npm run test:mac-worker:integration`：输出 `MAC_WORKER_API_INTEGRATION_PASS`；走通客户登录态建单、积分预留、管理员成本授权、Mac 领取、两份素材 SHA 下载、provider-running 回执、真实 5 秒 MP4 上传、服务器 ffprobe/时长门、管理员内容 QA、客户 completed 状态和 Range 下载，并清理全部临时用户、任务、文件与 worker state。
- `npm run build`：Next.js 生产构建通过，34 条路由中包含 5 条 Mac 控制面接口。
- `docker compose --env-file .env.docker.example config --quiet` 与 `npm audit --omit=dev`：通过，生产依赖 0 个已知漏洞。
- 生产站 `https://sd2.cauai.fun/api/health` 返回 200；未授权访问 `/api/internal/mac-codex/status` 返回 401；服务器内部使用部署 secret 访问返回 `configured=true`。
- 腾讯云 `/opt/niannian-ai-video-workbench` 中的 Mac agent v1.1.0 包、安装器与 schema 已按本地 SHA-256 更新；更新前文件已归档到 `backups/mac-agent-pre-run-once-20260712-172012.tar.gz`。

### Stops-too-early 检查
- 不把 `task.json`、`INSTRUCTIONS.md` 或任务领取视为生产完成；`run-once` 会真实启动独立 Codex 员工并上传其回执。
- 不在 provider 仍运行时结束链路；父级工作器保存 provider ID、心跳续租并进入同步周期。
- 不让 Mac 的 `completed` 直接成为客户 completed；服务端媒体复检和管理员内容 QA 仍是独立门禁。
- 不让 Windows/Docker 回退领取 Mac 专属任务；容器辅助 worker 默认仅启用 `server_auto`。
- 不在客户页面把内部 `awaiting_content_qa` 显示为“任务受阻”，而继续显示处理中。
- 集成验证使用本地合成黑色视频，不调用真实供应商、不消耗渠道额度，也不把测试视频提升为生产产物。

### 尚未验证与真实阻塞
- Mac 当前处于 Tailscale offline；生产控制面记录的最后心跳来自旧 worker v1.0.0。v1.1.0 已发布到服务器，但尚未能在离线 Mac 上执行升级安装和新版本心跳验证。
- 本次没有发起新的真实客户供应商任务，因此没有把 API/模拟集成误报为新的真实 Mimo 生产交付；历史真实 Mimo 回归仍是渠道可用性的现有证据。
- 对象存储、真实支付网关、Lighthouse 和自动化无障碍检查仍未完成。

## 2026-07-12 积分制内测 MVP 发布复核

### 请求结果
用户创建视频时默认进入自动制作；人工制作只能由用户主动选择且价格更高；创建任务必须预扣积分，余额不足时提交充值申请，由管理员核实付款后确认入账。

### 正确运行链路
1. 登录用户进入 `/home`，页面默认选中自动制作并从 `/api/credits` 读取余额与服务端报价。
2. 用户上传素材并提交任务；服务端忽略客户提供的内部渠道/执行器，只按 `serviceMode` 路由自动或人工，并在事务中原子预扣积分。
3. 自动任务进入 `mac_codex` 队列，人工任务进入 `manual_assist`；管理员不能把自动任务暗中改成人工任务。
4. 任务建单失败、管理员停止或执行器终止时只允许一条 `video_task_refund` 流水；先抢占唯一退款流水再更新钱包，保证并发重试不会重复退款。等待内容 QA 的真实成片不退款。
5. 余额不足时用户提交充值申请；管理员只对 `pending` 申请确认一次，事务同时更新申请、钱包和充值流水。该流程不冒充微信/支付宝自动支付。
6. 完成任务仍需媒体探测、时长、账本和管理员内容 QA，客户下载门禁不受积分功能影响。

### 实际变更
- 钱包与退款：`lib/credits.ts`、`lib/video-tasks.ts`、`lib/admin.ts`、`lib/mac-codex-worker.ts`、`scripts/video-task-worker.mjs`。
- 回归验证：`scripts/manual-task.integration.mjs` 增加默认自动路由、扣费、管理员重复停止和单次退款断言。
- 发布资料与秘密边界：`.dockerignore` 排除全部部署环境文件；`README.md`、`PROJECT_MANIFEST.json` 更新积分、充值、腾讯云部署和剩余边界。

### 验证证据
- `npm run lint`、`npm run build`：通过；生产构建包含 `/api/credits` 与五条 Mac 控制面路由。
- `node --check scripts/video-task-worker.mjs`、`node --check scripts/manual-task.integration.mjs`：通过。
- `npm run test:video-worker`：9/9 通过；`npm run test:mac-worker`：2/2 通过。
- `NIANNIAN_TEST_BASE_URL=http://127.0.0.1:3040 npm run test:manual-task:integration`：输出 `MANUAL_TASK_INTEGRATION_PASS`，覆盖人工 80 积分、充值 100 积分、默认自动 20 积分和重复停止仅退款一次，并完成临时状态清理。
- 本地生产 UI：自动制作按钮为 `active`，人工制作未选中；余额按钮可打开“充值积分”弹窗；`390x844` 下根节点无横向溢出且弹窗完全在视口内。
- 腾讯云只重建 `niannian-ai-video-workbench-app-1` 与 `niannian-ai-video-workbench-video-worker-1`；数据库和 `ans-app`、`sub2api-gg` 未重建。
- 生产 `https://sd2.cauai.fun`：健康、登录、首页、已登录积分 API、管理员 API 均返回 200；未登录积分 API 返回 401；自动 5 秒报价 20、人工 5 秒报价 80；三张积分表存在；历史已完成 MP4 Range 下载返回 206 `video/mp4`。
- 生产 Mac 控制面 `configured=true`；当前节点 `online=false`、版本 `1.0.0`，未伪报为可立即自动跑新单。

### Stops-too-early 检查
- 不把充值申请当成付款成功；只有管理员确认才增加余额。
- 不把扣积分和建任务拆成无补偿路径；文件或数据库建单失败会清理任务文件并退款。
- 不把任务进入队列当成交付；成片下载与管理员内容 QA 门仍保留。
- 不因失败重试重复退款；退款流水先通过任务/原因唯一键抢占，再更新钱包。
- 不把本地、API 或历史成片验证冒充新的真实渠道订单；本次发布没有新建真实视频任务，也没有消耗渠道额度。

### 尚未验证与真实阻塞
- Mac 正式员工当前离线；自动任务虽会正确入队和扣积分，但新任务要等 Mac worker 上线并升级到 v1.1.0 后才能完成新的生产闭环。
- 微信/支付宝等真实支付网关、支付回调验签、自动退款、对象存储、Lighthouse、axe 和分析埋点尚未实现。

## 2026-07-12 LDXP 收款、统一定价与人工兜底复核

### 请求结果
用户只看到一种统一定价的视频服务；系统默认自动走渠道 M，自动失败后把同一任务转人工兜底且不加价；积分按 `1 积分 = ¥0.10` 通过 LDXP 购买并以一次性兑换码到账。

### 正确运行链路
1. 客户页面不再提供自动/人工选项，服务端也忽略伪造的 `serviceMode=manual`，所有新客户任务统一按自动价扣分并进入 `mac_codex`。
2. Mac/渠道返回 blocked 时，服务端保留原积分预留，把同一任务切换到 `manual_assist / awaiting_manual_operator`，记录零加价 fallback 事件；管理员可接单完成。只有管理员最终停止任务才退款。
3. LDXP 商品固定为 `100 / 300 / 500 / 1000` 积分，对应 `¥10 / ¥30 / ¥50 / ¥100`。付款后 LDXP 发放由独立服务端密钥 HMAC 签名的兑换码。
4. 用户登录后提交兑换码；服务端校验格式和签名，以兑换码 SHA-256 为唯一键抢占，事务内更新钱包和 `ldxp_redeem` 流水。重复提交同一码返回已使用，绝不重复到账。
5. 兑换码批量生成器只写权限为 0600 的指定文件，不向控制台打印兑换码。生产现已配置“念念AI积分”分类公开地址，购买弹窗直接进入四档商品页。

### 实际变更
- 数据与计费：`lib/auth.ts`、`lib/credits.ts`、`app/api/credits/route.ts`、`app/api/video-tasks/route.ts`。
- 自动转人工：`lib/mac-codex-worker.ts`、`lib/admin.ts`、`app/admin/page.tsx`。
- 用户界面：`app/home/page.tsx`、`app/globals.css`。
- LDXP 卡密生产：`scripts/generate-ldxp-credit-codes.mjs`、`package.json`。
- 部署与说明：`docker-compose.yml`、`.env.example`、`.env.docker.example`、`README.md`、`PROJECT_MANIFEST.json`。
- 回归验证：`scripts/manual-task.integration.mjs`。

### 验证证据
- `npm run lint` 与 `npm run build`：通过；34 条生产路由构建成功。
- `node --check`：LDXP 卡密生成器、人工任务集成脚本、服务器视频执行器均通过。
- `npm run test:video-worker`：9/9 通过；`npm run test:mac-worker`：2/2 通过。
- `NIANNIAN_TEST_BASE_URL=http://127.0.0.1:3040 npm run test:manual-task:integration`：输出 `MANUAL_TASK_INTEGRATION_PASS`；覆盖伪造人工档位仍按自动 20 积分扣款、管理员零加价转人工、LDXP 100 积分兑换、重复兑换拒绝、重复退款拒绝及完整临时状态清理。
- 卡密生成器以 100 积分、3 枚临时码执行；输出数量和格式全部通过，临时文件随后删除。
- 桌面 DOM：制作方式选择已消失，显示“自动制作 · 人工兜底”；购买弹窗显示固定换算和四个价格包。
- `390x844`：根节点无横向溢出，购买弹窗完整位于视口内。
- 腾讯云只重建念念 app；数据库、视频辅助 worker、`ans-app` 和 `sub2api-gg` 未重建。
- 生产健康与登录页返回 200；登录后的积分弹窗返回四个价格包、自动/人工内部价格同为 20，并展示 LDXP 分类购买链接。
- 生产 `credit_redemptions` 表已创建；无效兑换码返回 400，未产生积分。
- LDXP 已创建“念念AI积分”分类，发布 100/300/500/1000 四档商品，对应 ¥10/¥30/¥50/¥100；每档库存均核对为 50 张，公开分类页显示四档商品且库存充足。
- 生产 `LDXP_SHOP_URL` 已指向 `https://pay.ldxp.cn/shop/B59CCLX7/4ltakt`；只重建念念 app，生产健康检查为 200，视频 worker、`ans-app` 与 `sub2api-gg` 持续运行。

### Stops-too-early 检查
- 没有把“商品和库存已上线”冒充成“真实支付闭环已通过”；购买入口已开放，但真实付款、自动发码和到账仍待验收。
- 没有把自动失败当成交付或直接退款；失败任务进入人工队列，仍必须经过成片、媒体探测、账本和内容 QA 门。
- 没有因用户提交 `manual` 字段收取不同价格；公网 API 固定自动服务模式。
- 没有把卡密明文存进数据库、日志、镜像或清单；数据库只保存已兑换码哈希。
- 没有用模拟兑换证明真实收款；真实 LDXP 付款和自动发码必须在商品配置后单独验收。

### 尚未验证与真实阻塞
- `external_resource_failure`：尚未取得用户对一笔真实 ¥10 支付的即时确认，因此没有点击最终支付按钮。
- 尚未完成一笔真实 LDXP 支付、平台自动发码、用户兑换到账以及同码重复兑换拒绝的端到端验收；在此之前不能宣称真实收款已完整跑通。
- 对象存储、Lighthouse、axe 和分析埋点仍未完成。

## 2026-07-12 商业 MVP 管理员运营待办与 SLA 复核

### 请求结果
把现有管理员任务按钮升级为可日常运营的待办中心：管理员打开后台即可看到需要处理的任务、超时原因和明确下一步；客户页面同时给出自动制作、人工兜底与退款预期。

### 正确运行链路
1. `/api/admin/overview` 从生产任务、用户与兑换记录读取真实状态，按最后更新时间计算阶段年龄。
2. 自动任务 30 分钟进入关注、60 分钟进入紧急；等待人工接单和普通阻塞立即进入紧急；人工处理中以 24 小时为 SLA；待质检成片给出“验收并交付”动作。
3. 管理员后台默认展示需要处理的任务，并提供紧急、超时、人工兜底、待质检和全部任务筛选；每 30 秒刷新一次。
4. 管理员仍通过原有接单、转人工、成本授权、登记渠道、质检、完成和退款门禁处理任务；运营判级不直接修改任务状态、积分或成片。
5. 客户页面明确通常 10–30 分钟自动完成、人工兜底预计 24 小时、失败不重复扣分，确实无法完成时退回本次积分。

### 实际变更
- 后台聚合与 SLA：`lib/admin.ts`。
- 管理员待办与筛选：`app/admin/page.tsx`。
- 客户服务预期：`app/home/page.tsx`。
- 响应式运营组件：`app/globals.css`。
- 项目记录：`README.md`、`PROJECT_MANIFEST.json`、`POST_CODING_REVIEW.md`。

### 验证证据
- `npm run lint`：TypeScript 类型检查通过。
- `npm run build`：34 条路由生产构建通过，`/admin` 与 `/home` 均成功生成。
- `npm run test:mac-worker`：3/3；`npm run test:video-worker`：9/9。
- 使用独立本地端口与临时 LDXP 测试密钥执行 `npm run test:manual-task:integration`，输出 `MANUAL_TASK_INTEGRATION_PASS`；测试状态已按脚本清理。
- 腾讯云 Docker 镜像内再次完成生产构建；只重建念念 app。生产 `/api/health` 返回 200，app 容器 healthy；视频 worker、`ans-app`、`sub2api-gg` 未重启。
- 已登录生产管理员页面真实读回：用户 1、任务 1、已完成 1；运营待办显示紧急/超时/人工兜底/待质检均为 0，切换“全部任务”后显示该任务“已交付，无需处理”。

### Stops-too-early 检查
- 没有把时间判级当成自动状态变更；超时任务只进入管理员待办，不会被系统擅自退款、完成或转渠道。
- 没有绕过现有成片路径、媒体探测、账本和内容 QA 门禁。
- 没有创建真实视频任务、消耗 Mimo 额度或制造测试订单。
- 没有因为管理员待办上线就声称真实 LDXP 支付闭环已测试；该测试已由用户明确选择跳过。

### 尚未验证
- 浏览器已验证生产桌面 DOM 与筛选交互；本轮没有在真实 390px 浏览器视口进行截图复核，移动端规则仅经过 CSS 代码检查和生产构建。
- 邮件/微信主动推送未在本轮接入；当前提醒载体是管理员首页运营待办与 30 秒自动刷新。
- 真实陌生用户的首次注册、购买、任务提交与复购转化仍需小规模用户测试。

## 2026-07-12 公开成交首页复核

### 请求结果
让第一次访问 `sd2.cauai.fun` 的用户在注册前理解念念AI的视频生成基础能力、价格和任务流程，并获得唯一明确的下一步，而不是直接被送进登录页。

### 正确运行链路
1. 根路由读取会话但不重定向：匿名用户看到“制作第一条视频”并进入注册；已登录用户看到“进入我的工作台”。
2. 首屏在五秒内说明“上传素材 → 创建任务 → 取得视频结果”，不展示供应商、渠道路由、人工兜底或成本策略。
3. 页面依次回答适用场景、三步流程、真实计费、状态跟踪和常见疑问；所有价格与后端 `20/40/60` 积分保持一致。
4. 私有工作台、项目、管理员和任务 API 保持原有会话保护，公开首页不暴露任务数据或供应商渠道。
5. 未取得公开授权的用户成片不得被放到首页；本轮使用产品界面示意而不是虚构案例、评价或统计数据。

### 实际变更
- 公开首页：`app/page.tsx`。
- 标题、描述与搜索索引：`app/layout.tsx`。
- 桌面和移动端公开首页样式：`app/globals.css`。
- 项目记录：`README.md`、`PROJECT_MANIFEST.json`、`POST_CODING_REVIEW.md`。

### 验证证据
- `npm run build`：34 条路由通过，根路由从 199B 重定向页变为 1.32kB 动态成交页。
- `npm run lint`：TypeScript 类型检查通过。首次并行验证因构建清理 `.next/types` 与 lint 同时读取而出现 TS6053；改为顺序执行后完整通过，属于验证编排竞争，不是源代码错误。
- 腾讯云 Docker 镜像内再次成功生产构建，只重建念念 app。
- 已登录生产浏览器在 `/` 保持原路由，不跳转；首屏标题、进入工作台 CTA、三步流程、三档价格、任务状态和 FAQ 均存在。
- 首屏截图确认标题、CTA、信任信息和制作流程示意在当前桌面视口内具有清晰层级；FAQ“通常多久”可展开并显示 10–30 分钟说明。
- 生产健康检查为 200；视频 worker、`ans-app` 与 `sub2api-gg` 未重启。

### Stops-too-early 检查
- 没有把页面构建成功当成成交页成功；已进行生产 DOM、首屏视觉、CTA 与 FAQ 交互验证。
- 没有虚构客户数量、评价、转化率或真实案例。
- 用户页面不再出现人工兜底、渠道失败、内部成本或执行策略；这些信息仅保留在管理员后台。
- 没有修改扣费、任务状态机、供应商执行或管理员门禁。

### 尚未验证
- 还没有可公开授权的真实案例、客户评价或前后对比，因此本轮没有上线案例视频区。
- 真实陌生用户从公开首页注册、购买、提交、下载到复购的转化仍需小规模用户测试。
- 没有接入访问、注册、兑换、任务创建与下载的转化分析事件；这是下一项可量化优化的基础。

## 2026-07-12 Mac Worker v1.3.0 生产就绪门复核

### 请求结果
在现有念念 AI 视频工作台子页面的技术边界内，优化 Mac Codex 正式员工的生产就绪检查；保证电脑、Codex、Skill、媒体工具或 Mac 上的 Mimo 任一不可用时，视频工作台不能把客户订单交给该员工。本次不定义念念 AI 主网页定位、主子页面关系或产品路线。

### 正确运行链路
1. 客户在念念 AI 视频工作台提交结构化需求与素材；现有子页面继续负责身份、计费、任务状态、管理员授权和交付。
2. Mac Worker 在每次领取前只读检查 Codex 登录、Codex CLI、六项版本化 Skill bundle 及文件哈希、可写工作目录、ARM64 `ffprobe`、Mimo 凭据、登录、认证列表接口和额度读回。
3. Worker 把完整 readiness 随 heartbeat 上报；服务端清洗结构并保存。claim API 再检查 workerId、一致的 `readyToClaim=true` 和默认 180 秒新鲜度，缺失、矛盾或过期均返回 `409 MAC_WORKER_NOT_READY`。
4. 通过后，fresh Codex 员工从 `niannian-mac-production` 进入 `ai-video-production-router`、`ai-video-channel-router` 和当前允许的 `mimo-8001-video-channel`，按锁定任务规范生产；不得绕过 Skill 路由静默改渠道。
5. 真实结果必须下载到当前任务目录、通过素材/成片路径与哈希约束、`ffprobe`、账本和管理员内容 QA，才能对客户显示完成和开放下载。

### 实际变更
- Worker 与 Mac 安装：`mac-agent/niannian-mac-worker.mjs`、`mac-agent/install-macos.sh`、`mac-agent/configure-mimo-macos.command`。
- 版本化生产路由：`mac-agent/skill-bundle/`，bundle v1.1.0、最低 Worker v1.3.0、6 个 Skills、30 个哈希锁定文件。
- 服务端状态与领取硬门：`lib/mac-codex-worker.ts`、`app/api/internal/mac-codex/claim/route.ts`。
- 管理后台分层可见性：`lib/admin.ts`、`app/admin/page.tsx`、`app/globals.css`。
- 测试：`scripts/mac-codex-worker.test.mjs`、`scripts/mac-skill-bundle.test.mjs`、`scripts/mac-worker-api.integration.mjs`。
- 环境与持久文档：`.env.example`、`.env.docker.example`、`docker-compose.yml`、`README.md`、`PROJECT_MANIFEST.json`、`package.json`。
- 浏览器证据：`output/playwright/admin-mac-readiness-desktop.png`、`output/playwright/admin-mac-readiness-mobile.png`。

### 验证证据
- `node --check`：Worker、bundle builder/installer 和三个 Mac 测试脚本均通过。
- `npm run lint`：TypeScript 类型检查通过。
- `npm run test:mac-worker`：4/4；缺 Skill、缺 `ffprobe` 或缺 Mimo 凭据时 claim 次数为 0，完整配置时保留素材校验、结果回传和 fresh Codex 路径。
- `npm run test:mac-skill-bundle`：2/2；完整包可安装，单文件篡改在改变现有 Skills 前被拒绝。
- `npm run test:mac-worker:integration`：输出 `MAC_WORKER_API_INTEGRATION_PASS`；未写 readiness 时 claim 返回 409，写入新鲜完整 heartbeat 后才可领取，并继续覆盖两份素材 SHA、真实测试 MP4、服务器 `ffprobe`、账本、管理员 QA 和客户 Range 下载；测试结束清理临时用户、会话、任务与文件。
- Mac 实机已把 Mimo 用户名/密码写入登录 Keychain，未输出明文；安装的 ARM64 `ffprobe n4.4.1` 可执行；Worker v1.3.0 通过只读登录、列表和额度预检。
- Playwright 本地生产构建：桌面 `1280x900` 与手机 `390x844` 均显示“生产就绪，可以接客户订单”、电脑环境、6/6 生产技能、bundle 1.1.0、Mac 上的 Mimo 登录和额度；根页面宽度等于视口宽度，0 控制台错误、0 警告。临时管理员与 readiness 状态验收后已恢复。
- 部署前备份为 `/opt/niannian-ai-video-workbench/backups/pre-mac-readiness-v1.3-20260712-194829.tar.gz`；上传包 SHA-256 为 `b68e6ec340bf8d62ac976f9ca815b3bb05b1d595f445e64c19c70c407598412b`。
- 腾讯云 Docker 生产构建完成 34 条路由；替换阶段曾返回同名容器冲突，但没有据此报告成功，继续读回后确认新 app 容器 `ebaac97e2bcf` 实际已运行且 `healthy`。数据库与 video-worker 创建时间未变化。
- 生产 app 环境读回 `MAC_CODEX_READINESS_TTL_SECONDS=180`；公网 `/api/health` 和 `/` 均返回 200。
- 生产内部状态收到真实 Mac 新 heartbeat：`version=1.3.0`、`status=idle`、`readyToClaim=true`、`blocker=null`、工作目录可写、`ffprobe` 可用、6 Skills、bundle 1.1.0、Mimo reachable/authenticated、Seedance 2.0、额度只读读回 495。
- 为尝试生产管理员浏览器验收创建的一条临时生产 session 未能由 Playwright CLI 注入浏览器，随后已从数据库删除；没有遗留临时生产会话。

### Stops-too-early 检查
- 不把 Mac 在线当成可生产；最终接单状态同时要求 Codex、Skill、工作目录、`ffprobe` 和 Mimo 全部通过且 heartbeat 新鲜。
- 不把本地 `readyToClaim` 当成服务器授权；claim API 独立强制检查，不能只相信 Worker 自己。
- 不把 Skill 目录存在当成质量路由可用；bundle 对 30 个文件逐一复算哈希并锁定 Mimo 渠道映射。
- 不把 Mimo 登录或额度读回当成真实成片；本轮没有上传客户素材、没有调用 generate、没有消耗额度。
- 不把 Docker build 成功或容器替换命令的冲突输出当成部署完成；直到新容器 healthy、公网 200、环境 TTL 和真实 Mac readiness 都读回才确认发布。
- 不把模型返回文件当成交付；媒体探测、账本和管理员内容 QA 门继续保留。

### 尚未验证
- 生产管理员页面的新三层 readiness 卡片未在生产登录态浏览器中重新截图；已验证相同生产构建的本地桌面/移动页面，以及生产 API 的真实 readiness 数据。失败的临时会话注入已清理，未伪报浏览器通过。
- 尚未得到用户对消耗 Mimo 额度的明确授权，因此未执行新的真实商业订单：`客户下单 -> Worker v1.3 claim -> fresh Codex -> Skill 路由 -> Mimo generate -> 下载 -> 网站回传 -> 管理员 QA -> 客户下载`。
- “顶级质量”不能由 readiness 证明。readiness 证明员工和工具可工作；真实质量仍要由每类业务对应的 Skill 任务规范、参考素材约束、生成结果和人工 QA 共同验收。

### 产品边界纠正
- 用户明确说明：本网站是整个念念AI的视频生成底层能力页面，人工兜底只是内部商业策略。
- 已从公开首页、SEO 标题与描述、登录后工作台成功提示、任务计费卡片和任务说明中移除所有人工兜底与渠道失败文案。
- 管理员后台继续保留人工兜底、渠道诊断和成本授权能力，任务状态机与零重复扣分逻辑不变。
- 持久约束：今后的用户页面只展示输入、参数、任务状态、价格和结果；不得暴露 provider、渠道选择、Mac 执行、人工兜底或内部成本。

## 2026-07-12 Mac Worker v1.1.0 实机安装复核

### 请求结果
在已开机解锁的 `lsbmacbook-air` 上安装念念 AI Mac Codex 正式员工，建立每分钟自动心跳/领单的 LaunchAgent，并以生产 API 的新版心跳证明安装成功，同时不创建真实订单或消耗供应商额度。

### 正确运行链路
1. Windows 经 Tailscale 和独立运维 SSH 密钥连接 Mac，不修改原有受限中继密钥。
2. 已验收 worker、schema 和安装器上传到用户私有 staging 目录并复算 SHA-256。
3. 生产 token 从腾讯云环境读取后只进入进程内存，通过权限 `600` 的 FIFO 交给 Mac 图形登录会话；不得出现在命令行参数、plist、日志或任务文件。
4. 图形会话安装器把 token 写入明确的登录钥匙串，并只授权 `/usr/bin/security`；生成 wrapper 时使用真实账户名和钥匙串路径。
5. LaunchAgent 每 60 秒执行一次 `run-once`。无合格任务时应正常退出 `0` 并写入 `{"ok":true,"task":null}`，生产状态应更新为 `version=1.1.0`、`idle`、`activeTaskId=null`。
6. 只有未来出现已完成管理员成本授权的客户任务时才进入真实 Codex/供应商链路；本次安装验收不制造订单。

### 实际变更
- `mac-agent/install-macos.sh`：明确使用登录钥匙串，重建 token 条目的 `/usr/bin/security` ACL，并修复生成 wrapper 时多余反斜杠导致查找带引号账户/服务的问题。
- `mac-agent/install-macos-gui.command`：新增安全 GUI 安装入口，从 FIFO 读取 token、移除 Windows CRLF 尾部 `CR`、清理管道、写入不含秘密的安装状态。
- `mac-agent/README.md`：固化跨 Windows/macOS 安装路径和验收条件。
- `PROJECT_MANIFEST.json`：把 Mac Worker 从离线升级阻塞更新为 v1.1.0 实机在线证据。

### 验证证据
- Windows 到 Mac 的独立运维 SSH 公钥认证成功；Mac 为 `lsb`、macOS `26.5.2`，Node.js `v24.18.0`，Codex CLI `0.144.1`。
- `zsh -n install-macos.sh` 与 `zsh -n install-macos-gui.command` 通过。
- Mac 安装后的 worker SHA-256 为 `b8e5847a5e91f7e105fb10d3474ab707dfb7c7e649bac14f7f7f552c05bf4dfa`，schema 为 `56b3c0677cb7bfda71f0f84423a7fa0f0a5d66e953699d98eb80a61e416be17e`。
- plist 通过 `plutil -lint`；持续观察到 LaunchAgent `runs=6`、`last exit code=0`、`run interval=60 seconds`。
- 最新五轮 worker 均输出 `{"ok":true,"task":null}`；生产内部状态为 `workerId=lsbmacbook-air-codex`、`status=idle`、`version=1.1.0`、`activeTaskId=null`，heartbeat 持续更新到 `2026-07-12T10:16:33.667Z`。
- FIFO 与 `/tmp/niannian-gui-orchestrate.zsh` 均已删除；token 未输出到工具结果、plist、日志或任务目录。

### Stops-too-early 检查
- 没有把文件上传、安装器成功文本或旧 `1.0.0` 心跳当成完成；直到 LaunchAgent 退出码为 `0` 且生产 API 出现新 `1.1.0` heartbeat 才关闭升级阻塞。
- 安装过程中先后发现并修复 SSH 钥匙串会话隔离、wrapper 引号和 Windows CRLF 三个真实问题，没有用手工临时注入环境变量掩盖后台失败。
- 没有创建客户测试任务、没有领取真实任务、没有调用 Mimo/ArtFlash/其他生成渠道，也没有消耗额度。

### 尚未验证
- 尚未在本次实机安装后发起一笔新的真实客户订单，因此没有验证新的 Mac `claim -> Codex -> provider -> result upload -> admin content QA -> customer download` 生产订单；此前本地完整 API 集成与历史真实 Mimo 回归仍是现有证据。
- 真实支付网关、对象存储、Lighthouse、axe/pa11y 和分析埋点仍未完成。

## 2026-07-12 Mac Worker v1.2.0 生产技能包与领取硬门复核

### 请求结果
为念念 AI 的 Mac Codex 独立员工安装一套最小、版本化、可校验的生产 Skill 路由，并保证缺 Skill、文件被改、Codex 未登录或渠道映射错误时，Worker 在领取客户任务前就阻断。

### 正确运行链路
1. 网站当前只创建 `channel=mimo` 的自动任务，Mac 生产包不复制 Windows 全量 Skills，只发布当前合同必需的最小集合。
2. Windows 上游通过固定 allowlist 构建 bundle，manifest 记录 bundle/最低 Worker 版本、渠道映射和每个文件的 SHA-256/字节数。
3. Mac 安装器先验证 bundle 全部文件，再备份同名旧 Skill、原子安装到 `~/.codex/skills`，最后写 `~/.codex/niannian-skill-bundle.json`；篡改包不能改变现有 Skills。
4. Worker 的 `run-once`、`claim` 和 `heartbeat` 在任何 claim API 之前检查 manifest、六个必需 Skills、全部文件哈希、最低 Worker 版本、Mimo 映射、Codex auth 和 Codex CLI。
5. 预检失败只发 `blocked` heartbeat，`activeTaskId=null`，不调用 claim；预检通过才检查已授权任务。
6. 新 Codex 员工先使用 `niannian-mac-production`，再进入生产总路由、视频质量方法、渠道路由和 Mimo Skill；锁定提示词不重写，不从旧目录找素材，不静默换渠道。

### 实际变更
- `mac-agent/skill-bundle/skills/niannian-mac-production/`：新增念念 AI 商业任务专用入口 Skill 与 Codex UI 元数据。
- `mac-agent/skill-bundle/bundle.config.json`、`build-skill-bundle.mjs`、`bundle-manifest.json`：固定六项 allowlist，复制权威上游 Skill 并生成文件级哈希清单。
- `mac-agent/skill-bundle/install-skill-bundle.mjs`：安装前完整验签、同名 Skill 备份、阶段目录安装、失败回滚和 installed manifest。
- `mac-agent/niannian-mac-worker.mjs`：升级到 v1.2.0，新增本地 preflight、缺包受控阻断和 `$niannian-mac-production` 明确入口。
- `mac-agent/install-macos.sh`：正式安装时先安装 Skill bundle，并把 installed manifest 路径交给 LaunchAgent。
- `scripts/mac-codex-worker.test.mjs`：增加缺包不 claim 回归，并让原领取/独立员工测试通过真实 bundle 校验。
- `scripts/mac-skill-bundle.test.mjs`、`package.json`：增加完整安装和篡改拒绝测试。
- `mac-agent/README.md`、`PROJECT_MANIFEST.json`：固化发布、升级、阻断和验收口径。

### 验证证据
- `skill-creator quick_validate.py`：`niannian-mac-production` 合法。
- bundle v1.0.0：6 个必需 Skills、30 个文件；当前渠道映射仅 `mimo -> mimo-8001-video-channel`。
- `node --check`：Worker、builder、installer 和 bundle 测试脚本全部通过。
- `npm run test:mac-worker`：3/3，通过缺 manifest 时 heartbeat blocked 且 claim 次数为 0、SHA 素材 staging/report、fresh Codex employee running/completed 回传。
- `npm run test:mac-skill-bundle`：2/2，通过完整安装和单文件篡改在安装前拒绝且不写 installed manifest。
- `npm run test:video-worker`：9/9；`npm run test:mimo-direct`：1/1；`npm run lint`、`npm run build`、`npm audit --omit=dev` 全部通过，已知生产依赖漏洞为 0。
- 隔离本地 Next 服务上的 `npm run test:mac-worker:integration` 输出 `MAC_WORKER_API_INTEGRATION_PASS`，临时任务/用户/文件完成清理；没有调用真实供应商。
- Mac 实机先安装 Worker v1.2.0 但不装 bundle：生产 heartbeat 为 `blocked`、`activeTaskId=null`、blocker=`SKILL_BUNDLE_MANIFEST_MISSING_OR_INVALID`，日志回执明确 `task=null`，证明领取前硬门真实生效。
- 随后实机安装 bundle v1.0.0 的六个 Skills；持续观察到 LaunchAgent `runs=52`、`last exit code=0`，最新五轮均输出 `{"ok":true,"task":null}`，本地任务目录数为 0。生产状态为 `idle`、`version=1.2.0`、`activeTaskId=null`，heartbeat 更新到 `2026-07-12T11:02:10.665Z`；Mac 安装的 Worker 与 installed manifest SHA-256 均与本地正式包一致。

### Stops-too-early 检查
- 没有把“Mac 有一些 Skills”当作可生产；对照 Worker 实际 prompt 与网站当前 Mimo 路由，固定并校验最小闭包。
- 没有只检查目录名；Worker 每分钟复算 manifest 中全部文件哈希，改一个文件也会停止领取。
- 没有只做单元测试；在真实 Mac 上先制造缺包状态证明 claim 前阻断，再装包证明恢复。
- 没有把 preflight ready 当成真实视频生成；本轮没有创建生产客户订单、没有上传客户素材、没有调用 Mimo generate、没有消耗额度。
- 没有把 Windows 全量 Skills 搬到 Mac；未开放的 TMLab、ArtFlash、DJPSD、Hi-light 不在 v1.0.0 默认包，未来必须提升 bundle 版本并补对应渠道映射和回归。

### 尚未验证
- 尚未用 Worker v1.2.0 + bundle v1.0.0 执行一笔新的真实付费客户订单，因此真实 `Codex -> Mimo submit/poll/download -> 网站上传 -> 管理员 QA -> 客户下载` 仍保留为生产订单验收项。
- Skill 完整不等于 Mimo 登录态和余额永远有效；真实任务仍必须执行渠道登录、额度与成本 readback，失效时写 blocker，不能伪造输出。

## 2026-07-12 普通图生视频不再强制动作参考

### 请求结果
修复登录后生成工作台把所有视频任务硬编码为动作迁移的问题，使“至少一张人物、商品或场景图片 + 提示词”可以创建普通图生视频任务；只有上传动作参考视频时才进入动作迁移。

### 正确运行链路
1. 前端只要求提示词与至少一张图片；动作参考视频明确为可选。
2. 服务端重新读取用户已上传并确认的素材，独立执行同样的最低图片门禁。
3. 无动作视频时写入 `generation_type=image_to_video`；有动作视频时写入 `generation_type=action_transfer`。
4. Mac claim payload 透传规范中的 `generationType`；历史任务没有新字段时，按动作参考职责兼容推导，不能一律误判为普通图生视频。
5. 后续成本授权、Mac 新鲜 readiness、真实 Mimo 提交、下载、媒体探测、账本和管理员内容 QA 门禁保持不变。

### 实际变更
- `app/home/page.tsx`：删除动作视频强制校验；允许人物、商品或场景任一图片；动作参考标记为可选；页面实时显示“图生视频/动作迁移”。
- `lib/video-tasks.ts`：服务端图片门禁、任务类型推导和 `video_task_spec.json.generation_type`。
- `lib/mac-codex-worker.ts`：向 Mac 任务透传类型，并为无新字段的历史任务增加按参考职责推导的兼容路径。
- `scripts/manual-task.integration.mjs`：同时覆盖带动作视频的 `action_transfer` 与单人物图的 `image_to_video`，且不调用真实供应商。
- `README.md`：固化任务类型合同。

### 验证证据
- `npm run lint` 通过。
- 本地与腾讯生产 Docker 的 `npm run build` 均完成 34 条路由构建。
- `npm run test:manual-task:integration` 输出 `MANUAL_TASK_INTEGRATION_PASS`；单图任务成功创建、保留 20 积分预留合同并写入 `image_to_video`，动作迁移测试仍写入 `action_transfer`。
- `npm run test:mac-worker` 4/4、`npm run test:video-worker` 9/9、`npm run test:mimo-direct` 1/1。
- 生产容器重建后为 `healthy`，公网工作台显示“动作参考视频（可选）”和“图生视频”。
- 生产 Mac Worker v1.3.0 在重启后继续上报 `readyToClaim=true`；Skill bundle 1.1.0、`ffprobe`、Mimo 登录均正常，额度只读读回 495。
- 部署前备份位于 `/opt/niannian-ai-video-workbench/backups/image-to-video-20260712-2315`。

### Stops-too-early 检查
- 没有只删除前端提示：服务端原有强制 motion 门禁同步修复。
- 没有只让建单通过：任务规范增加明确类型并传给 Mac 员工。
- 没有用当前新任务假设覆盖历史任务：缺字段时按动作参考职责兼容推导。
- 没有把构建、页面文案或模拟素材任务当成真实成片；本轮未调用 Mimo generate、未消耗供应商额度、未创建用户生产任务。

### 尚未验证
- 用户本人尚未在刷新后的生产页面重新上传照片并点击创建，因此真实客户任务的积分预留、Mac claim、Mimo provider task ID、下载、媒体探测、内容 QA 和客户播放仍需下一步闭环测试。
