# 念念 AI 视频工作台审计报告

审计时间：2026-07-14  
范围：`https://sd2.cauai.fun` 的公开表面、生产容器只读配置、Next.js/Node 代码、上传/任务/交付/Mac Worker 路径。  
方式：只读 HTTP 探测、只读生产容器配置读取、静态代码审计和本地自动测试。未登录或创建客户账号，未上传素材，未创建/重试/提交任务，未扣积分，未调用 Mimo，也未改动生产数据或部署。

## 摘要

生产站可用、TLS 入口与基础响应头存在，用户任务、下载和管理员接口都具备会话/归属或管理员校验；依赖扫描未发现已知生产依赖漏洞。

但当前不能称为“漏洞已清零”。最紧急的产品闭环问题是：工作台允许客户上传“视频参考”，而当前实际投入生产的 Mimo Safari 可见前端提交链路明确拒绝视频参考。其次，公开 API 仍泄露旧短剧/模型内部信息；服务端没有落实多参考上限和上传配额；认证限流使用可被反向代理链污染的 `X-Forwarded-For` 首地址。以下问题均有代码或线上响应证据。

## P0：客户功能合同不成立

### F-01 视频参考可以创建任务，但生产提交链路不能执行

- 证据：工作台公开将 `reference_video` 作为可选素材，见 [app/home/page.tsx](app/home/page.tsx:8) 和 [app/home/page.tsx](app/home/page.tsx:51)；API 也允许保存视频角色，见 [lib/video-tasks.ts](lib/video-tasks.ts:105) 与 [lib/video-tasks.ts](lib/video-tasks.ts:156)。
- 实际执行端会把视频素材传为 `--video`，见 [mac-agent/niannian-mac-worker.mjs](mac-agent/niannian-mac-worker.mjs:653)。但实际生产使用的 Safari 可见前端提交器的测试明确规定视频参考应失败，错误为 `VIDEO_REFERENCE_UI_ROUTE_NOT_IMPLEMENTED`，见 [scripts/mimo-safari-visible-submit.test.mjs](scripts/mimo-safari-visible-submit.test.mjs:97)。
- 影响：客户按 UI 上传视频参考后可被扣积分并进入自动任务，随后在渠道提交处失败或进入人工兜底。这是“承诺的输入能力”与“可执行渠道能力”不一致，不是单纯的文案问题。
- 最小修复：在正式支持前，服务端创建任务前必须拒绝/隔离 `reference_video`，或将其显式路由到已验证支持视频参考的渠道；不能仅依赖前端隐藏上传入口。为这两种路径各补一条端到端测试。

### F-02 12 份参考上限只在浏览器，API 可绕过并让 Mac 下载全部素材

- 证据：前端只在当前页面状态中限制 12 份，见 [app/home/page.tsx](app/home/page.tsx:178)。服务端 `createVideoTask` 会加载请求提供的全部 `assetIds`，未检查数量，见 [lib/video-tasks.ts](lib/video-tasks.ts:193) 和 [lib/video-tasks.ts](lib/video-tasks.ts:275)。
- Mimo 计划虽然只选前 12 份，见 [lib/video-tasks.ts](lib/video-tasks.ts:234)，但任务规格仍保留全部参考；Mac 父进程在暂存阶段逐一下载 `task.references`，见 [mac-agent/niannian-mac-worker.mjs](mac-agent/niannian-mac-worker.mjs:389)。
- 影响：已登录用户可直接调用 API 创建超过渠道验证上限的任务，造成无效上传、Mac 端下载放大、内存/磁盘消耗和客户结果不可预期。
- 最小修复：在 `/api/video-tasks` 和 `createVideoTask` 双层拒绝超过 12 个去重素材 ID；对历史任务保持可读，执行时明确只取锁定选择列表。补充 API 级越限测试。

## 中风险安全与可靠性问题

### S-01 认证与验证码限流依赖可被代理链污染的首个 `X-Forwarded-For`

- 证据：应用把 `X-Forwarded-For` 的第一个值直接作为 IP，见 [lib/auth.ts](lib/auth.ts:462)。限流键使用该值，见 [lib/auth.ts](lib/auth.ts:648)、[lib/auth.ts](lib/auth.ts:699) 和 [lib/auth.ts](lib/auth.ts:754)。
- 反向代理配置使用 `$proxy_add_x_forwarded_for`，会把已有头拼接后再传给应用，见 [deploy/nginx/sd2.cauai.fun.conf](deploy/nginx/sd2.cauai.fun.conf:13)。因此一旦 Cloudflare 保留客户提供的该头，攻击者就能每次更换伪造首地址，规避登录、注册、重置和重发验证码的按 IP 限制。
- 线上验证状态：代码和部署配置已确认；未用真实账号触发邮件/登录流去做破坏性利用验证，因此按“高可信条件风险”处理。
- 最小修复：在 Nginx 只信任 Cloudflare 的真实客户端地址链，或向应用传递一个由反代覆盖而非追加的受信 IP 头；应用只读取该受信头。修复后用无状态测试验证伪造 `X-Forwarded-For` 不会改变限流身份。

### S-02 上传限制发生在请求完全解析和整块读入之后，且没有账户级配额

- 证据：Nginx 允许 110MB 请求，见 [deploy/nginx/sd2.cauai.fun.conf](deploy/nginx/sd2.cauai.fun.conf:6)。资产路由先 `request.formData()`，见 [app/api/assets/route.ts](app/api/assets/route.ts:12)；随后又 `file.arrayBuffer()` 将整份文件放入内存，见 [lib/video-tasks.ts](lib/video-tasks.ts:156)，才检查 100MB 上限，见 [lib/video-tasks.ts](lib/video-tasks.ts:160)。
- 同时没有用户级总素材容量、每日上传次数或未被任务引用素材的回收策略。
- 影响：任一已登录账号可连续上传大量接近上限的文件，压力先落在 Node 内存，再落在共享 `niannian-data` 卷；任务创建失败时已上传素材也会残留。
- 最小修复：在反代设置更小的实际产品上限；在应用入口按 `Content-Length` 拒绝明显超限请求、改用受控流式写入/临时文件、引入每用户总容量和垃圾回收；任务创建失败或用户取消时清理未引用素材。

### S-03 上传类型仅信任浏览器声明的 MIME 与文件名后缀

- 证据：类型判断仅使用 `file.type.startsWith(...)`，见 [lib/video-tasks.ts](lib/video-tasks.ts:156)；保存后缀优先使用用户给定文件名，见 [lib/video-tasks.ts](lib/video-tasks.ts:76)。没有魔数、图像解码或视频容器验证。
- 影响：认证用户可把非媒体内容伪装为图片/视频保存并传递给 Mac/Mimo/ffprobe 路径，增加解析器故障和存储滥用面。
- 最小修复：服务端读取有限头部验证图像魔数、视频容器；把存储后缀映射为已验证类型；对无法验证的文件在写入最终目录前拒绝。保留当前哈希校验作为完整性控制。

### S-04 公共接口泄露已废弃的内部短剧与模型配置语义

- 线上证据：匿名访问 `GET /api/workflow` 与 `GET /api/providers` 都返回 HTTP 200。前者返回旧短剧工作流、虚构角色、`video_task_spec`、授权门和渠道状态；后者返回模型/环境变量名与配置布尔值。
- 对应代码： [app/api/workflow/route.ts](app/api/workflow/route.ts:4)、[app/api/providers/route.ts](app/api/providers/route.ts:4)；泄露内容定义在 [lib/demo-data.ts](lib/demo-data.ts:3) 和 [lib/provider-contract.ts](lib/provider-contract.ts:38)。
- 影响：不会直接泄露密钥，但违背“普通用户不应看到短剧、Seedance、模型、内部策略”的边界，暴露技术栈与旧演示信息，并损害商业测试版可信度。
- 最小修复：下线这两个不再使用的公开路由，返回 404；若管理员确实需要配置视图，应移动到管理员鉴权 API，并移除环境变量名回显。

### S-05 生产 App 容器以 root 运行且没有只读根文件系统/降权能力

- 生产只读检查证实：App 容器 UID 为 `0`，`ReadonlyRootfs=false`，`CapDrop=null`。
- 相关镜像没有 `USER` 指令，见 [Dockerfile](Dockerfile:10)。
- 影响：当前没有发现可直接利用的远程代码执行漏洞，但一旦 Node、媒体解析或依赖链被攻破，容器内的可写范围、数据卷和运行时凭据暴露面会比必要范围大。
- 最小修复：使用非 root 用户运行 App/Worker；仅保留 `/app/data` 必要可写卷；评估 `read_only`、`tmpfs`、`cap_drop: [ALL]` 和最小网络权限。该项必须先在本地/预发验证，避免破坏上传与 ffprobe。

### S-06 本地工作区存在明文运行凭据文件

- 证据：`.gitignore` 能避免提交 `.env*`，但当前工作区内仍有本地 dotenv 文件，其中包含实际格式的数据库、邮件和会话运行凭据。
- 影响：这不是公开站点直接暴露，但开发机、备份、压缩包或误共享一旦泄露，可能影响认证、邮件、数据库或部署。如果这些值与生产复用，影响会扩大。
- 最小修复：立即确认这些凭据是否与生产复用；若复用，轮换认证/邮件/数据库凭据。将本地凭据迁至系统凭据库或部署密钥管理，不把真实 dotenv 放在工作区长期保存。

## 低风险硬化项

### S-07 CSRF 校验把缺失 `Origin` 当作允许

- 证据：[lib/auth.ts](lib/auth.ts:466) 在 `Origin` 缺失时返回 `true`。
- 当前判断：生产会话 Cookie 已验证为 `Secure=true`，并使用 `SameSite=Lax`，见 [app/api/auth/login/route.ts](app/api/auth/login/route.ts:14)。在现状下，典型跨站 POST 不会自动携带该 Cookie，因此未确认可利用的 CSRF。
- 建议：对所有 Cookie 驱动的状态变更请求要求正确 Origin；为必须支持的无 Origin 场景单独设计 CSRF token，不要将“缺失”默认视为可信。

## 已验证的正向控制

- 生产 `sd2.cauai.fun` 正常返回 HTTPS、CSP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy` 和权限策略；未观察到 Cookie 或敏感响应泄露。
- 生产会话 Cookie 的 `Secure` 配置为 `true`，应用 origin 为 `https://sd2.cauai.fun`。
- 任务读取与下载按用户归属校验，见 [lib/video-tasks.ts](lib/video-tasks.ts:404) 与 [app/api/video-tasks/[id]/download/route.ts](app/api/video-tasks/[id]/download/route.ts:41)；下载路径还校验在任务下载根目录内，见同文件 [line 52](app/api/video-tasks/[id]/download/route.ts:52)。
- 管理员接口校验会话和管理员邮箱，见 [app/api/admin/overview/route.ts](app/api/admin/overview/route.ts:8)；Mac 内部接口使用恒定时间 Bearer token 比较，见 [lib/mac-codex-worker.ts](lib/mac-codex-worker.ts:152)。
- `npm audit --omit=dev --json`：生产依赖 0 个已知漏洞。
- 本地通过：类型检查、视频 Worker 9 项、Mac Worker 4 项、Mimo direct 2 项、Mimo official 1 项、Safari 可见提交 2 项、交付路由集成、发布候选 6 项，以及生产构建。

## 未验证项与测试缺口

- 浏览器自动化运行时无法连接，因此没有把本轮三栏布局的真实点击、不同屏宽和无横向滚动作为自动化通过项；用户人工页面验收仍需保留。
- 生产反向代理没有在本轮做真实客户 IP/伪造 XFF 的写操作验证；S-01 的最终可利用性取决于 Cloudflare 到 Nginx 的具体头传递行为。
- 手工任务全链路集成测试在现有本地 3026 服务的兑换密钥环境不匹配时失败，报 `LDXP_PAYMENT_CHANNEL_UNAVAILABLE`；这不是生产支付失败证据，但说明该测试当前不能直接复现，需用独立测试服务器和仅测试密钥运行。
- 未对真实客户素材或真实 Mimo 任务执行任何检查，避免新增费用和数据处理。

## 建议修复顺序

1. 先处理 F-01：关闭或正确实现视频参考的生产执行路径。
2. 服务端强制 12 参考上限、上传配额与媒体真实类型验证。
3. 修复反代受信客户端 IP 链，再回归登录、OTP 和注册限流。
4. 下线 `/api/workflow`、`/api/providers`，然后补匿名 API 回归测试。
5. 做容器最小权限和本地凭据轮换，不与功能修复混在同一次未经验证的生产部署里。
