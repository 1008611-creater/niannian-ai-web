# 工作台矿物流动背景 V2 体验合同

## Product

- Project and page scope: 念念 AI 视频工作台 `/home` 背景层；不修改表单、任务、积分、管理员或 Worker。
- Audience: 在桌面和移动浏览器创建视频任务的付费测试客户。
- Primary business/user goal: 用户稳定完成素材上传和任务创建，背景只负责建立高品质、可信赖的制作氛围。
- Primary CTA and success evidence: “创建视频任务”始终是唯一主动作；背景不得遮挡、抢焦点或增加操作等待。
- Stack/source repository: Next.js 15 App Router，现有代码仓库为唯一运行时来源。

## Visual Direction

- First impression: 深色黑曜石与珍珠母贝的内部折射，电影级、克制、安静，不像活动页或 AI 霓虹壁纸。
- Visual protagonist: 三栏真实工作台与中栏预览约占 85% 视觉权重；背景材质约占 15%。
- Secondary information: 冷紫矿物虹彩和极少量低饱和古铜反光，只在局部缓慢变化。
- Material and media role: 单个预渲染无声循环视频作为有界背景媒体；真实 HTML/React 表单与按钮保持不变。
- Explicitly avoid: 紫粉婚庆渐变、金色轨迹、粒子、星尘、光球、霓虹、发光丝带、整张壁纸平移、60fps 实时 shader。

## Information Hierarchy

| Section | User question answered | Primary content | CTA/state | Priority |
|---|---|---|---|---|
| 制作 | 我要上传什么、怎样创建 | 描述、素材、参数、积分 | 创建任务 | P0 |
| 预览 | 当前选择或成片是什么 | 空状态或结果视频 | 原生视频控制 | P0 |
| 历史记录 | 最近任务怎样 | 状态、摘要、时间 | 选择任务 | P1 |
| 背景 | 这是怎样的产品氛围 | 黑曜石内部流动 | 无交互 | P2 |

## Motion Budget

- Level: guided/light runtime；heavy 计算只允许在离线制作阶段。
- Why motion is needed: 让背景拥有真实材质厚度与持续生命感，同时保持内容优先。
- Shared behavior: 桌面与移动播放同一周期媒体；移动端只改变裁切，不运行额外 shader。
- Reduced-motion behavior: 暂停、归零并隐藏视频，显示静态 PNG。

## Motion Inventory

| Area | Purpose | Trigger | Initial → end | Timing | Technique | Cleanup | Mobile/reduced fallback | Failure to avoid |
|---|---|---|---|---|---|---|---|---|
| 矿物背景 | 建立材质氛围 | 页面可见 | 周期相位 0 → 1 → 0 | 18 秒、30fps、线性循环 | 离线周期性流场＋法线折射，网站 HTML5 video | 组件卸载暂停并移除监听 | 同视频；减少动态为 PNG | 壁纸平移、接缝闪跳、掉帧 |
| 可选视差 | 增加空间深度 | pointer move | 中心 → 最大 4px → 中心 | 500–900ms 平滑追随 | CSS transform，仅桌面精确指针 | pointer 离开复位 | 移动/减少动态禁用 | 抢焦点、眩晕、误触 |

## Asset Registry

| Asset | State | Format/spec | Used by | Source/rights | Fallback |
|---|---|---|---|---|---|
| 黑曜石原图 | existing/user-approved | PNG 生产背景源 | 离线渲染与静态回退 | 当前已部署、用户认可 | 纯深色 CSS |
| V2 主循环 | local candidate | WebM/VP9，1920×1200，30fps，18s | Chromium/Firefox/Edge | 从认可源离线生成 | MP4 |
| V2 兼容循环 | local candidate | MP4/H.264，1920×1200，30fps，18s | Safari/内置浏览器 | 从认可源离线生成 | PNG |

## Performance And Accessibility

- Target: 常见桌面、375/390px 移动浏览器与移动端内置浏览器。
- Loading/fallback: WebM → MP4 → PNG；页面隐藏时暂停；首屏不依赖视频完成加载。
- Concurrency: 只允许一个背景视频解码器，不叠加透明视频或运行时 Canvas/WebGL。
- Keyboard/focus/touch: 背景 `aria-hidden`、`tabIndex=-1`、`pointer-events:none`，不进入焦点顺序。
- Route disposal: 卸载时暂停视频并释放 media/matchMedia/visibility/pointer 监听。
- Candidate budget: WebM 目标 ≤ 3.5MB，MP4 目标 ≤ 5MB；超过预算则保持当前 V1，不替换。

## Decisions

- Confirmed: 用户授权按该方案制作优化候选；允许以现有背景为源进行本地离线流场与折射渲染。
- Must not change: 表单、上传、参考意图、任务、积分、管理员、Worker、数据库和生产环境。
- Deployment: 本轮只形成并验证本地候选；生产替换需单独明确授权。

## Verification

- Desktop: 1440×900，三栏、背景变化、点击与无横向溢出。
- Mobile: 390×844，裁切、滚动、上传入口与无横向溢出。
- Reduced motion: 视频隐藏、暂停、归零，静态背景可见。
- Media: ffprobe 编码、尺寸、帧率、严格 18 秒；首尾相隔一帧 SSIM；文件大小预算。
- Runtime: `renderer=video`、`loop=true`、`paused=false`、时间前进；视频失败回退。
- Verified vs unverified: 仅在真实本地浏览器读回后标记候选通过；不把本地候选称为生产上线。

## Local Candidate Readback

- WebM/VP9：1920×1200、30fps、18 秒、840853 bytes，SHA256 `6C67C5DEE20991BA1DF392DD3DDCA68C58A698A59BC8369622A5E348D1322DF1`。
- MP4/H.264：1920×1200、30fps、18 秒、540 帧、2311662 bytes，SHA256 `B8A078EBB3B32A64CF6A030C01C140A88FB18006AB33E2B833FFE7E17A5E3262`。
- 循环相邻帧：第 0 帧与第 539 帧 SSIM `0.990834`；第 0 帧与第 180/360 帧 SSIM 分别为 `0.985448`、`0.985766`，证明中段有变化且循环边界连续。
- 浏览器桌面：实际加载 V2 WebM，`videoWidth=1920`、`videoHeight=1200`、`duration=18`、`paused=false`；1.1 秒内播放位置从 `3.189` 前进到 `4.323`。
- 桌面视差：指针靠近右上时 CSS 变量约为 `x=3.22px / y=-3.13px`，回到中心后归零。
- 移动端：390×844 下视差 `transform=none`、`transition=0s`，视频继续播放，`scrollWidth=clientWidth=375`。
- 交互：背景运行期间“保存草稿”按钮可点击，并出现“草稿已保存在当前浏览器”反馈；上传和七种视频参考意图保持不变。
- 控制台：0 warning / 0 error。
- 当前边界：`production_deployed_and_verified`。

## Production Deployment Readback

- 用户已明确确认部署；生产只更新 `app/globals.css`、`components/MineralFlowBackground.tsx` 和两份 V2 视频，没有部署本地 preview 构建脚本或渲染器。
- 活跃 app image：`sha256:cd449c220e893480385450f404bffb7a556cf9ab114d114a45edb0395d4e7319`，状态 `running/healthy`。
- 生产备份：`/opt/niannian-ai-video-workbench/backups/pre-mineral-v2-20260715-174646.tar.gz`，SHA256 `9a787a9da3d08331b9fc3bb690bd4da7bd42ceb6118a25f61f7735f9b877c4a2`。
- 回滚 tag：`niannian-ai-video-workbench-app:rollback-mineral-v2-20260715-174646`，指向 V1 image `sha256:65d1208fa70284d4825bb7649262ebf6894aa30840e198568352d5f181d1c25e`。
- 部署前后用户、任务、素材、事件、积分、账本、参考元数据计数一致；任务、素材、积分、账本四项指纹完全一致；`approvedForExecution=0`、`runningOnMac=0`。
- PostgreSQL 与 video-worker 的 image 和启动时间保持不变，证明没有随 V2 app 切换重启。
- 生产浏览器实际加载 V2 WebM；`videoWidth=1920`、`videoHeight=1200`、`duration=18`、`loop=true`、`paused=false`，约 1.1 秒内从 `8.957s` 前进到 `10.090s`。
- 生产桌面视差在右上约 `3.25px/-3.00px`，回中心归零；390×844 下 `transform=none`、`transition=0s`，`scrollWidth=clientWidth=375`。
- 生产控制台 0 warning / 0 error；V2 临时包与 staging 已从服务器 `/tmp` 清理。
