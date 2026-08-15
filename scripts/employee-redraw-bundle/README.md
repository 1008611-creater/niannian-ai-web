# 员工版转绘视频 Skill 包

这是一个可交给员工 Codex 的中文转绘视频工作包。它把任务分类、商业参考视频转绘、首帧、Image2 图片参考和视频渠道执行路由放在同一包内。

## 使用方式

1. 将本压缩包和 `prompts/` 目录中的启动提示词一起交给员工。
2. 员工在 Codex 中先发送 `prompts/01_员工启动提示词.txt`，再附上原视频、目标商品素材、产品事实和授权信息。
3. Codex 应先解压并把 `skills/` 下的 Skill 目录安装到 `%USERPROFILE%/.codex/skills/`，然后读取 `README.md` 与各 Skill 的 `SKILL.md`。
4. 真实生成、付费提交、下载、交付必须在当前任务获得明确授权；未授权时只做分析、证据、提示词、任务规格和 preflight。

## 路线边界

转绘视频必须按 `Step01 -> Step02 -> Step03 -> Step04 -> Step05` 执行：先还原原片事实和镜头时间线，再绑定目标产品事实和素材，之后编译锁定提示词、选择视频渠道、执行并做媒体与内容 QA。不能把计划、旧文件夹、截图或 provider 状态当成成片。

包内不含任何 API key、cookie、验证码或员工账号信息。RunningHub 的 key 由员工在自己的安全环境中配置，不要把 key 写进提示词、文档、截图或聊天。

## 包含的 Skill

- `ai-video-production-router`
- `ai-video-fundamentals-skill`
- `ai-video-firstframe-workflow`
- `ai-video-channel-router`
- `commerce-video-redraw-router`
- `realistic-commerce-video-replication`
- `prompt-skill-router`
- `image2-storyboard-video`
- `runninghub-image2-image`
- `seedance2-commerce-video`
- `mimo-8001-video-channel`
