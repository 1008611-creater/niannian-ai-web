# 念念 AI 工作台背景候选复审：Nocturne

## 设计判断

- 页面：面向付费视频客户的深色生产工作台。
- 语言：电影级夜色材质、克制品牌光、内容优先。
- 参数：`视觉变化 4 / 动效 3 / 信息密度 7`。
- 禁止：AI 紫色渐变、紫粉婚庆色、发光丝带、金色轨迹、星尘、闪粉、光球、银河、霓虹和依赖高透明卡片展示壁纸。

## 生成候选

### A：烟熏黑漆与树脂

- 提示词：`prompts/workbench-luxury-nocturne-a-smoked-lacquer.txt`
- 状态：provider 查询阶段远端断连，未取得 task ID 和本地结果。
- 处理：没有重复提交 A；保守按可能产生 `0.1` 第三方费用记录。

### B：深夜丝绒空间

- RH task ID：`2077123240400392193`
- 费用：`thirdPartyConsumeMoney=0.1`
- 产物：`public/media/generated/workbench-luxury-nocturne-b-rh/workbench-luxury-nocturne-b-velvet-stage.png`
- SHA256：`EBC15088A68F92DAB5568FD3EE29DAD1E125943B9EFA33803EAEDE45D1AFDC32`
- 结论：材质干净，但在工作台语境中过于接近普通暗色光带；保留为未采用候选，不接入 CSS。

### C：黑曜石与深色珍珠母贝

- RH task ID：`2077123708065296386`
- 费用：`thirdPartyConsumeMoney=0.1`
- 产物：`public/media/generated/workbench-luxury-nocturne-c-rh/workbench-luxury-nocturne-c-obsidian-pearl.png`
- SHA256：`C77412C63E88E351F38162F1BF98B19F0915C310134A13D1C2C072B155286D27`
- 结论：进入本地候选。黑曜石暗部、冷紫矿物虹彩和低饱和古铜反光形成真实材质层次，没有壁纸式装饰。

本轮已确认费用为 `0.2`；A 是否实际接受未知，因此总费用保守按最高 `0.3` 记录。

## 本地集成

- 活动 CSS：`app/globals.css`
- 图片透明度：`0.9`
- 色彩处理：`saturate(.86) contrast(.98) brightness(.92)`
- 卡片：三栏主表面使用 `rgba(.58 → .42)` 的深色渐变和 8px 背景模糊，让黑曜石纹理与流动真实可见；输入、上传和参数控件继续使用更深的局部承托。
- 顶部导航：`rgba(12,13,16,.76)`，20px 背景模糊；输入、上传和固定参数表面使用约 `.62` 的深色透明度，形成清晰的三层材质深度。
- 动效：底图与矿物反光双层低幅度流动，只表达材质内部的缓慢折射，不移动卡片、文字、表单或视频。
- 桌面证据：`output/playwright/nocturne-mineral-flow-desktop.png`
- 移动证据：`output/playwright/nocturne-mineral-flow-mobile.png`
- 录屏证据：`output/playwright/nocturne-mineral-flow.webm`

## 动效体验合同

- 体验目标：让黑曜石和深色珍珠母贝产生内部流动感，同时保持创建任务为唯一视觉主动作。
- 视觉方向：黑曜石暗部、冷紫矿物虹彩、极少量低饱和古铜反光；禁止粒子、星尘、金色轨迹和紫粉霓虹。
- 触发：页面加载后自动开始并在页面可见期间持续循环；切到后台暂停解码，回到页面立即继续。
- 制作技术：同一张原始黑曜石纹理仅在本地离线运行一次 WebGL UV 形变，四组波形锁定为严格 18 秒闭环；该实时着色器不进入最终网站运行时。
- 网站技术：`MineralFlowBackground` 只播放预渲染的 18 秒无声循环视频，优先 WebM/VP9，并提供 MP4/H.264 兼容源；不移动卡片或交互 UI。
- 桌面与移动：统一由浏览器硬件视频解码，`object-fit: cover` 保持构图；移动端不运行额外 Canvas 或着色器。
- 减少动态：`prefers-reduced-motion: reduce` 下暂停视频、归零时间并隐藏视频，显示原始静态黑曜石背景。
- 回退：视频加载或自动播放失败时设置 `data-renderer=css-fallback`，隐藏视频并回到原 CSS/静态背景，不出现空白背景。
- 生命周期：页面隐藏时暂停播放，页面恢复后继续；组件卸载时暂停并移除全部媒体和偏好监听器。
- 性能预算：light；WebM 约 `415KB`，MP4 约 `646KB`，1024×640、30fps、无音频，不在用户设备逐像素计算形变。
- 失败条件：文字对比下降、边缘露底、出现横向滚动、表单无法点击、移动端明显掉帧，或观感变成整张壁纸晃动。

## 本地验收

- `npm run build`：通过，34 个路由生成成功。
- `npm run lint`：通过。
- 1440px：工作台三栏完整，`scrollWidth=1440`，无横向溢出。
- 390px：`viewport=390 / scrollWidth=390 / bodyScrollWidth=390`。
- 浏览器控制台：0 errors / 0 warnings。
- 原生表单、上传入口、按钮和空状态可读；背景未覆盖交互层。
- 半透明 UI 证据：`output/playwright/nocturne-translucent-ui-desktop.png` 与 `output/playwright/nocturne-translucent-ui-mobile.png`。
- 三栏透明 UI 计算样式：三个主卡片均为 `linear-gradient(155deg, rgba(24,25,30,.58), rgba(12,13,16,.42))`，边框透明度 `.21`，背景模糊 `8px`。
- 三栏透明证据：`output/playwright/nocturne-three-column-transparency-desktop.png` 与 `output/playwright/nocturne-three-column-transparency-mobile.png`。
- 动画运行证据：10 秒间隔读取的底图与光层 `transform` 均发生变化；动画名分别为 `workbench-mineral-flow` 与 `workbench-mineral-light-flow`。
- 交互证据：动效运行期间“保存草稿”按钮可点击，页面返回“草稿已保存在当前浏览器”。
- 减少动态证据：模拟 `reducedMotion=reduce` 后两个伪元素的 `animation-name` 均为 `none`。
- 离线 WebGL 证据：制作阶段相隔 6 秒的 `mineral-webgl-flow-frame-a.png` 与 `mineral-webgl-flow-frame-b.png` SHA256 不同，证明源材质发生真实形变而非图片平移。
- 无缝循环证据：循环视频首尾相隔一帧的 SSIM 为 `0.963725`；视频为严格 18 秒、30fps。
- 网站连续播放证据：独立浏览器与用户当前内置浏览器均返回 `data-renderer=video`、`data-motion=flowing`、`duration=18`、`loop=true`、`paused=false`。
- 跨边界证据：测试从 `currentTime=17.65` 开始，约 0.9 秒后读回 `currentTime=0.484` 且仍为 `paused=false`。
- 减少动态证据：模拟偏好后视频为 `currentTime=0`、`paused=true`、`display=none`。
- 视频素材：`public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-loop.webm` 与 `.mp4`。
- 桌面证据：`output/playwright/mineral-video-loop-desktop.png`。
- 移动证据：`output/playwright/mineral-video-loop-mobile.png`，页面 `clientWidth=scrollWidth=390`。

## Provider 执行器纠正

`runninghub_image2_text.py` 已增加两项可靠性保护：

1. provider submit 返回后立即 `flush` 输出 task ID，不等轮询结束。
2. 查询阶段的远端断连、超时和临时网络错误只重试 query，不重新 submit。

B、C 两次实际任务已证明提交回执会在最终结果前输出，并且完成后下载对应产物。

## 边界

- 当前状态：`production_visual_deployed_and_readonly_verified`。
- 已按用户授权部署到 `https://sd2.cauai.fun`；本次只切换网站 `app`，没有迁移或修改数据库，没有重启 PostgreSQL、video-worker 或 Mac Worker。
- 未修改视频任务、Mac Worker、Mimo、积分、数据库或用户数据。
- 本次没有创建、重试或提交视频任务，没有上传客户素材，没有触发 Mimo/provider 费用。

## 生产部署与只读验收

- 部署包：`output/niannian-workbench-mineral-ui-20260715.tar.gz`，SHA256 `D1125F9778C5F5A8AF0A8033EF7FC1B3FF2F9B8149E29F975264ED79129ACC33`；包内严格为 6 个视觉文件。
- 切换后 app image：`sha256:65d1208fa70284d4825bb7649262ebf6894aa30840e198568352d5f181d1c25e`，状态 `healthy`。
- 部署前备份：`/opt/niannian-ai-video-workbench/backups/pre-mineral-ui-20260715-142752.tar.gz`，SHA256 `8aaf3ff27d6795da68d4704bac8749f1a818c9244ab486c191af952ae5204dcf`。
- 回滚 image：`niannian-ai-video-workbench-app:rollback-mineral-20260715-142752`，image ID `sha256:7b41d674cc20a7e69c22a79ff9c4173d277b302b2e34f25907404b49b63ddff7`。
- PostgreSQL 启动时间保持 `2026-07-11T14:47:18.18122013Z`；video-worker 启动时间保持 `2026-07-13T08:33:20.063282199Z`，证明二者未随视觉切换重启。
- 部署后兼容快照：用户 `5`、任务 `6`、素材 `6`、事件 `853`、积分账户 `5`、账本 `7`、参考元数据 `4`；`approvedForExecution=0`、`runningOnMac=0`。
- 部署后指纹：任务 `86b64d77066047a0015669323f3698c82f96320ca1e705277743205b3fd7b0c4`；素材 `7add6befeeefcb5d422954304a13ba958776c1fae0bf52a35e795d938daa89a8`；积分 `1d096a135de29e3d776633f6819567fa6dad78316661a346d362a889796e32ef`；账本 `f2114314de312023f28fbaacfa49d561d3d3c97a36ca05b76b28b29a2637a11c`，与部署前一致。
- 公开路由 `/`、`/login`、`/home`、`/projects`、`/showcase`、`/guide`、`/admin` 均返回 HTTP 200；WebM、MP4、PNG 均返回正确 MIME、Content-Length 与 byte range。
- 已登录生产页面读回：`data-renderer=video`、`data-motion=flowing`、`duration=18`、`loop=true`、`paused=false`，约 0.9 秒内播放时间从 `2.713` 前进到 `3.651`。
- 生产三栏计算样式均为 `linear-gradient(155deg, rgba(24,25,30,.58), rgba(12,13,16,.42))` 与 `blur(8px) saturate(1.12)`；视频参考上传未禁用，七种参考意图完整。
- 生产桌面证据：`output/production-home-mineral-ui-20260715.png`；生产 390×844 证据：`output/production-home-mineral-ui-390x844-20260715.png`。
- 390px 测试为 `scrollWidth=clientWidth=375`（浏览器内容区扣除滚动条/边框后的实际宽度），没有横向溢出；背景视频继续循环播放。
