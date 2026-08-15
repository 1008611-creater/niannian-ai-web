---
name: ai-video-production-router
description: "AI 视频生产父级路由。用于根据输入选择原片短剧转绘、只有剧本的短剧生产、商业参考视频复刻、原创叙事或已有图片图生视频，并编排画面生产、锁定视频任务、渠道、质量与交付边界；不替代专业子路线的事实门、质量门或渠道合同。"
---

# AI 视频生产总路由

只做任务分类与共用能力编排。先识别输入来源、是否有原片、是否是商业参考、是否已有已确认图片、成片目标和提交授权；再进入唯一的专业子路线。不要把父路由当作事实来源、提示词生成器、渠道执行器或生产完成证明。

## 路线选择

按以下优先级选择，输入同时命中多项时以前项为准：

1. **原片短剧转绘**：有原片短剧、转绘、墨西哥/西语本土化、source timeline、资产提示词或 redraw/remake 要求时，进入 `mx-shortdrama-00-router`。必须保持 `Step01 -> Step02 -> Step04 -> Step05`，不得跳过原片事实、参考图确认或转绘专属质量门。当前 ArtFlash 默认规则属于此子路线：仅由已接受的转绘合同指定 `artflash-video-channel`，父路由不得把它改为通用默认渠道或自动 fallback。
2. **只有剧本的短剧生产**：没有参考视频、只有小说、剧本、大纲、对白稿、Word/PDF 文本或故事梗概时，进入 `mx-shortdrama-script-only-production`。使用其 `N00 -> N07` 链，不得伪造 Step01/Step02 原片事实。
3. **商业参考视频复刻**：以商品、带货、品牌或自然商业短视频为参考并要求复刻时，进入 `realistic-commerce-video-replication`。保留产品、渠道、授权与成片目标，不能把商业参考误判为短剧原片转绘。
4. **原创叙事**：原创 IP、叙事短片、竞赛影片或电影级叙事方向时，进入 `ai-film-champion-method`；按需要继续交给 `image2-narrative-firstframe` 和 `seedance2-narrative-shot-workflow`。连续叙事使用已批准首帧与尾帧衔接，不把独立候选图当作连续性证明。
5. **已有图片图生视频**：用户提供或已确认具体图片，要求图生视频、续写或参考图驱动片段时，进入 `sd2-video-generation`。图片必须有明确职责、精确路径与 SHA；先锁定视频任务，再选择执行渠道。

无法确认来源、授权、成片目标或图片职责时，停在分类/准备阶段并要求澄清；不得用较方便的路线替代证据充分的专业路线。

## Prompt Compilation Gate

After the parent router selects one specialist route, and before a new or materially rewritten image/first-frame/storyboard/video prompt is handed to execution, invoke `prompt-skill-router` as the AI-video prompt compiler.

```text
classify
-> specialist route supplies immutable authority facts
-> prompt-skill-router compiles and validates prompt_routing_contract.json
-> selected route authors locked video_task_spec.json
-> ai-video-channel-router / channel Skill executes only that task spec
```

The parent passes the specialist authority bundle unchanged: source facts, exact paths/SHA, reference duties, acceptance state, timing, product facts, and localization decisions cannot be rewritten by the parent or compiler. The compiler may normalize those facts into prompt sections, bind prompt/source hashes, select method/execution/QA layers, and emit explicit blockers only.

`prompt_routing_contract.json` is not a provider submission authorization. It must keep `provider_submit_allowed=false`; real submit still requires the downstream `video_task_spec.json`, allowed-channel policy, current login/quota/cost readback, and explicit authorization. Existing unchanged locked prompts may be inspected or executed through their established contract without unnecessary recompilation.

## 共用能力边界

- **画面生产**：由所选子路线决定资产、首帧、故事板与确认门；任何本地修图须先取得本次具体操作的用户明确授权。父路由不制作或提升候选图。
- **提示词编译**：新写或重大重写的 AI 视频提示词先经过 `prompt-skill-router`。它消费专业路线的权威事实并验证 `prompt_routing_contract.json`，但不制作事实、不提升候选图、不授权提交，也不替代专业路线质量门。
- **视频任务**：在子路线质量门和提示词编译门通过后，形成锁定的 `video_task_spec.json`。其中须固定提示词与 SHA、参考图职责/路径/SHA/确认状态、时长、比例、模型、允许渠道、成本门、输出路径和质量要求。
- **渠道**：使用 `ai-video-channel-router` 选择或调用渠道；渠道只消费锁定任务规格，不得改写提示词、替换参考图或从 `latest`、浏览器历史或旧包拼接输入。转绘渠道遵从 `mx-shortdrama-00-router` 的当前合同，ArtFlash 规则不外溢到其他路线。
- **质量与交付**：子路线定义质量门；渠道完成后须有真实媒体、媒体探测、视觉质量检查和产物账本/交付证据。提交、付费、发送和用户可见接受均须保留各自授权与状态，不能由父路由推定。

## 真实执行回执与复利

每次真实生产、下载、验收或用户反馈后，使用 `08_TEMPLATES/ai_video_execution_receipt.template.json` 写同一份 `ai_video_execution_receipt.json`，并运行 `node tools/verify_ai_video_execution_receipt.js --receipt <exact_path>`。回执必须记录：选中路线和入口 Skill、权威输入路径/SHA、锁定 `video_task_spec`、渠道任务 ID、成本/授权回读、下载媒体、媒体与内容 QA、账本晋级、用户反馈和后续迭代候选。

状态必须分开：`prepared`、`submitted`、`downloaded`、`qa_passed`、`verified`、`delivered`。`submitted` 不等于生成完成；`downloaded` 不等于 QA 通过；只有 `verified` 或 `delivered` 的精确媒体才可标记为下游可消费。候选图、诊断图、未确认首帧和 rejected 产物不得进入回执的可消费输出。

复利只消费有真实 QA 或用户反馈证据的回执。员工可以写事实性反馈，不得自行升级 Skill；反馈进入 `skill-governance -> challenger -> same-input regression -> post-coding review -> governance authorization -> release`。没有真实任务输入、用户确认、渠道授权或成本授权时，写 `prepared`/`blocked` 回执，不得伪造前向生产通过。

读取 [路线表](references/route-map.md) 以核对当前真实 Skill 来源与分工。只加载本次选中路线所需的下游 Skill。
