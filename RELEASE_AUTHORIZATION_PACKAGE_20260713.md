# 念念 AI 视频工作台 1.4.0 RC1 发布授权包

状态：等待主控取得用户一次明确的生产部署授权。本文不是授权记录，未出现用户原文确认前不得执行。

## 发布身份

| 组件 | 固定版本 |
| --- | --- |
| Release ID | `niannian-video-reference-contract-1.4.0-rc1` |
| 网站 | `2026.07.13-rc1` |
| 参考素材合同 | `2` |
| 数据库附加迁移 | `20260713_asset_reference_metadata_v1` |
| Mac Worker | `1.4.0` |
| Skill bundle | `1.2.0` |

最终 SHA、字节数和源树 SHA 以冻结目录 `release-candidates/niannian-video-reference-contract-1.4.0-rc1/release-manifest.json` 为唯一准绳。任何纳入发布的源文件变化都必须重新构建并审计，旧 SHA 随即作废。

## 会改什么

- 将 `sd2.cauai.fun` 网站升级到参考合同 v2：视频是泛化的可选参考，不再自动等同动作迁移；图片支持主参考与补充参考，并保留角色、顺序和选取证据。
- 对 PostgreSQL 只执行幂等的附加建表迁移 `asset_reference_metadata`。
- 将 Mac Worker 从 `1.3.0` 升级为 `1.4.0`，使用父 Worker 独占 preflight、heartbeat、恢复和 claim 的持续循环。
- 将 Mac 的生产 Skill bundle 升级为 `1.2.0`，保留 SHA 校验和渠道白名单。
- 将 LaunchAgent 切换为 `run-loop` 且保持 `KeepAlive`。

## 不会改什么

- 不重建 PostgreSQL，不恢复旧数据库覆盖当前数据库。
- 不删除 Docker 数据卷：`niannian-ai-video-workbench_niannian-postgres` 和 `niannian-ai-video-workbench_niannian-data` 均原地保留。
- 不改积分价格、用户余额、积分账本、LDXP 商品或兑换规则。
- 不删除任务、任务规格、上传素材、结果文件或历史事件。
- 不合并 `ai.cauai.fun` 与 `sd2.cauai.fun` 的账户、积分、任务或素材系统。
- 发布与验收期间不创建客户任务、不提交 Mimo、不消耗生成额度。
- 不改其他 Docker 服务、Cloudflare DNS、Nginx 域名配置或主站业务。

## 费用与中断

- 本次部署和只读验收不产生 Mimo 生成费用。
- 网站预计仅在 app 容器切换时中断约 `15-60 秒`；PostgreSQL 保持运行。
- Mac 生成 Worker 预计暂停 `5-15 分钟`；暂停期间不领取新任务。
- 如果预检发现待执行、运行中、活跃租约或 provider task ID，发布立即中止，不靠复位或重复 claim 强行继续。

## 原子发布与回滚

网站合同和 Mac Worker 必须作为同一个原子版本处理，禁止 Worker `1.3.0` 对接新网站合同。

1. 先取得生产只读快照并验证 `approved_for_execution = 0`、`running_on_mac = 0`。
2. 停止旧 Mac LaunchAgent，再备份服务器源代码、PostgreSQL、数据卷以及 Mac 已安装文件。
3. 构建和切换网站，仅重启 app；只读验证通过后才安装 Worker `1.4.0` 与 Skill bundle `1.2.0`。
4. 仅执行 Mac preflight、heartbeat、readyToClaim 和空队列验证，不创建真实任务。
5. 任一步失败都停止推进：回滚网站并恢复 Worker 1.3.0；数据库和数据卷不倒退。

回滚条件包括：版本/SHA 不匹配、迁移失败、网站健康检查失败、页面合同不符、Mac 备份不可验证、Worker readiness 失败、Mimo 登录或额度只读失败、队列非空、出现活跃 provider task、数据指纹异常或重复 claim 风险。

## 一次确认文本

用户只需明确回复以下完整句子一次，才构成此次生产发布授权：

> 我授权将念念 AI 视频工作台 `niannian-video-reference-contract-1.4.0-rc1` 部署到 `sd2.cauai.fun`，并将 Mac Worker 升级到 `1.4.0`、Skill bundle 升级到 `1.2.0`；本次授权不包含创建真实任务、提交 Mimo 或产生生成费用。

## 发布后的真实测试仍需另一次授权

只读验收通过不等于真实生成闭环通过。之后若要创建受控任务、提交 Mimo、扣除或预留积分并验证成片、下载、`ffprobe`、账本、QA 与用户播放，必须再次说明预计额度/费用和唯一测试任务，并取得单独的成本授权。不得沿用本次部署授权。
