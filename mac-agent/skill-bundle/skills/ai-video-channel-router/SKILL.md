---
name: ai-video-channel-router
description: 中文 AI 视频渠道执行子路由。用于在已选定视频模型后选择和调用 TMLab、Mimo、Dola/dola.com/Dola2API、ArtFlash/artflash.cn、画影AI/DJPSD、Freebeat、Hi-light、Navos、Storeel、RunningHub、Seedance2 等真实视频生成渠道；当用户提到视频渠道、主力视频渠道、Dola、Dola2API、Dola图生视频、TMLab、agent.tmlab.top、api.tmlab.top、Mimo、ArtFlash、artflash.cn、shiping.djpsd.com、画影AI、DJPSD、freebeat.ai、Freebeat、方法4、Seedance2渠道、登录额度、真实提交、下载、视频QA、加白线、白线效果、过face、过人脸、artifact ledger 或把视频平台沉淀成适配器时使用。跨图片与视频、按模型类别选渠道、Image2、可灵/Kling、Vidu 或 Grok 的总路由先使用 ai-image-video-channel-router；本 skill 只管选中视频任务的渠道、账号/代理/额度/提交/下载/证据边界，不替代创作质量判断。
---

# AI 视频渠道路由

这个 skill 是 AI 视频系统的“渠道层”。它不负责把视频想好，而是负责把已经批准的图片、首帧、故事板和视频提示词，通过最合适的真实生成渠道跑出来，并把过程记录成可复用证据。

## 职责边界

- 跨图片与视频或按模型类别选渠道时，先由 `ai-image-video-channel-router` 选定 `model_class` 和视频候选渠道；本 skill 只执行视频子路线。
- 先使用 `ai-video-fundamentals-skill` 判断创意、镜头、资产、提示词和成片质量。
- 再使用本 skill 选择真实执行渠道。
- 渠道 skill 只处理登录、代理、额度、上传、提交、轮询、下载、媒体探测、QA、manifest、artifact ledger 和 blocker。
- 不改写已批准提示词，不替换参考图，不把渠道便利性凌驾于视频质量。

## Unified `video_task_spec.json`

真实视频渠道只消费统一视频任务规格，不从旧 Word、`latest` 文件夹、候选目录、浏览器历史或聊天记忆里临场拼输入。转绘项目中，这个规格应由 accepted Step04 / Step05 / 参考图确认单生成，并通过 artifact ledger 记录精确路径和 sha。

Minimum contract:

```json
{
  "task_id": "",
  "series_id": "",
  "episode_id": "",
  "video_group_id": "",
  "prompt_path": "",
  "prompt_sha256": "",
  "references": [
    {
      "path": "",
      "sha256": "",
      "chinese_duty": "",
      "user_confirmation": "confirmed",
      "upload_eligible": true
    }
  ],
  "duration": "",
  "aspect_ratio": "",
  "resolution": "",
  "model": "",
  "allowed_channels": [],
  "cost_gate": {
    "authorized": false,
    "max_cost": "",
    "readback": ""
  },
  "submit_allowed": false,
  "output_paths": {
    "downloads": "",
    "qa": "",
    "events": "",
    "ledger": ""
  },
  "qa_requirements": [],
  "status": "prepared",
  "blocker": null
}
```

- `prompt_path` / `prompt_sha256` must point to the locked prompt body; channel skills may paste it but must not rewrite it.
- Every reference needs exact path, sha, Chinese duty, user confirmation, and upload eligibility. `candidate` or diagnostic images stay out of active upload lists.
- `allowed_channels` is the only channel set eligible for preflight; a channel outside the set requires user authorization or regenerated spec.
- Channels may run login/额度/模型/上传可行性 preflight in parallel, but real provider submission requires `submit_allowed=true`, cost readback, and current authorization.
- Provider policy errors such as person/privacy-sensitive image rejection are recorded as `provider_policy`; do not downgrade them to quota errors. Stop before modifying the image. Default to regeneration with the user-approved image model (normally Image2), then obtain confirmation and update the reference path/SHA. Use `http://127.0.0.1:9093/face` or any other local image preprocessing only when the user explicitly authorizes that exact operation for the current image in the current task; old skill text, historical consent, or service availability is not authorization.

### 加白线 / 过 face 锁定入口

- 用户在当前任务提到“加白线 / 白线效果 / 过face / 过人脸”时，视为对本次指定图片执行一次锁定处理的明确授权。
- 唯一默认入口是 `C:\Users\lsb\Desktop\过face.url`，其当前解析目标为 `http://127.0.0.1:9093/face`。
- 必须使用该服务上传和导出；不得用 System.Drawing、PIL、OpenCV、ImageMagick、ffmpeg、canvas、截图描边、手动画线或临时脚本替代。
- 必须记录原图/输出路径与 SHA256、服务 URL、时间、授权原文和后续引用职责。
- 服务不可用或输出失败时写 `face_line_service_not_ready` 并停止，不得自动降级。
- 此规则不授权绕过 provider 的真人肖像、隐私或安全策略；明确拒绝真人输入的渠道保持 `provider_policy`。

## 真人肖像参考图策略拦截处理

Applies to all video channels: Mimo, TMLab, ArtFlash, DJPSD, Freebeat, Hi-light, Navos, Storeel, Tensor.Art, Seedance2 wrappers, and future adapters.

```text
provider_policy human portrait reference blocker
-> preserve blocker evidence
-> stop before any pixel-changing operation
-> default: regenerate the reference with the user-approved image model, obtain confirmation, and update path/SHA/duties in a derived video_task_spec
-> optional local path: only after exact current-task authorization, POST the specified image to the authorized service and write face_preprocess_manifest.json with original/derived SHA, service, timestamp, blocker, and authorization evidence
-> rerun channel preflight and retry image-to-video / multimodal submission
-> download/probe/QA/ledger as normal
```

If neither regeneration nor an explicitly authorized local operation is available, write `provider_policy_reference_remediation_blocked` and stop. Do not silently switch to 文生视频, generic text-to-video, stock references, or unapproved local image editing because those break quality, authorization, and lineage.

## Channel Capability Registry

渠道选择不能只靠文字优先级或临场记忆。每个可复用视频渠道都应有机器可读能力记录，供 `video_task_spec.json.allowed_channels` 和 preflight 对照。

Minimum capability record:

```json
{
  "channel": "mimo-8001",
  "models": ["Seedance 2.0"],
  "supported_durations_seconds": [],
  "aspect_ratios": ["9:16"],
  "max_upload_references": 1,
  "supports_multi_reference": false,
  "supports_audio_toggle": true,
  "default_resolution": "720p",
  "known_policy_blockers": ["provider_policy"],
  "cost_unit": "",
  "download_method": "api_or_history",
  "best_for": [],
  "avoid_for": [],
  "last_verified_at": "",
  "status": "available"
}
```

Preflight must compare the task spec against this capability record before upload:

- If requested duration is unsupported, choose the nearest supported duration only when the upstream project skill permits it and the spec records the duration strategy.
- If the task requires multiple references but the channel supports one, keep non-upload authority images in the spec and upload only the confirmed first frame, or switch channels only with user authorization.
- If a provider rejects the input for privacy/person policy, write `provider_policy`; do not relabel it as quota, upload failure, or prompt weakness.
- If no capability record exists for a channel, that channel is preflight-only until a first successful login/submit/download/probe flow creates the adapter evidence.

## 平台适配器优先级

当用户要求把某个平台沉淀成可复用通道，或已经在真实页面里跑通登录/提交/下载时，必须把平台行为沉淀为“适配器”而不是只靠临时对话记忆。先读 `references/channel-adapter-contract.md`，再写或使用对应平台 SOP。

当前 Hi-light 已有独立渠道 skill：`hilight-video-channel`，并保留详细 SOP：`references/hi-light-video-quick-adapter.md`。进入 Hi-light 视频快创时必须叠加 `hilight-video-channel`；保存男生展示面/形象展示视频时，额外读取 `references/hi-light-male-showcase-save-workflow.md`。默认先走：

```text
素材工坊 -> 视频快创 -> 参数 preflight -> 上传素材 -> 填提示词 -> 提交 -> 历史记录下载 -> media probe -> 账号/ledger 标记
```

Hi-light 默认参数规则：

- 比例：电商/带货/短视频默认 `9:16`，除非上游镜头需求指定横版、方版或智能比例。
- 清晰度：默认 `720P`，除非用户明确要求 `1080P` 或质检发现 720P 不够。
- 时长：不固定；按真实镜头需求、预算和星数选择。不要为了省星数破坏镜头叙事。
- 生成音频：按项目需求决定；如果后期要统一配音/BGM，默认不依赖平台原生音频。

账号使用状态必须闭环：某邮箱/账号一旦在渠道完成登录、额度探测、提交、下载任一真实动作，就立即在账号表或 ledger 中把该渠道标记为 `1`。Excel 被占用时，不要谎称已写入；先写 ledger 或临时待同步记录，等文件释放再同步。
- 不把结构化计划、模拟视频、FFmpeg 静态动效或页面截图冒充真实 provider 输出。

当前 TMLab 已被用户指定为主力视频渠道之一：画布地址 `https://agent.tmlab.top`，API 接入 `https://api.tmlab.top`。进入 TMLab 真实视频生成时必须叠加 `tmlab-video-channel`。TMLab 可以走画布/CDP或 API；API endpoint 未验证前只做 preflight/契约发现，不直接调用付费生成。

当前 ArtFlash 已被用户指定为可用视频渠道之一：入口 `https://artflash.cn/canvas`，已验证可通过 BitBrowser/CDP 读取登录态和调用 API 上传多参考图、参考音频并提交 Seedance2 视频。进入 ArtFlash 真实视频生成时必须叠加 `artflash-video-channel`。ArtFlash 不用慢速手点；优先走 CDP cookies + API 上传/保存画布/提交任务。

## 当前禁用渠道硬规则

- Tensor.Art / Tensor 渠道已由用户在 2026-07-03 明确停用。生产视频不得再路由到 Tensor.Art，不得使用 Tensor 旧号、旧画布、旧产物或 Tensor 邮箱轮换继续执行。
- Echoon 渠道已由用户此前明确停用。生产视频不得再路由到 Echoon。
- 如果旧 run、旧提示词或旧账本仍写着 Tensor.Art / Echoon，按过期信息处理，必须改走当前可用非禁用渠道；不能继续旧渠道。
- 只有用户在当前 turn 明确说“重新启用 Tensor.Art/Tensor”或“重新启用 Echoon”时，才允许解除对应禁用；解除前必须同步更新 skill、run checkpoint、evidence log 和渠道账本。

## 默认渠道选择

优先级按用户当前选择执行：

1. 用户指定 Mimo / fd.aancn.cn / NAS 8001 / nas.mimo.fashion / ai.mimo.fashion / Mimo Seedance2 时，直接路由到 `mimo-8001-video-channel`；当前权威入口是 `https://fd.aancn.cn`，旧域名只用于识别历史任务，不得路由当前执行。
2. 用户指定 TMLab / tmlab / agent.tmlab.top / api.tmlab.top 时，直接路由到 `tmlab-video-channel`。
3. 用户指定 Dola / dola.com / Dola2API / Dola 图生视频时，直接路由到 `dola-video-channel`。Dola 当前为 `preflight_only`，在真实视频下载、media probe 和 QA 首次闭环前不得报告为已跑通渠道。
4. 用户指定 ArtFlash / artflash.cn / 比特窗口8新生视频渠道时，直接路由到 `artflash-video-channel`。
5. 用户指定 Tensor.Art、Echoon、Storeel、RunningHub 或其他平台时，使用对应渠道 skill；没有专门 skill 时，先做渠道 preflight，不直接真实提交。
6. 用户只说“跑视频”“用 Seedance2 出视频”且没有指定渠道时，默认优先考虑当前两个主力渠道 TMLab 与 Mimo：先做 TMLab/Mimo 登录态、额度、模型、上传和下载路径 preflight，再按可用性、成本、镜头需求选择；不要在一个渠道失败后静默切换真实提交。
7. 用户指定 Navos / 方法4 / Navos Seedance2 时，只有当前任务明确重新授权 Navos 才路由到 `navos-seedance2-channel`；否则按过期渠道处理。
8. 如果目标任务是图片生成而非视频生成，转交 Image2 / RunningHub / 对应图片渠道，不强行进入视频渠道。

## 渠道 Preflight

真实提交前必须确认：

- `video_task_spec.json` exists for the current task and `submit_allowed=true` before any paid/real submit; if false, only preflight is allowed. Before real submit, run:

```powershell
node tools\verify_redraw_routing_contracts.js --video-task-spec "<video_task_spec.json>" --channel-capabilities "<video_channel_capabilities.json>"
```

For redraw jobs with dashboard/Step04 sidecars, prefer:

```powershell
node tools\verify_redraw_routing_contracts.js --job "<job_dir>"
```
- 输入资产已 verified：参考图、首帧、故事板图或产品图真实存在，路径来自当前 run manifest 或用户明确提供。
- 提示词已批准：使用 locked prompt / approved prompt；不得临场重写成另一个版本。
- 渠道可用：登录态、额度、代理、地域、模型入口、上传控件和下载路径可用。
- 成本授权清楚：免费额度可用或用户当前 turn 明确授权真实消耗。
- 输出路径清楚：当前 run 的 clips/images/downloads/qa/events/ledger 路径已确定。
- 禁止项清楚：不输出 token、验证码、cookie、refresh token；不绕过 CAPTCHA/真人验证。

## 执行记录

每次真实渠道执行至少记录：

- `channel`: 例如 `navos-seedance2`。
- `video_task_spec` 路径和 sha；若无规格，真实提交无效并必须补规格。
- `provider_task_id` 或页面任务标识；没有就记录 `provider_task_id_unavailable`。
- 输入参考图路径、prompt 路径或 prompt sha。
- 提交时间、完成时间、下载时间。
- 本地输出路径、文件大小、媒体探测结果。
- QA 结论：`downloaded_not_verified`、`verified`、`qa_failed_quality_issue` 或 `blocked`。
- blocker 分类：login、proxy、quota、upload、generation、download、media_probe、content_quality。

## 输出目录与错参考拒绝

- 每次视频任务必须在 `video_task_spec.output_paths` 或 job-local `output_destination.json` 记录最终输出目录。当前 `partial_xuedi` / 偏心短剧正式视频输出目录固定为 `C:\Users\lsb\Pictures\ai视频\偏心`，除非用户本次明确改目录。
- 只有新生成、非拒绝、已下载、媒体探测通过、内容 QA 通过、ledger/manifest 标记 `verified` 或 `delivered` 的 MP4 才能复制到最终输出目录；probe 失败、QA 未跑、候选、诊断、历史、被用户否决或错参考输出都不得复制。
- 如果 provider 输出使用了错误/缺失的首帧、人物/道具参考图、参考音频、locked prompt、时长、比例、分辨率或模型设置，立即分类为 `reference_mismatch`，状态写 `rejected_wrong_reference`，记录到 rejection manifest / `90_REJECTED_HISTORY`，设置 `downstream_consumable=false`。不得混剪、续写、包装、交付，也不得作为下一段视频参考。
- 错参考视频可以按用户要求从 active downloads 中删除或移走，但必须先保留最小拒绝证据：provider task id、提交批次、错误原因、原文件路径或隔离路径、manifest/status 更新。不要把“删掉了”当成完成；正确恢复动作是回到当前 approved `video_task_spec`，用正确参考图重新提交图生视频/多参考视频。

## 主力渠道规则

### TMLab 主力渠道规则

TMLab 已被用户指定为当前 AI 视频主力渠道之一。只要任务是 Seedance2 / 图生视频 / 真实视频生成，且用户没有指定别的渠道，必须把 TMLab 纳入主力 preflight，与 Mimo 一起比较可用性。

调用 TMLab 时必须叠加 `tmlab-video-channel`，并按这个快速路径执行：

```text
确认输入已批准
-> TMLab 画布/API 登录态和额度 preflight
-> 模型、时长、比例、分辨率、音频能力读回
-> 上传已批准素材并检查无旧素材污染
-> 使用 locked prompt
-> 用户已授权时提交真实生成
-> 轮询任务/历史记录/API 状态
-> 下载真实视频
-> media probe
-> 内容 QA
-> 写 manifest / ledger / events / blocker
```

如果 TMLab 登录、API 鉴权、额度、上传、生成或下载阻塞，停止并写 blocker；不要静默改用其他渠道真实提交，除非用户明确授权换渠道。

### Mimo 主力渠道规则

Mimo 已被用户指定为当前 AI 视频主力渠道。只要任务是 Seedance2 / 图生视频 / 真实视频生成，且用户没有指定别的渠道，优先尝试 Mimo。

调用 Mimo 时必须叠加 `mimo-8001-video-channel`，并按这个快速路径执行：

```text
确认输入已批准
-> Mimo 登录态和额度 preflight
-> 额度检查
-> 先确认主首帧，再为关键道具建立多参考图与引用职责
-> 使用 locked prompt
-> 用户已授权时提交真实生成
-> 轮询任务
-> 下载真实视频
-> media probe
-> 内容 QA
-> 写 manifest / ledger / events / blocker
```

如果 Mimo 登录、额度、上传、生成或下载阻塞，停止并写 blocker；不要静默改用其他渠道，除非用户明确授权换渠道。转绘视频优先使用当前镜头已验收的故事板图或目标首帧；当镜头事实里有相框合影、耳机、戒指盒、文件交接等关键道具时，先建立 `mimo_reference_plan.json`，逐张写清“这张图负责什么”，再提交。contact sheet 默认只用于人工核对镜头顺序，不作为 active reference。

### 画影AI / DJPSD 可用渠道规则

画影AI / DJPSD 是用户补充的可用视频渠道：入口 `https://shiping.djpsd.com`，邀请注册地址 `https://shiping.djpsd.com/register?invite_code=7nYNGZ`。当用户明确指定 `shiping.djpsd.com`、`画影AI`、`DJPSD` 或“这个渠道”时，必须叠加 `djpsd-video-channel`。

该渠道当前作为可用/备选渠道沉淀，不自动取代 TMLab / Mimo 主力默认选择。若主力渠道阻塞，只有在用户明确同意切换或任务本身指定 DJPSD 时，才用 DJPSD 真实提交。

调用 DJPSD 时按这个快速路径执行：

```text
确认输入已批准
-> DJPSD 登录态/API token preflight
-> /user/me 和 /task/cost-rules 读回积分与扣费
-> 选择比例、时长并确认积分足够
-> 上传已批准素材并记录 URL/hash
-> 使用 locked prompt
-> 用户已授权时提交 /task/create
-> 轮询 /task/list
-> 下载 result_url
-> media probe
-> 内容 QA
-> 写 manifest / ledger / events / blocker
```

DJPSD 已观察到 5/10/15 秒视频扣费分别为 5/10/15 积分，UI 提示 15 秒常会压缩/降级成 10 秒；默认优先 10 秒，低成本测试可用 5 秒。不要在没有明确授权的情况下调用 `/task/create` 触发真实扣费。

### Freebeat / freebeat.ai 可用渠道规则

Freebeat 是用户补充的可用视频渠道：入口 `https://freebeat.ai/zh/ai-video-generator?model=seedance-2.0`。当用户明确指定 `freebeat.ai`、`Freebeat`、`freebeat` 或“用 freebeat 做视频”时，用 CDP 浏览器执行，不用内置浏览器作为生产上传面；内置浏览器只可用于查看/临时登录排查。当前已验证可用 CDP 端口示例：`9223`，真实运行前必须重新探测当前可用端口和登录态。

该渠道当前作为可用/备选渠道沉淀，不自动取代 TMLab / Mimo 主力默认选择。若主力渠道阻塞，只有在用户明确同意切换或任务本身指定 Freebeat 时，才用 Freebeat 真实提交。

Freebeat 默认参数规则：
- 模型：优先 `SeedDance 2.0`，除非用户指定其他模型。
- 比例：电商/带货/短视频默认 `9:16`。
- 清晰度：默认 `720p`。
- 时长：严格按原参考视频分镜时长选择；平台支持 4s-15s 时按原片镜头最近可用秒数选择，不要固定 4s。
- 音频：默认打开；除非用户明确要求关闭或后期统一无声生成。
- 素材：必须上传已验收首帧/参考图，上传后检查画面预览与当前镜头匹配，禁止旧图污染。

调用 Freebeat 时按这个快速路径执行：

```text
确认输入已批准 -> CDP 打开 Freebeat 生成器 -> 登录态和余额/消耗 preflight -> 账号表 Freebeat 标记 -> 设置 9:16 / 原片时长 / 720p / 音频开启 / SeedDance 2.0 -> 上传已批准首帧 -> 使用 locked prompt -> 人工确认页面参数和首帧 -> 用户明确授权时点击创作 -> 轮询历史/任务 -> 下载真实视频 -> media probe -> 内容 QA -> 写 manifest / ledger / blocker
```

Freebeat 阻塞处理：
- CDP 登录失效：先在同一个 CDP 浏览器登录，不要切回内置浏览器完成生产流程。
- 上传失败：优先使用 CDP `setInputFiles`；若当前浏览器不可控，要求用户把可见浏览器切到可控 CDP 或提供可控端口。
- 网络/代理失败：只修 Freebeat 使用的 CDP 浏览器代理，不改全局代理；新开 Chrome 必须复用能访问 Freebeat 的代理和登录环境。
- 额度不足：记录账号 Freebeat 为 `0额度` 或写 ledger，不提交真实生成。
- 不要在没有用户明确授权的情况下点击 `创作` 触发真实扣费。

### ArtFlash / artflash.cn 可用渠道规则

ArtFlash 是用户补充的可用视频渠道：入口 `https://artflash.cn/canvas`。当用户明确指定 `ArtFlash`、`artflash.cn`、`比特窗口`、具体窗口号如 `窗口3/4/5`、`新生视频渠道` 或“这个新渠道”时，必须叠加 `artflash-video-channel`。

该渠道当前作为可用/备选渠道沉淀，不自动取代 TMLab / Mimo 主力默认选择。若主力渠道阻塞，只有在用户明确同意切换或任务本身指定 ArtFlash 时，才用 ArtFlash 真实提交。

ArtFlash 默认参数规则：
- 模型：`doubao-seedance-2-0-260128` / Seedance2。
- 比例：电商/带货/短视频默认 `9:16`。
- 清晰度：15s 生产按账号默认节奏执行，每个账号默认 4 段 15s，前 2 段 `1080p`，后 2 段 `720p`；除非任务规格或用户另有指定。
- 时长：严格消费 `video_task_spec.json`；15s 合并版本使用 `duration=15`。
- 音频：如果任务依赖原生口播或音色锁定，必须上传参考音频并记录 `audio_count > 0`。
- 素材：上传全部 `upload_eligible=true` 的参考图，包括合并大段里每个原小段已验收首帧/关键帧和关键道具图；不得上传只给人工看的非上传参考图。

调用 ArtFlash 时按这个快速路径执行：

```text
确认输入已批准 -> CDP/API 读取 ArtFlash 登录态和 /api/me 额度 -> 上传所有 approved upload_eligible 图片与参考音频 -> 保存画布节点 -> 读回 prompt/image/audio/settings -> 用户授权时并发提交 -> 轮询任务 -> 下载真实视频 -> media probe -> 内容 QA -> 写 manifest / ledger / blocker
```

ArtFlash 15s 合并版本执行规则：
- 每批取两段 15s `video_task_spec.json`。
- 先把两段都上传并保存到画布，再同时调用 `/api/video/tasks` 提交。
- 提交后记录两个 provider task id 和初始轮询状态，再继续下一批两段。
- 同一账号默认做满 4 段 15s：第一批 2 段 `1080p`，第二批 2 段 `720p`；只有额度/API 读回明确不足或剩余 approved specs 少于 2 段时才提前换号/停止。
- 最后一批只剩一段时，先记录 `single_leftover_batch`，再单独提交。
- 任何一段缺少上传图、参考音频、完整 prompt、15s 时长、目标比例、Seedance2 模型或额度读回，整批停止，不要只提交半批。
## 失败处理

- 登录失效：要求用户完成登录或邮箱验证；不输出验证码明文。
- 代理失败：只修目标渠道的单应用代理，不改全局系统代理。Hi-light/Google 登录遇到 Cliproxy `forbidden ip`、IP 纯净度或 CDP 代理问题时，先读取 `cliproxy-residential-ip`，默认走 `127.0.0.1:18888` 本地链式代理和 Hi-light adapter 的 Proxy/CDP Login Preflight。
- 额度不足：写 quota blocker，不换假输出。
- 上传失败：记录具体文件和页面状态，等待修复或换图。
- 真人肖像参考图策略拦截：写 `provider_policy` 并先停止。默认用用户认可的 Image2/图片渠道重新生成参考图并重新确认；如果用户在当前任务明确要求“加白线 / 过face”，只可走锁定的 `C:\Users\lsb\Desktop\过face.url`（当前目标 `http://127.0.0.1:9093/face`）并用衍生 spec 重试。不得改用其他本地描边方法，也不得把白线用于绕过渠道的真人政策。不要改文生视频。
- 生成失败：保存 provider 错误、任务 ID 和输入 sha。
- 下载失败：保留 provider 完成证据和下载 blocker。
- QA 失败：保留下载文件但标记 `qa_failed_quality_issue`，交回创作/提示词/资产层迭代。

## 与上游系统的关系

- 转绘项目：只消费 accepted Step04 / Step05 / 视频任务注册给出的 locked prompt 和 verified refs。
- 带货项目：只消费已确认的产品素材、故事板、首帧和脚本。
- 任何渠道输出都不是最终交付；最终仍要通过对应项目的 QA、剪辑、字幕、包装和发布门。
## 2026-07-08 Voice/Duration/Continuity Guard
For Mimo/TMLab/Freebeat/DJPSD/Hi-light redraw jobs with native speech:
- Channel handoff must reject specs that use path-approved first frames but lack visual scene-continuity approval for connected shots.
- If a provider uses integer durations and the shot has spoken copy, provider duration must be `ceil(source_duration_seconds)`, not nearest/round-down.
- If the project has a locked voice timbre reference and relies on native provider audio, the request must upload that audio reference and record `audio_count > 0`; otherwise mark `voice_timbre_unlocked`, not QA pass.
