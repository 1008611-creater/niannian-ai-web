# 工作台矿物流动背景 V2 生产部署审查

## 请求与正确执行路径

用户明确确认把已经本地验证的工作台 V2 部署到 `https://sd2.cauai.fun`。正确路径是：冻结最小运行时包；检查生产版本、Compose project、卷、队列和数据指纹；备份 V1 源并标记当前 app image；在旧 app 在线时构建 V2 image；只 recreate app；等待 health；再次比较数据；检查公网媒体；用已登录生产浏览器验证桌面和移动；保留回滚并清理 staging。数据库、Worker、Mimo、积分和任务不在授权范围。

## 实际生产变更

四文件包：`output/niannian-workbench-mineral-v2-runtime-20260715.tar.gz`，SHA256 `DE025C832363BF4F8CC8A04167B9C28121636D8C178D55E79C12CEE8755C472F`，严格包含：

- `app/globals.css`
- `components/MineralFlowBackground.tsx`
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.webm`
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.mp4`

没有把 `scripts/render-mineral-flow-v2.mjs`、本地 `.next-preview-3032`、本地 auth preview 脚本、`next.config.mjs`、`package.json`、`tsconfig.json`、证据文件或其他本地改动加入生产包。

## 部署前门

- 生产目录：`/opt/niannian-ai-video-workbench`；Compose project：`niannian-ai-video-workbench`；origin：`127.0.0.1:18084`。
- 部署前 app image：`sha256:65d1208fa70284d4825bb7649262ebf6894aa30840e198568352d5f181d1c25e`，healthy。
- PostgreSQL volume：`niannian-ai-video-workbench_niannian-postgres`；data volume：`niannian-ai-video-workbench_niannian-data`。
- `approvedForExecution=0`、`runningOnMac=0`；没有进行 claim 或 provider 操作。
- 部署前计数：用户 5、任务 6、素材 6、事件 853、积分账户 5、账本 7、参考元数据 4。
- 部署前指纹：任务 `86b64d77066047a0015669323f3698c82f96320ca1e705277743205b3fd7b0c4`；素材 `7add6befeeefcb5d422954304a13ba958776c1fae0bf52a35e795d938daa89a8`；积分 `1d096a135de29e3d776633f6819567fa6dad78316661a346d362a889796e32ef`；账本 `f2114314de312023f28fbaacfa49d561d3d3c97a36ca05b76b28b29a2637a11c`。
- 远端包 SHA 与本地一致，解包文件数严格为 4。

## 构建、切换与回滚

- V1 源备份：`/opt/niannian-ai-video-workbench/backups/pre-mineral-v2-20260715-174646.tar.gz`，SHA256 `9a787a9da3d08331b9fc3bb690bd4da7bd42ceb6118a25f61f7735f9b877c4a2`。
- 回滚 tag：`niannian-ai-video-workbench-app:rollback-mineral-v2-20260715-174646`，image ID `sha256:65d1208fa70284d4825bb7649262ebf6894aa30840e198568352d5f181d1c25e`。
- V2 Docker build：34 个 Next.js 路由编译、类型检查和静态生成通过。
- V2 app image：`sha256:cd449c220e893480385450f404bffb7a556cf9ab114d114a45edb0395d4e7319`。
- 切换命令只使用现有 project 对 app 执行 `--no-deps --force-recreate`；内置健康失败分支会把 latest 重新指向 rollback tag 并 recreate app。本次未触发回滚。
- 最终 app：`running/healthy`。

## 数据与服务不变证据

- 部署后计数、queue gate 和四项指纹与部署前逐项一致。
- PostgreSQL image：`sha256:57c72fd2...`，启动时间保持 `2026-07-11T14:47:18.18122013Z`。
- video-worker image：`sha256:fca8076e...`，启动时间保持 `2026-07-13T08:33:20.063282199Z`。
- 数据库和 video-worker 没有随 app 切换重启；没有执行迁移，没有重建或删除卷。
- 生产 release readback 仍为 `niannian-video-reference-contract-1.4.1-rc2`、参考合同 v2、Mac Worker 1.4.1、Skill bundle 1.2.1。

## 媒体与公网

- 容器内 V2 WebM SHA256：`6C67C5DEE20991BA1DF392DD3DDCA68C58A698A59BC8369622A5E348D1322DF1`。
- 容器内 V2 MP4 SHA256：`B8A078EBB3B32A64CF6A030C01C140A88FB18006AB33E2B833FFE7E17A5E3262`。
- 公网 WebM：HTTP 200、`video/webm`、840853 bytes、支持 byte range。
- 公网 MP4：HTTP 200、`video/mp4`、2311662 bytes、支持 byte range。
- `/`、`/login`、`/home`、`/projects`、`/showcase`、`/guide`、`/admin` 全部 HTTP 200。

## 生产浏览器证据

- 已登录生产 `/home` 实际加载 `workbench-mineral-flow-v2.webm`。
- `renderer=video`、`motion=flowing`、`videoWidth=1920`、`videoHeight=1200`、`duration=18`、`loop=true`、`paused=false`。
- 约 1.1 秒内播放位置从 `8.956821s` 前进到 `10.089774s`。
- 三栏均保持 `rgba(.58 → .42)` 半透明渐变与 `blur(8px) saturate(1.12)`。
- 桌面视差在右上读回 `3.25px/-3.00px`，回到中心后归零。
- “保存草稿”按钮唯一、enabled、`pointer-events:auto`，中心 hit-test 命中按钮；没有点击或写入生产草稿。
- 视频参考上传未禁用，七种参考意图完整。
- 390×844 下实际加载 V2 WebM，视频继续播放；视差为 `transform:none / transition:0s`；`scrollWidth=clientWidth=375`。
- 浏览器控制台 0 warning / 0 error。
- 桌面截图：`output/mineral-flow-v2/production-home-v2-desktop.png`；移动截图：`output/mineral-flow-v2/production-home-v2-mobile-390x844.png`。

## 停得过早与边界检查

- 没有把本地候选、Docker build 或 origin health 单独当作上线完成；继续取得了数据不变、公网媒体、已登录桌面/移动和回滚证据。
- 本次没有创建、重试或提交视频任务，没有上传素材，没有 provider/Mimo 操作，没有扣积分或产生费用。
- 没有修改数据库、数据卷、Mac Worker、video-worker、DNS、Nginx 或其他容器。
- 没有通过真实生产媒体错误来演练 PNG fallback，也没有修改用户系统偏好重新演练 reduced-motion；这些机制沿用已审查代码，不能表述为本轮生产故障注入已验证。
- 没有运行 Lighthouse 或 axe；背景文件在预算内且真实桌面/移动无溢出，但 Core Web Vitals 和自动无障碍仍是未验证项。
- `/tmp/niannian-mineral-v2-stage` 与上传的临时包已清理。

## 结论

状态：`production_deployed_and_verified`。工作台 V2 已完成 app-only 生产部署，并通过构建、健康、数据不变、媒体、公网页面、登录态桌面/移动、交互层级和回滚审查；本次不构成新的视频生成或交付闭环测试。
