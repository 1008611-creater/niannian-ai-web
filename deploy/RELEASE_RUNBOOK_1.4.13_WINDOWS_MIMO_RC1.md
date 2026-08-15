# 念念 AI Windows Mimo 1.4.13 RC1 部署与回滚运行手册

本手册仅定义后续获得明确生产授权时的顺序。当前候选未获部署、Windows 安装、真实任务、Provider 提交或费用授权。

## 冻结身份

- Release ID：`niannian-windows-mimo-1.4.13-rc1`
- 网站：`2026.07.27-windows-rc1`
- Mimo 当前入口：`https://fd.aancn.cn`
- Windows Worker：`1.4.13-windows-mimo.1`
- 历史 Mac Worker / Skill bundle：`1.4.12` / `1.2.8`，仅兼容已有 `mac_codex` 任务
- 数据卷：`niannian-ai-video-workbench_niannian-postgres`、`niannian-ai-video-workbench_niannian-data`

## 发布前硬门

1. 用户授权原文与本 Release ID 完全一致，`npm run release:audit` 对冻结候选通过且制品 SHA 与 manifest 一致。
2. 生产只读快照证明 `approved_for_execution = 0`、`running_on_mimo = 0`，无有效 Provider 回执、租约或活跃 Windows Worker 任务。
3. 记录网站 image、数据库/数据卷指纹、Windows Worker 安装状态和计划任务状态；不得使用历史 RC4 或 Mac 记录代替现场读回。
4. 仅 Windows Worker 在专用交互式用户会话中运行，CDP 必须只监听 loopback；用户自行在该浏览器完成本地登录。
5. 任一门失败即停止，不用 SQL 复位、不重复 claim、不创建真实任务。

## 获授权后的顺序

1. 创建并校验网站、PostgreSQL、数据卷和 Windows Agent 安装状态的 SHA 绑定备份；不重建 PostgreSQL，不删除 Docker 数据卷。
2. 在 staging 展开 SHA 绑定制品，仅切换 app，预计中断 `15-60 秒`；不改动无关服务、网络或数据卷。
3. 仅在安装授权明确存在时，以候选内 Windows Worker 包更新受控计划任务；它不自带凭据，MIMO token 只由 Windows 安全环境提供。
4. 运行无费用 preflight 与 heartbeat，读回 Windows Worker、CDP、ffprobe、`authenticated`、`readyToClaim` 和空执行队列；不创建真实任务。
5. 运行 `npm run release:postdeploy:readonly -- --origin https://sd2.cauai.fun --worker windows-mimo`，只读检查网站身份、Worker `1.4.13-windows-mimo.1`、Mimo 登录态和队列。

## 回滚

停止 Windows Worker，确认没有活跃 Provider 状态后回滚网站到部署前 image，保留 PostgreSQL 和数据卷，并恢复部署前 Worker 状态。再次执行只读快照，比对任务、素材、积分和账本指纹。出现 Provider task ID 时保持停止并人工确认唯一归属，不自动重领或重提。

这些步骤最多证明生产版本和只读 readiness；真实生成、下载、媒体探测、内容 QA、账本和客户播放下载不在本候选验证范围内。
