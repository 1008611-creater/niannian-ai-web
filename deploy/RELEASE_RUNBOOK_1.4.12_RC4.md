# 念念 AI 视频工作台 1.4.12 RC4 部署与回滚运行手册

本手册只定义未来获授权后的顺序。当前不得执行生产部署、Mac 安装、真实任务或 Mimo 提交。

## 入口与固定版本

- 生产域名：`https://sd2.cauai.fun`
- Mimo 当前入口：`https://fd.aancn.cn`
- Release ID：`niannian-video-reference-contract-1.4.12-rc4`
- 网站 / Worker / Skill：`2026.07.21-rc4` / `1.4.12` / `1.2.8`
- 数据卷：`niannian-ai-video-workbench_niannian-postgres`、`niannian-ai-video-workbench_niannian-data`

## 发布前硬门

1. 用户授权原文与本 Release ID 完全一致。
2. `npm run release:audit` 对冻结候选通过，上传制品 SHA 与 manifest 一致。
3. 生产只读快照证明 `approved_for_execution = 0`、`running_on_mac = 0`，无 active task、Provider task 或有效租约。
4. 只读验证 Mimo 根路径 `200`、`/api/auth/verify` 未登录 `401`；不得登录或读取凭据。
5. 记录当时网站 image、数据库/数据卷指纹、Mac Worker 与 Skill bundle 的真实版本；历史记录不得替代现场读回。
6. 任一门失败即停止，不用 SQL 复位、不重复 claim、不创建真实任务。

## 未来获授权后的顺序

1. 停止 Mac LaunchAgent，创建并校验网站、PostgreSQL、数据卷和 Mac 安装状态备份。
2. 在独立 staging 展开 SHA 绑定制品；显式复用既有 Compose project 和数据卷。
3. 仅执行幂等附加建表迁移，禁止 DROP、ALTER、UPDATE、DELETE、TRUNCATE。
4. 构建新 app 后仅切换 app，预计网站中断 `15-60 秒`；不重建 PostgreSQL 或无关容器。
5. 只读验证网站 Release ID、参考合同、Mimo 当前入口和数据指纹。
6. 校验 Mac Worker `1.4.12` 与 Skill bundle `1.2.8` 的安装 SHA；仅在授权范围内且确有差异时安装，预计 `5-15 分钟`。
7. 执行 preflight、heartbeat 和空队列读回，不创建真实任务、不提交 Mimo。

## 只读验收

运行 `npm run release:postdeploy:readonly -- --origin https://sd2.cauai.fun`。临时凭据只能由运行环境提供，不得写入仓库、命令、日志或报告。验收必须读回网站 `1.4.12-rc4`、Worker `1.4.12`、Skill bundle `1.2.8`、readyToClaim、Mimo 认证状态、空执行队列和恢复策略。

## 回滚

停止新 Worker，确认无活跃 Provider 状态后，回滚网站到部署前 image，保留 PostgreSQL 和数据卷，并从本次 SHA 绑定备份恢复部署前 Worker 状态。再次执行只读快照并比对任务、素材、积分和账本指纹。若已出现 Provider task ID，则保持停止并人工确定唯一归属，不自动重领或重提。

完成这些步骤最多证明生产版本和只读 readiness；真实生成、下载、媒体探测、QA、账本和用户播放不在本次迁移验证范围内。
