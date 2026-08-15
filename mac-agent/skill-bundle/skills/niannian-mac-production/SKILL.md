---
name: niannian-mac-production
description: Execute one authorized 念念 AI commercial customer video task on the dedicated Mac Codex worker. Use only for task directories created by niannian-mac-worker with task.json, INSTRUCTIONS.md, SHA-verified inputs, locked prompt, allowed channel, and authorized cost gate; route through the installed AI-video and channel skills, return worker-result.json, and never modify website source code.
---

# 念念 AI Mac 生产员工

只执行当前任务目录中的一笔已授权客户任务。网站负责订单、积分、授权、队列和交付；本 Skill 负责在 Mac 上按锁定合同完成真实渠道执行并写回执。

## 入口门

1. 读取当前目录的 `INSTRUCTIONS.md` 与 `task.json`。
2. 要求任务包含锁定提示词及 SHA、已授权成本门、唯一允许渠道、精确素材路径和 SHA、输出目录。字段缺失或冲突时写 `blocked` 回执，不猜测、不补交。
3. 只使用 `task.json.references[].localPath` 中已下载并校验的素材。不得从 `latest`、浏览器历史、旧任务、候选目录或聊天记忆挑文件。
4. 本任务不授权本地修图。不得用 PIL、OpenCV、ImageMagick、ffmpeg 静帧滤镜、canvas 或截图补丁制作生产参考图。
5. 父级 Worker 的 production readiness、heartbeat、claim、租约恢复和 run-once 编排是唯一权威。子员工不得重新运行这些父级操作，也不得用沙盒检查替代；只消费已领取且锁定的 `task.json`，渠道阻塞时只报告 blocker。

## 路由

按顺序使用最小技能链：

```text
niannian-mac-production
-> ai-video-production-router（确认已锁定的已有图片图生视频路线，不重写事实）
-> ai-video-fundamentals-skill（检查素材、提示词和质量要求）
-> ai-video-channel-router（检查允许渠道、成本和提交门）
-> task.json 指定的渠道 Skill
```

当前商业版本只允许：

```text
mimo -> mimo-8001-video-channel
```

渠道不在清单内、对应 Skill 未安装或渠道登录/额度不可读时，写 `blocked`，不要静默换渠道。锁定提示词未发生重大改写时，不重新编译提示词。

## 执行

1. 检查 `submit_allowed=true`、`costGate.authorized=true`，并确认当前渠道属于 `allowedChannels`。视频参考必须按每份素材的 `referenceIntent` 使用；存在视频文件本身不等于动作迁移。
2. 如果已有 `providerTaskId`，只同步、轮询、下载、媒体探测和 QA；禁止再次提交。
3. 渠道 M 的认证和正式提交由父级 Worker 的受控官方上传桥接执行；子员工不得读取 Keychain、认证环境或将秘密复制到任务文件。桥接在提交成功后立即把真实 `providerTaskId` 写入 `worker-result.json`，状态先写 `running`，让父级 Worker 回传并保存供应商任务 ID。
4. 下载到当前任务的 `output/result.mp4`，写当前任务的 `ledger/execution-ledger.json`。账本至少记录渠道、任务 ID、输入路径/SHA、提示词 SHA、提交/完成时间、输出路径/SHA、媒体探测和 QA 状态。
5. 只有真实视频已下载、媒体探测通过且账本可解析时，才写 `completed`。内容仍由网站管理员 QA；Mac 不得自行宣称客户已交付。

## 回执

只输出符合 `worker-result.schema.json` 的 JSON：

- `running`：必须有真实 `providerTaskId`；不上传假视频。
- `completed`：必须有绝对 `outputPath` 和 `ledgerPath`。
- `blocked`：写清可操作 blocker；不得用计划、截图、模拟视频或旧文件代替真实产物。

不要自行调用网站 `report`；由 `run-once` 父级 Worker 统一上传一次。不要输出密码、Cookie、token、验证码或浏览器会话秘密。
