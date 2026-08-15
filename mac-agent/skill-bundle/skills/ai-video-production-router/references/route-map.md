# AI 视频路线表

| 路线 | 主入口 Skill ID | 当前真实来源 | 不可替代边界 |
| --- | --- | --- | --- |
| 原片短剧转绘 | `mx-shortdrama-00-router` | `D:\codex-work\zhuanhui\skills\mx-shortdrama-00-router\SKILL.md` | `Step01 -> Step02 -> Step04 -> Step05`；ArtFlash 默认规则仅在此路线内生效 |
| 只有剧本的短剧生产 | `mx-shortdrama-script-only-production` | `C:\Users\lsb\.codex\skills\mx-shortdrama-script-only-production\SKILL.md` | 走 `N00 -> N07`，不伪造原片事实 |
| 商业参考视频复刻 | `realistic-commerce-video-replication` | `C:\Users\lsb\.codex\skills\realistic-commerce-video-replication\SKILL.md` | 保留商业参考、产品和渠道合同 |
| 原创叙事 | `ai-film-champion-method` | `C:\Users\lsb\.codex\skills\ai-film-champion-method\SKILL.md` | 下游可用 `image2-narrative-firstframe`、`seedance2-narrative-shot-workflow` |
| 已有图片图生视频 | `sd2-video-generation` | `C:\Users\lsb\.codex\skills\sd2-video-generation\SKILL.md` | 只使用已确认、有职责和 SHA 的图片 |
| 共用渠道 | `ai-video-channel-router` | `C:\Users\lsb\.codex\skills\ai-video-channel-router\SKILL.md` | 只消费锁定 `video_task_spec.json` |

转绘 ArtFlash 执行 Skill 来源：`D:\codex-work\zhuanhui\skills\artflash-video-channel\SKILL.md`。它是 `mx-shortdrama-00-router` 的渠道子路线，不是父路由的跨路线默认值。
