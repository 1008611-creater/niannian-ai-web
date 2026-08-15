# 念念 AI 工作台黑曜石循环背景部署后审查

## 1. 请求结果与正确执行路径

用户要求把已经在本地认可的黑曜石流动背景和半透明三栏工作台部署到 `https://sd2.cauai.fun`。正确路径是：以当前生产 RC2 源为基线，只叠加视觉组件、CSS 和三份媒体；本地构建与浏览器验收；冻结六文件包与 SHA；部署前备份和数据指纹；只 recreate `app`；检查健康、媒体、页面、数据指纹与已登录浏览器；保留可用回滚入口；不触碰数据库、Worker、Mimo、积分或任务。

## 2. 实际变更

- `app/home/page.tsx`：仅嵌入并挂载 `MineralFlowBackground`。
- `app/globals.css`：仅追加工作台黑曜石背景、三栏半透明表面、媒体回退和减少动态样式。
- `components/MineralFlowBackground.tsx`：新增预渲染循环视频播放器；页面隐藏时暂停，恢复时继续；视频失败回到静态/CSS 背景；减少动态时暂停并归零。
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-luxury-nocturne-c-obsidian-pearl.png`。
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-loop.webm`。
- `public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-loop.mp4`。
- `DESIGN_CANDIDATE_REVIEW_NOCTURNE_20260715.md`：补充实际生产部署和只读证据。
- `output/production-home-mineral-ui-20260715.png`、`output/production-home-mineral-ui-390x844-20260715.png`：验收证据，不是生产素材。

## 3. 变更内容审查

- 该目录没有 Git 元数据，因此采用生产部署前备份与当前生产源直接 `diff`。
- `app/home/page.tsx` 的生产差异只有一条 import 和一个组件挂载，没有覆盖上传、任务、积分或参考合同逻辑。
- `app/globals.css` 的生产差异是文件末尾追加的视觉样式。
- 生产页面的可选视频参考上传保持启用，并保留七种参考意图：动作与表演、镜头语言、节奏、构图、动态表现、氛围、整体视频表达。
- 发布包严格包含上述六个生产文件；本地包 SHA256 为 `D1125F9778C5F5A8AF0A8033EF7FC1B3FF2F9B8149E29F975264ED79129ACC33`。
- 生产六文件与本地六文件 SHA256 逐一一致。

## 4. 媒体与运行时

- WebM：VP9、1024×640、30fps、18 秒、425013 bytes，SHA256 `914490C58C0FBDFD8401C0C2ECF287E2F6C0265E896DE9473F55E2E832CF43D3`。
- MP4：H.264、1024×640、30fps、18 秒、661123 bytes，SHA256 `D6A70C7A1C2839237D1877861D7F69A9378C915F1CC1DEB4E2CB29809E33C747`。
- PNG：7668046 bytes，SHA256 `C77412C63E88E351F38162F1BF98B19F0915C310134A13D1C2C072B155286D27`。
- 主路径使用浏览器视频解码；生产运行时没有 Canvas、WebGL 或 `requestAnimationFrame`。
- 本地已验证视频从 `17.65s` 跨循环边界回到约 `0.484s` 并继续播放；减少动态时 `currentTime=0`、`paused=true`、视频隐藏。

## 5. 自动验证

- `npm run lint`：通过。
- `npm run build`：通过，34 个路由生成成功。
- `ffprobe`：两种视频容器、编码、分辨率、帧率、时长和文件大小符合合同。
- 生产公开路由 `/`、`/login`、`/home`、`/projects`、`/showcase`、`/guide`、`/admin`：均为 HTTP 200。
- 生产媒体：WebM、MP4、PNG 均为 HTTP 200，MIME 和 Content-Length 正确，支持 byte range。

## 6. 生产浏览器验收

- 已登录生产 `/home` 读回 `data-renderer=video`、`data-motion=flowing`、`duration=18`、`loop=true`、`paused=false`。
- 约 0.9 秒内 `currentTime` 从 `2.713` 前进到 `3.651`，不是静态首帧。
- 三栏计算样式均为 `linear-gradient(155deg, rgba(24,25,30,.58), rgba(12,13,16,.42))`，`backdrop-filter=blur(8px) saturate(1.12)`。
- 桌面内容区 `scrollWidth=clientWidth`；390×844 测试内容区 `scrollWidth=clientWidth=375`，无横向溢出。
- 页面控制台没有 warning 或 error。

## 7. 生产基础设施与回滚

- 活跃 app image：`sha256:65d1208fa70284d4825bb7649262ebf6894aa30840e198568352d5f181d1c25e`，`running/healthy`。
- 部署前备份：`/opt/niannian-ai-video-workbench/backups/pre-mineral-ui-20260715-142752.tar.gz`，SHA256 `8aaf3ff27d6795da68d4704bac8749f1a818c9244ab486c191af952ae5204dcf`。
- 回滚 image：`niannian-ai-video-workbench-app:rollback-mineral-20260715-142752`，image ID `sha256:7b41d674cc20a7e69c22a79ff9c4173d277b302b2e34f25907404b49b63ddff7`。
- PostgreSQL image 与启动时间保持不变：`sha256:57c72f...`，`2026-07-11T14:47:18.18122013Z`。
- video-worker image 与启动时间保持不变：`sha256:fca807...`，`2026-07-13T08:33:20.063282199Z`。
- Compose 数据卷仍为 `niannian-ai-video-workbench_niannian-postgres` 和 `niannian-ai-video-workbench_niannian-data`。
- 远端 `/tmp/niannian-mineral-stage` 与 `/tmp/niannian-workbench-mineral-ui-20260715.tar.gz` 已清理。

## 8. 数据不变证据

- 部署后计数：用户 5、任务 6、素材 6、事件 853、积分账户 5、账本 7、参考元数据 4。
- 队列门：`approvedForExecution=0`、`runningOnMac=0`。
- 任务指纹：`86b64d77066047a0015669323f3698c82f96320ca1e705277743205b3fd7b0c4`。
- 素材指纹：`7add6befeeefcb5d422954304a13ba958776c1fae0bf52a35e795d938daa89a8`。
- 积分指纹：`1d096a135de29e3d776633f6819567fa6dad78316661a346d362a889796e32ef`。
- 账本指纹：`f2114314de312023f28fbaacfa49d561d3d3c97a36ca05b76b28b29a2637a11c`。
- 四项指纹与部署前相同；没有丢任务、素材、积分或账本，也没有重复 claim。

## 9. 停得过早与边界检查

- 本次最终产物是生产网站上的视觉更新，已取得生产页面、媒体、容器和数据只读证据，不是把本地候选或构建成功误报为上线。
- 本次不以视觉部署证明视频自动执行链路获得了新的成功；没有创建、重试、提交或扣费。
- 未修改数据库、数据卷、Mac Worker、video-worker、Mimo、任务、积分、DNS 或 Nginx。
- 未验证新的真实视频生成、provider 回执、下载、媒体/视觉 QA、退款或客户交付；这些仍沿用先前闭环证据，若要重测必须另行获得任务与成本授权。

## 10. 审查结论

状态：`production_visual_deployed_and_verified`。黑曜石循环背景与半透明三栏已部署并通过视觉、响应式、媒体、健康、数据不变和回滚审查；视频生成业务能力没有因本次视觉发布被扩大、重跑或重新宣称验证。
