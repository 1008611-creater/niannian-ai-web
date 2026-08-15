# 转绘项目 Harness 规则

## 强制入口

任何带货视频转绘、参考视频复刻、商品/汽车视频改绘任务，先读取本项目 `README.md`、`MANIFEST.json` 和 `07_PROJECT_DOCS/`，再使用已安装的 `commerce-video-redraw-router`。禁止跳过上游事实：

```text
Step01 原片证据
-> Step02 原片模板时间线
-> Step03 目标产品事实与素材权威
-> Step04 锁定提示词与 video_task_spec
-> Step05 渠道执行、下载、QA、交付
```

## 状态权威

- `route_decision.json` 是建议性路由，不是生产完成证明。
- Artifact Ledger、Node Contract、QA Gate 和交付清单才是状态来源。
- `prepared`、`submitted`、`downloaded`、`verified`、`delivered` 必须分开。
- 不得从 `latest`、旧文件夹、浏览器历史、聊天记忆或旧提示词包选择当前输入。
- 所有当前输入必须使用精确路径和 SHA256。

## 写入和授权

- 写入生产文件前先声明当前节点、允许写入路径、预期输出和成本门。
- 真实 provider 提交、付费、消耗额度、发送、发布和交付必须取得当前任务明确授权。
- 未授权时只能做证据、路由决策、提示词、任务规格、preflight 和 QA 设计。
- 本地像素编辑默认禁止。生产图、候选图、首帧、参考图需要修改时，默认使用用户认可的 Image2 渠道重新生成；只有用户明确授权本次具体本地修图后才能使用本地编辑工具。

## 完成边界

计划、任务 ID、provider 状态、截图或存在一个 MP4 均不等于完成。只有精确媒体存在、媒体探测通过、内容 QA 通过、Artifact Ledger 状态正确时才能标记 `verified`；只有实际交给用户并有交付证据时才能标记 `delivered`。

任何脚本、Skill、Harness、模板或生产流程修改完成后，必须执行 post-coding review，并明确写出已验证和未验证内容。
