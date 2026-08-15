# 念念 AI 视频工作台 1.4.1 RC2 部署与回滚运行手册

本手册只准备步骤。当前任务不得执行生产部署、Mac 安装或 Mimo 提交。

## 入口与版本

- 生产域名：`https://sd2.cauai.fun`
- SSH 别名：`tencent-niannian`
- 服务目录：`/opt/niannian-ai-video-workbench`
- Nginx origin：`127.0.0.1:18084`
- 网站/Worker/Skill：`2026.07.13-rc2` / `1.4.1` / `1.2.1`
- 数据卷：`niannian-ai-video-workbench_niannian-postgres`、`niannian-ai-video-workbench_niannian-data`

## 发布前硬门

1. 已保存用户的完整授权原文，且与 `RELEASE_AUTHORIZATION_PACKAGE_20260713.md` 一致。
2. `npm run release:audit` 通过，发布产物 SHA 与 manifest 一致。
3. 在能同时访问生产 PostgreSQL 和 `/app/data` 任务规格路径的 app 容器内执行 `npm run release:compat:readonly -- --output <受控路径>`；结果必须满足 `approved_for_execution = 0` 和 `running_on_mac = 0`。不能只在远端 Windows 本地连数据库，因为容器内 `task_spec_path` 在宿主机上并非同一路径。
4. 管理后台与 Worker 状态不得出现 active task、provider task ID 或未到期租约。
5. 当前生产已知基线：网站 app image `sha256:882ddb1bfe2c08a098327c736765d1f86b47640df50e870cb102d10b96e2faed`；video-worker image `sha256:fca8076e00b19ec885a201239a5ad9b9c1288779a6f29dec7cef006b73dcff83`；旧 Worker `1.3.0` 最近只读心跳为 idle、readyToClaim、无 active task。部署时必须重新读取，不能用本文旧值替代现场证据。

任一门不满足即停止。不得手工 SQL 复位任务，不得强制 claim。

## 备份顺序

1. 在 Mac 上先 `launchctl bootout gui/$UID/com.niannian.mac-codex-worker`，确认进程停止。
2. 服务器创建带时间戳的源代码归档、PostgreSQL 一致性 dump 和 `niannian-data` 数据卷归档；记录 SHA256、容器 image ID 和 compose 配置摘要。
3. 已验证的历史源代码回滚入口为 `/opt/niannian-ai-video-workbench/backups/commercial-test-csp-20260712-003020.tar.gz`，SHA256 为 `4f12da991e1dd7a990522865a2ff193d6ef2e7cba095e05ee5906165d7ef96d3`。它不包含数据库和数据卷，不能替代本次新备份。
4. Mac 执行发布包内 `backup-before-upgrade.sh`，保存返回的 `ROLLBACK_DIR`；校验其中 `SHA256SUMS.txt`、旧 bin、LaunchAgent、bundle manifest 和六项 allowlisted Skills。凭据和 `auth.json` 不进入备份。

## 原子部署顺序

1. 上传并复核网站与 Mac 两个 tar.gz 的 SHA；展开到新的 staging 目录，不覆盖当前目录。
2. 从 staging 构建新 app image，旧 app 保持在线。所有 Compose 命令必须显式使用现有 project 名 `-p niannian-ai-video-workbench`，并在切换前确认解析到的卷仍是 `niannian-ai-video-workbench_niannian-postgres` 与 `niannian-ai-video-workbench_niannian-data`；不得让 staging 目录名隐式创建新卷。
3. 运行幂等附加迁移 `deploy/migrations/20260713_asset_reference_metadata.sql`。禁止执行 DROP、ALTER、UPDATE、DELETE、TRUNCATE。
4. 再次执行生产兼容快照，与部署前 fingerprints 比较；若任务、素材、积分或账本变化不符合已知用户动作，停止。
5. 仅切换/recreate `app`，不重建 PostgreSQL、不删除 Docker 数据卷、不重启无关容器。预计网站中断 `15-60 秒`。
6. 验证 `/api/health`、公开页面和数据库读路径。失败则立即回滚网站，Mac 仍保持停止。
7. 在 Mac 安装 Worker `1.4.1` 与 Skill bundle `1.2.1`，预计 Worker 暂停总计 `5-15 分钟`。
8. 先执行 preflight/heartbeat，只读确认后才启动 `run-loop`。禁止子 Codex 运行父级 preflight、heartbeat、claim 或 run-once。
9. 运行下述只读验收；不创建真实任务、不提交 Mimo。

## 部署后只读验收

API/Worker：

```powershell
npm run release:postdeploy:readonly -- --origin https://sd2.cauai.fun
```

运行环境临时提供 `MAC_CODEX_AGENT_TOKEN`，不得写进命令历史、日志、仓库或报告。脚本只读取 health、公开路由和鉴权状态，不调用 claim。

验收必须同时证明：

- release ID、参考合同 v2、Worker `1.4.1`、Skill bundle `1.2.1` 一致；
- heartbeat 新鲜，Worker idle，无 active task，`readyToClaim=true`；
- Mimo 只读登录、认证状态和额度读回存在；
- `approved_for_execution`、`running_on_mac`、stale running 均为 0；
- 正式恢复策略已暴露，但不通过制造陈旧任务来测试；
- 部署后生产兼容 snapshot 与部署前任务、素材、积分、账本 fingerprints 一致。

浏览器只读验收（Playwright 或人工）：

1. 桌面 `1440x900` 与移动 `390x844` 登录普通测试账号。
2. 打开 `/home`，确认人物、关键资产、场景均支持主参考与补充参考；关键资产文案覆盖商品、服装、道具或物件。
3. 上传控件只检查 UI 可见性与可操作性，不选择文件、不上传素材。
4. 确认可选视频参考有泛化意图选项，涵盖动作/表演、镜头语言、节奏、构图/动态、氛围/整体表达；不存在“上传视频即动作迁移”。
5. 确认充值文案为“购买兑换码”，输入提示为“粘贴兑换码”，不出现固定积分人民币比例。
6. 检查无横向溢出、控制尺寸和键盘焦点；保存证据截图，仅作验收证据，不作为生产素材。
7. 不点击创建任务，不调用 `/api/video-tasks` POST。

## 回滚

触发条件见授权包。回滚顺序固定：

1. 停止新 Mac LaunchAgent，确认无活跃 provider task 或租约。
2. 回滚网站到部署前源代码/image；保留 PostgreSQL 和两个数据卷，附加表可留存。
3. 执行 Mac 包内 `rollback-macos.sh "$ROLLBACK_DIR"`，校验旧 bin、plist、manifest 和 Skills 的备份 SHA，恢复 Worker `1.3.0`。
4. 旧网站健康后才启动旧 Worker；绝不让 Worker `1.3.0` 对接新网站合同。
5. 再次执行只读兼容快照，并与部署前 fingerprints 比较。

如果已出现 provider task ID 或活跃任务，不自动回滚/重领该任务；保持 Worker 停止，交由管理员先判定唯一任务归属，避免重复提交和重复 claim。

## 成功边界

本手册执行完只可报告“生产版本与只读 readiness 验收通过”。真实闭环仍未验证；真实 Mimo 提交、成片、下载、`ffprobe`、账本、QA 和用户播放必须等待独立成本授权。
