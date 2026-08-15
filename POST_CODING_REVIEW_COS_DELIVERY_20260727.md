# COS 成片交付 Level 3 Post-Coding Review（2026-07-27）

- 真实路径：`liusb0713@qq.com` 在 `https://sd2.cauai.fun/home` 打开已完成任务 `winmimo20260727162532436101`，通过网站原生播放器播放，并从 `https://sd2.cauai.fun/projects` 的“下载成片”按钮下载同一文件。
- 变更面：`lib/video-cos.ts` 支持 `TENCENT_COS_PUBLIC_HOST`；`next.config.mjs` 的 `img-src`/`media-src` 允许 `https://media.sd2.cauai.fun`；`deploy/cos-app-override.yml` 固定 app-only 候选 `2026.07.27-cos-r4`；Cloudflare Worker 只转发精确已签名 COS MP4 GET/Range，恢复 inline 响应头且不保存凭据。
- 本地验证：`npm run test:cos-media-edge`（2/2）、`npm run test:video-cos`（4/4）、`npm run lint`、`npm run build` 均通过。生产切换前只读硬门为 `approvedForExecution=0`、`runningOnMimo=0`、`activeMimoProviderTasks=0`。
- 权威生产证据：活跃 app 为 `niannian-ai-video-workbench:2026.07.27-cos-r4`，镜像 SHA `357e79295bdd1cf4f6d2c032fe3ad63290aba80ea88c7e4979cf95d0189162df`，health 为 `healthy`，`/api/health` 为 HTTP 200，生产 CSP 已含边缘域名。边缘 Range 为 HTTP 206、`bytes 0-1023/2344423`；完整文件为 `2344423` bytes、SHA256 `b485a653d59e7256bb5e804793917454276dee99ab708da9e1b91e9e23309d99`。
- 用户可见完成边界：浏览器播放器读回 `duration=5.088`、`1280x720`、`readyState=4`、`errorCode=null`，经原生控制键实际播放后为 `currentTime=0.716`、`paused=false`；原生下载文件为 `2344423` bytes 且 SHA256 与 COS 成片一致。未验证多浏览器/高并发 CDN 性能；本次没有重提 Provider 任务、修改数据库结构或迁移数据卷。

## 日期显示修复（2026-07-27）

- 真实路径：生产工作台与任务记录页展示任务 `winmimo20260727162532436101` 的创建时间和更新时间；两处此前均会展示 `Invalid Date`。
- 变更面：新增 `lib/date-display.ts`，前端仅在合法时间时格式化日期，非法或缺失数据统一显示“时间待同步”；`app/home/page.tsx` 与 `app/projects/page.tsx` 使用该函数；数据库仅修复这条真实任务的两个带引号 ISO 字符串，未改任务状态、媒体、账本或积分。
- 本地验证：`npm run test:date-display`、`npm run lint`、`npm run build` 通过。候选镜像 `niannian-ai-video-workbench:2026.07.27-date-fix-r1` 已构建。
- 权威生产证据：活跃镜像 SHA `4c3c3619128251a6cbad63e9b16e57163e92d394cd584aca7c5dfca6237161cb`，health 为 `healthy`，`/api/health` 为 HTTP 200；只读硬门仍为全部零。数据库回读为 `2026-07-27T08:28:57.109Z` 与 `2026-07-27T08:57:40.138Z`，没有引号。
- 用户可见完成边界：工作台显示 `2026/7/27 16:28:57`，任务记录页显示同一创建时间及“更新于 2026/7/27 16:57:40”，两页均不含 `Invalid Date`。未修复的其他历史非法日期会安全显示“时间待同步”。

## Mimo 队列状态澄清（2026-07-27）

- 真实路径：用户在任务记录页查看新任务 `sbA1hKXToC_Pd0pFSpmWbCqa`（女主点头）。此前它只显示“正在排队”，容易被误解为 Windows Worker 已经失联。
- 变更面：`lib/video-task-public-state.ts` 把未获成本/执行授权的 Mimo `queued_skill` 映射为 `authorization`，并提供可测试的阶段说明；`/api/video-tasks` 读取无秘密的 Windows Worker 可用状态；工作台与任务记录显示任务的准确阶段和说明。
- 本地验证：`npm run test:video-task-public-state`（2/2）、`npm run lint`、`npm run build` 通过。候选镜像 `niannian-ai-video-workbench:2026.07.27-task-state-r1` 已构建。
- 权威生产证据：活跃镜像 `niannian-ai-video-workbench:2026.07.27-task-state-r2`，SHA `b83241307e0987b9a2cb3db4b20a7b030ee56e15e0c6246c8af80478eece4fb6`，health 为 `healthy`，`/api/health` 为 HTTP 200；只读硬门为 `approvedForExecution=0`、`runningOnMimo=0`、`activeMimoProviderTasks=0`。Windows Worker 现场回读为 `idle`、`readyToClaim=true`、`authenticated=true`、`activeTaskId=null`。
- 用户可见完成边界：生产任务记录显示“等待执行授权”以及“尚未提交 Mimo，也不会重复扣费。当前 Windows 执行器已就绪。授权后 Windows 执行器会自动领取本条任务。”本次没有改变任务授权、领取、费用、Provider 提交或数据库任务状态。
