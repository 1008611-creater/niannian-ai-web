# 念念 AI · Mac Codex 正式员工

这个目录不是另一个网站执行器。它是商业网站与 Mac 上 Codex 独立员工之间的受控交接客户端：领取已完成成本授权的任务、下载并校验客户素材、生成权威任务包、维持心跳、回传渠道状态、成片和产物账本。

## 生产技能包

Worker v1.2.0 不再只检查“Codex 命令存在”，而是在每次心跳和领取前验证 `skill-bundle/bundle-manifest.json`。首版技能包固定为：

```text
niannian-mac-production
ai-video-production-router
ai-video-channel-router
ai-video-fundamentals-skill
mimo-8001-video-channel
post-coding-review
```

网站当前自动任务只允许 `mimo`，清单必须把它映射到 `mimo-8001-video-channel`。安装器会逐文件校验 SHA-256、备份同名旧 Skill、安装到 `~/.codex/skills`，并把已安装清单写到 `~/.codex/niannian-skill-bundle.json`。缺清单、缺文件、文件被修改、Codex 登录文件无效、Worker 版本不足或渠道映射错误时，Worker 只上报 `blocked`，不会调用任务领取接口。

Windows 上游 Skill 更新后，先运行：

```bash
node skill-bundle/build-skill-bundle.mjs
npm run test:mac-skill-bundle
```

验证通过后再提高 `bundleVersion` 并发布到 Mac；不要直接同步 Windows 全量 Skills，也不要绕过 manifest 临时复制单个渠道 Skill。

## 安装

Mac 需要 Node.js 20 或更高版本。复制本目录后，把服务地址和专用 agent token 放入 Mac 的安全环境变量；不要把 token 写入仓库或任务文件。

```bash
export NIANNIAN_ORIGIN="https://sd2.cauai.fun"
export NIANNIAN_MAC_AGENT_TOKEN="与网站部署环境中的 MAC_CODEX_AGENT_TOKEN 相同"
export NIANNIAN_MAC_WORKER_ID="lsbmacbook-air-codex"
export NIANNIAN_MAC_WORKSPACE="$HOME/niannian-mac-worker"
```

正式安装可以把 token 仅在当前命令的环境中传给安装器。安装器会先校验并安装版本化技能包，再把 token 写入 macOS Keychain，把执行脚本装到 `~/Library/Application Support/NiannianMacWorker`，并创建每分钟检查一次任务的 LaunchAgent；plist、日志和任务文件中都不会保存 token。

```bash
chmod +x install-macos.sh
read -s "NIANNIAN_MAC_AGENT_TOKEN?请输入服务器中的专用 token："
export NIANNIAN_MAC_AGENT_TOKEN
./install-macos.sh
unset NIANNIAN_MAC_AGENT_TOKEN
```

从 Windows 运维端安装到已经解锁的 Mac 时，不要把 token 拼进 SSH 命令、plist 或临时文件。先创建权限为 `600` 的命名管道，再在 Mac 图形登录会话中运行 `install-macos-gui.command`，由运维端只向管道写入一次 token。GUI 入口会去掉 Windows CRLF 带来的尾部 `CR`，安装后立即删除管道；登录钥匙串条目只信任系统 `/usr/bin/security`，LaunchAgent 使用明确的登录钥匙串路径读取。

安装成功的验收条件是：

- `plutil -lint ~/Library/LaunchAgents/com.niannian.mac-codex-worker.plist` 通过；
- `launchctl print gui/$UID/com.niannian.mac-codex-worker` 最近退出码为 `0`；
- worker 日志出现 `{"ok":true,"task":null}` 或真实任务状态，而不是钥匙串错误或 `401`；
- 生产 `/api/internal/mac-codex/status` 返回 `version=1.1.0`、新鲜 heartbeat、`activeTaskId=null`（无待执行任务时）；
- token 管道和临时编排脚本均已删除。

## 正式操作路径

1. 管理员在网站后台读取成本并授权任务。
2. 正式自动执行使用下面的命令。它会领取一个任务、创建一个全新的 Codex 员工、执行任务并把回执上传给网站：

```bash
node niannian-mac-worker.mjs run-once
```

默认使用 Mac 上 Codex 自己的权限配置；不会在脚本里强行覆盖沙盒。需要指定现有 Codex 策略时，可设置 `NIANNIAN_CODEX_MODEL`、`NIANNIAN_CODEX_SANDBOX` 和 `NIANNIAN_CODEX_TIMEOUT_MS`。如果渠道仍在运行，父级工作器会保留 provider task ID 并让新的 Codex 员工只做同步、下载和 QA；轮询轮数与间隔可通过 `NIANNIAN_CODEX_MAX_CYCLES`、`NIANNIAN_CODEX_SYNC_DELAY_MS` 调整。

渠道 M 的认证、官方前端同构上传和生成提交由父级 Worker 的受控桥接执行。桥接只接受当前已领取、已获成本授权、参考路径和 SHA 均已校验、且尚无 `providerTaskId` 的任务；它会在第一次提交成功后立即持久化任务 ID。子 Codex 不读取 Keychain 或认证环境，也不会接收密码、token 或 cookie。

提交成功后，父级 Worker 默认等待 `60` 秒才开始第一次渠道状态轮询；之后按 Worker 同步周期持续读取同一渠道任务。等待期间只持续发送租约心跳，不会重复提交。运维可用 `NIANNIAN_MIMO_INITIAL_POLL_DELAY_MS` 在 `0-1800000` 毫秒范围内调整该窗口。

升级已安装的 LaunchAgent 时，必须从 Mac 的图形登录会话执行 `deploy-existing-macos-hotfix.sh`。macOS 不允许 SSH 会话接管 `gui/$UID` 的 LaunchAgent bootstrap；远程 SSH 只能做只读检查、文件传输和备份验证，不能替代图形会话重启。

需要人工检查任务包或交给已经打开的 Codex 独立员工时，才使用仅领取模式：

```bash
node niannian-mac-worker.mjs claim
```

3. 命令会创建任务目录。Codex 独立员工必须先读该目录中的 `INSTRUCTIONS.md` 和 `task.json`，只使用 `input/` 内已校验素材。
4. 渠道真实提交后，先把 `worker-result.json` 写成 `status=running` 并回报，以保存 provider task ID；不得重复提交。
5. 下载成片、媒体探测和账本完成后，把回执改成 `status=completed` 并执行：

```bash
node niannian-mac-worker.mjs report --result "/绝对路径/worker-result.json"
```

6. 网站服务器会再次执行媒体和时长检查。通过后任务只会进入 `awaiting_content_qa`，仍须管理员在后台检查内容后才能向客户交付。

Mac 在线但暂时不领取任务时，可写入健康心跳：

```bash
node niannian-mac-worker.mjs heartbeat
```

商业自动运行应由 macOS `launchd` 保持 `run-loop` 常驻。这个父级进程是 preflight、heartbeat、claim、租约恢复和回执上传的唯一权威；每个子 Codex 员工只执行已锁定任务，不得重新 claim 或重复 preflight。部署前仍必须先手工运行一次，确认 Mac 的 Codex 登录态、所需 Skills、渠道会话和环境权限都有效；没有完成这次真实验证前，不能把节点标记为生产在线。

## 安全边界

- Mac agent token 只通过 `Authorization: Bearer` 请求头传输。
- 客户原始素材仅在该任务已被 Mac 正式领取后可下载。
- 下载后逐文件校验 SHA-256。
- Windows/服务器执行器不会领取 `mac_codex` 类型任务。
- Mac 回传的视频不会直接成为客户成片；服务端媒体检查和管理员内容 QA 都必须通过。
- `submitted`、`downloaded`、`awaiting_content_qa` 和 `completed` 是不同状态。
- 本协议不授权本地修图，不把任务说明、截图或测试文件当作生产产物。
