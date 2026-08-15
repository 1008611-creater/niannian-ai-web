# 念念AI Web

参考 `http://nas.mimo.fashion:5001/` 与其公开页面的视觉语言、入口结构制作的本地“念念AI视频工作台”。当前已具备真实邮箱注册登录、PostgreSQL 项目与任务持久化、素材上传、受保护的自动任务队列、客户成片交付、管理员控制台和后台执行器。渠道真实闭环仍待一条经本次成本授权的受控任务验证；不得以 UI、模拟测试或已退款任务宣称已完成成片交付。

## 本地运行

```powershell
npm install
npm run dev
```

打开 `http://localhost:3026`。

生产模式：

```powershell
npm run build
npm run start
```

认证本地演示（验证码仅写入本机服务日志）：

```powershell
npm run start:local
```

面向真实用户部署前，复制 `.env.example` 为部署环境变量，并配置 `AUTH_OTP_PEPPER`、`AUTH_SESSION_SECRET`、`DATABASE_URL` 与 SMTP 凭据。设置 `DATABASE_URL` 后认证自动使用 PostgreSQL；本地未设置时使用运行目录的 `data/niannian-auth.sqlite`。没有 SMTP 配置时生产模式会拒绝发送验证码，不会创建未验证账户。

容器化 PostgreSQL 部署已提供。先复制环境变量模板，再启动：

```powershell
Copy-Item .env.docker.example .env.docker.local
docker compose --env-file .env.docker.local up --build -d
```

现有 SQL.js 用户迁移到 PostgreSQL：

```powershell
npm run db:migrate:dry-run
docker compose --env-file .env.docker.local run --rm -v "${PWD}/data:/app/data:ro" app npm run db:migrate:sqlite-to-postgres
```

生产环境必须把 `AUTH_COOKIE_SECURE` 设置为 `true`，并把 `APP_ORIGIN` 设置为正式 HTTPS 域名。真实密钥保存在部署平台的秘密管理中，不要提交到版本库。

渠道 M 当前入口是 `https://fd.aancn.cn`。服务器诊断可通过 `MIMO_BASE_URL` 显式覆盖入口，并需要二选一的 `MIMO_TOKEN` 或 `MIMO_USERNAME`、`MIMO_PASSWORD`。新建客户 Mimo 任务由独立 Windows Mimo CDP Worker 领取；是否允许接单以该 Worker 上报的新鲜 production readiness 为准，服务器端 Mimo 诊断不能替代 Windows 本机浏览器登录、CDP、`ffprobe`、Skill 路由和工作目录检查。网站与 Windows Agent 之间使用专用 `MIMO_WINDOWS_AGENT_TOKEN`，该秘密只应存在于部署秘密管理和 Windows 安全环境中。历史 `mac_codex` 任务仍使用 `MAC_CODEX_AGENT_TOKEN`，但不会接管新 Mimo 任务。所有预检均为只读，不上传素材、不调用生成。不要把任何凭据写入仓库、镜像、任务规格、日志或客户侧接口。

## 页面

- `/`：官网首页
- `/projects`：项目管理
- `/showcase`：作品展示
- `/guide`：创作指引
- `/workspace/[id]`：与持久化项目绑定的制作工作台
- `/team`：成员、角色、项目分工与活动记录
- `/settings`：GPT-5.5、GPT-5.6、Seedance 2 服务端配置清单
- `/api/health`：本地健康检查
- `/api/providers`：逻辑模型能力和配置状态
- `/api/workflow`：转绘节点、权威账本和提交门禁
- `/api/team`：团队演示数据与持久化状态
- `/api/auth/register/start`：发送注册验证码
- `/api/auth/register/verify`：验证邮箱并创建账户
- `/api/auth/password-reset/start`：发送密码重置验证码
- `/api/auth/password-reset/verify`：验证并更新密码
- `/api/auth/password-reset/resend`：重新发送密码重置验证码
- `/api/auth/login`、`/api/auth/session`：登录、读取和注销会话
- `/home`：人物、商品、场景和动作素材上传，创建受保护的视频任务并在完成后预览、下载成片
- `/admin`：用户、任务、渠道、成本授权、自动执行器和审计记录
- `/api/credits`：用户积分余额、积分流水、报价和充值申请
- `/api/admin/overview`：管理员受保护的任务与运行状态接口
- `/api/internal/windows-mimo/claim`：Windows Mimo CDP Worker 领取已授权的渠道 M 任务
- `/api/internal/windows-mimo/heartbeat`：Windows Mimo Worker 心跳与 production readiness
- `/api/internal/windows-mimo/tasks/[id]/assets/[assetId]`：按任务授权下载并校验客户素材
- `/api/internal/windows-mimo/tasks/[id]/result`：回传渠道回执、成片与账本
- `/api/internal/mac-codex/*`：仅保留用于历史 `mac_codex` 任务的兼容接口

## 积分制内测 MVP

用户只购买一种视频制作服务，不需要选择自动或人工。系统默认通过 Windows Mimo CDP Worker 和渠道 M 自动执行；自动失败不会切换渠道或自动重试，不加价、不重复扣积分。当前 4-15 秒按每秒 4 积分报价（4 秒为 16 积分，5/10/15 秒仍为 20/40/60 积分）。服务端会在任务创建时原子保留积分；任务创建失败或管理员最终停止任务时只退款一次。Windows Worker 离线或未通过 production readiness 时任务保持 `queued_skill`，不会伪装成执行中。

积分固定按 `1 积分 = ¥0.10` 销售。用户在 LDXP（链动小铺）购买 `100 / 300 / 500 / 1000` 积分商品，平台付款后自动发放一次性签名兑换码；用户回到工作台粘贴兑换码，积分立即到账。兑换码由独立服务端密钥签名，数据库只保存哈希，且同一码只能兑换一次。四档商品现已发布到“念念AI积分”分类，每档首批 50 张卡密；真实支付、自动发码和到账仍须用一笔 ¥10 订单验收后才能宣称完整收款闭环通过。

管理员后台以运营待办为默认入口：服务端按任务最后更新时间计算紧急度、阶段 SLA、是否超时和下一步动作，并汇总紧急任务、超时任务、人工兜底、待质检、24 小时新用户和 24 小时 LDXP 兑换。任务列表每 30 秒刷新，仍沿用原有人工接单、成本授权、渠道登记、成片质检、交付和退款门禁。

根路由 `/` 是公开能力首页，不再把陌生访客直接重定向到登录。页面统一定位为“念念AI的视频生成基础能力”，明确展示适用场景、三步任务流程、4-15 秒价格、任务状态、结果下载与注册/进入工作台 CTA。人工兜底、渠道路由、成本授权和内部执行方式属于管理员策略，禁止出现在用户页面、公开元数据或对外营销文案中。没有得到公开授权的用户成片不得作为首页案例。

## 视频任务执行器

网站创建任务后会先写入 PostgreSQL 和统一 `video_task_spec.json`。执行器只领取同时满足 `submit_allowed=true` 与 `cost_gate.authorized=true` 的任务，未完成成本读回和管理员授权的任务不会启动真实渠道。

视频任务类型由服务端根据已确认素材推导：没有参考素材时创建 `text_to_video` 并锁定 `references=[]`；至少一张已确认人物、商品或场景图片时创建 `image_to_video`。`video_task_spec.json` 必须保存 `generation_type`，Windows Mimo Worker 对文生视频不得下载或上传参考素材，对图生视频仍按锁定 SHA 执行。

客户新建任务固定写为 `execution_mode=codex_skill`、`channel=mimo`、`status=queued_skill`，不自动切换到 Dola、Miora 或 Mac。用户确认锁定规格后才设置 `submit_allowed=true` 与 `cost_gate.authorized=true`；Mimo 余额和单价由运营人工盯盘，不作为确认硬门。只有持有 `MIMO_WINDOWS_AGENT_TOKEN` 的 Windows Mimo CDP Worker 可以领取任务；领取前，它必须上报未过期的 production readiness，证明 Windows 本机的可见浏览器/CDP、Mimo 已登录态、Skill 路由、工作目录和 `ffprobe` 都可用，claim API 会再次强制检查。Worker 不可用时任务保持队列状态，客户只看到“正在排队”。已有 `provider_task_id` 的提交不明任务只允许同步和下载，禁止再次点击生成。

Windows Mimo Agent 位于 `scripts/niannian-windows-mimo-agent.mjs`，候选包由 `npm run worker:mimo-windows:package` 构建。它只通过本机 loopback CDP 操作官方可见 Mimo 页面，并为每个已领取任务保存锁定输入 SHA、可见 Provider 回执、下载结果与账本。后台 Edge 和 Worker 使用 `AtStartup + S4U` 计划任务，不依赖 RDP 或交互式桌面；Mimo 凭据通过 `Set-NiannianMimoCredential.ps1` 写入 Windows DPAPI LocalMachine 加密文件并限制 ACL，登录态失效时由 Worker 在页面内自动登录。密码不进入命令行、日志、候选包或 heartbeat；验证码、风控页或登录失败会令 Worker `blocked` 且禁止 claim。完整安装入口是 `scripts/Install-NiannianMimoAgentTask.ps1`。`mac-agent/` 仅保留历史 `mac_codex` 兼容任务。

```powershell
npm run worker:mimo-windows:contract
npm run test:mimo-windows-visible-sync
npm run worker:mimo-windows:preflight
npm run worker:mimo-windows:package
```

`worker:mimo-windows:contract` 和 `test:mimo-windows-visible-sync` 不连接 Provider、不读取凭据、不上传、不提交也不修改任务状态。`worker:mimo-windows:preflight` 仅在 Windows 本机检查浏览器/CDP、登录态、`ffprobe`、工作目录和锁定 Skill 路由；它不领取任务。Windows 节点通过安全 API 写入 `data/mimo-windows-worker-state.json`。管理员后台的“渠道状态”页会显示新 Mimo Windows Worker 的配置、在线状态、当前任务、最近心跳与 readiness；Mac 卡仅表示历史兼容路径。

Windows Mimo 部署后的只读验收使用 `npm run release:postdeploy:readonly -- --origin https://sd2.cauai.fun --worker windows-mimo`。它只读取网站健康、公开页面与 Windows Worker 状态，要求运行环境提供 `MIMO_WINDOWS_AGENT_TOKEN`，并验证 release identity、Windows Worker readiness、已登录 Mimo 状态和空执行队列；不会 claim、上传或提交任务。

管理员可在“渠道状态”中执行渠道 M 预检。预检只从服务器环境变量临时读取渠道会话凭据，验证连通性、会话和当前额度读回；不会上传素材、创建任务或提交生成。预检结果仅供管理员查看，且不会记录 token、用户名或密码。

`test:manual-task:integration` 使用临时账户和证据用测试素材走通“素材上传 → 人工任务 → 管理员接单 → 非法目录/缺少 QA 拒绝 → 成片与账本验证 → 完成回写”，结束后自动清理测试用户、会话、任务、素材和输出，不调用任何真实视频渠道。

### 真实渠道回归

`scripts/run-real-mimo-app-task.mjs` 是一条受授权保护的真实渠道回归路径：它创建本地人工任务、读取 Mimo 额度、上传已确认的图片参考、提交一次真实生成、轮询下载、运行 `ffprobe` 并留下待内容 QA 的任务证据。它只从环境变量读取本地登录和 Mimo 凭据，命令行必须携带 `--authorized`，不会把密码、Cookie 或 token 写进任务账本。

渠道 M（Mimo）是客户新任务的默认执行渠道。客户任务默认进入 Windows Mimo `codex_skill` 队列；人工任务由管理员在后台接单后处理。当前客户自动制作固定为已验证的 `720P`，普通用户不会看到渠道名称、渠道任务 ID 或内部成本信息。Windows Worker 回传后，网站服务器会重新运行 `ffprobe` 和时长校验，但任务仍会停在“等待内容验收”；管理员确认人物、商品、场景和动作符合要求后，系统才会交付给客户。2026-07-11 的真实回归已使用 Mimo 完成 5 秒、1280x720、16:9 成片下载与人工证据帧 QA，并通过管理员完成门禁回写为 `completed`；该历史回归不等于 Windows Worker 已完成真实交付。

### Dola Skill 渠道

Dola 已作为 Windows Skill 渠道接入本视频工作台，不依赖“念念”主站。管理员可以在任务尚未进行成本授权、尚未产生渠道任务 ID 时，把统一视频任务从渠道 M 路由到 Dola。路由动作会把任务切换为 `codex_skill` 队列，并把以下固定链写入锁定任务规格：

```text
ai-video-production-router
-> sd2-video-generation
-> prompt-skill-router
-> ai-video-channel-router
-> dola-video-channel
```

`POST /api/admin/dola-preflight` 只通过本机 `Dola2API` 检查登录、代理地区、CDP 和两个扩展，不上传、不提交、不扣点。Dola 成本授权会强制重新执行该预检，并校验锁定任务中的渠道与 Skill 路由。Windows 执行器使用 `VIDEO_WORKER_MODES=codex_skill` 领取已同时满足 `submit_allowed=true` 与 `cost_gate.authorized=true` 的任务；没有授权的准备任务不会被领取。Dola 提示词禁止出现秒数；对白必须使用半角 `[ ]`，并以 `全程使用中国中文普通话对话，` 开头。

当前 Dola2API 的机器接口只声明 `preflight` 和 `prepare_route`，因此本次接入验证的是网站渠道路由、实时预检和授权后的 Skill 派发能力，不代表网站已经通过 Dola 完成新的真实成片交付。真实提交仍须逐任务成本读回和明确授权，并在下载、媒体探测、内容 QA 与账本都通过后才能交付。

服务器自动模式通过 `VIDEO_SERVER_DISPATCH_URL` 接入外部执行服务。请求包含 `submit` 或 `sync` 操作、选定渠道、任务 ID、已有渠道任务 ID 和完整任务规范；服务应返回：

```json
{
  "status": "running",
  "providerTaskId": "provider-task-id",
  "outputPath": null,
  "blocker": null,
  "summary": "已提交并进入生成队列",
  "mediaProbePassed": false,
  "contentQaPassed": false,
  "ledgerPath": null
}
```

Windows Mimo 自动交付只有在真实视频已下载、JSON ledger 合法、`ffprobe` 与时长校验通过、COS 上传及下载回读 SHA 校验通过后才能写入 `completed`；不再设置人工内容 QA 门。Docker 部署中的通用 `video-worker` 默认只处理 `server_auto`，并与网站共享 `/app/data`。

人工代做也不能绕过完成门禁。管理员只能对 `manual_in_progress` 的人工任务执行“验收并完成”，必须填写任务专属 `downloads` 视频路径与 `ledger` 账本路径、确认内容 QA；服务端会再次校验目录归属、文件存在、`ffprobe` 和时长容差。Mac/服务器自动任务只能由各自执行协议回写真实结果，管理员不能替 Mac 登记一个虚构的渠道任务或用任意路径直接标记成功。

## 模型接入边界

统一协议在 `lib/provider-contract.ts`，转绘权威链路在 `lib/shortdrama-contract.ts`。GPT-5.5/5.6 与 Seedance 2 当前是用户指定的逻辑别名，不假定未确认的接口格式。真实密钥不得写入前端；正式接入应通过服务端环境变量、已登录渠道 Skill 或独立执行服务器完成。

Seedance 2 真实提交默认禁止。必须同时满足 `video_task_spec`、参考资产确认、费用/配额回读和本次用户授权。
