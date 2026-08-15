# 念念 AI 视频工作台生产资源与隔离边界（只读盘点）

本清单不含凭据，不执行服务变更。标签：生产、测试、历史。

| 资源 | 状态与入口 | 不可误删约束 |
| --- | --- | --- |
| `sd2.cauai.fun` | 生产；Cloudflare/HTTPS 入口，Nginx 回源 `127.0.0.1:18084` | 不改 DNS 或证书，部署只切 app |
| 腾讯云主机 | 生产；SSH 别名 `tencent-niannian` | 与主机上其他业务隔离，不重启无关容器 |
| `/opt/niannian-ai-video-workbench` | 生产源目录 | 发布前新建时间戳备份，不原地无备份覆盖 |
| PostgreSQL | 生产；Docker volume `niannian-ai-video-workbench_niannian-postgres` | 不重建、不删除、不因代码回滚恢复旧库 |
| 客户数据 | 生产；Docker volume `niannian-ai-video-workbench_niannian-data`，含任务规格/素材/结果路径 | 不删除；发布前快照并对比资产指纹 |
| Mac Worker | 生产；真实 Mac 上当前版本 `1.3.0`，计划升级 `1.4.0` | 现场 plist/文件必须在授权部署时从 Mac 备份；服务器副本不能证明安装态 |
| Mimo | 生产渠道；由 Mac readiness 只读验证登录和额度 | 部署验收不提交任务、不消费额度；凭据只在安全环境/Keychain |
| Skill bundle | 生产；当前服务器副本历史 SHA 已记录，RC 版本 `1.2.0` | 安装前备份六项 allowlisted Skills 与 manifest |
| Cloudflare/Nginx | 生产反向代理 | 本 RC 不改 Cloudflare、DNS、Nginx 配置 |
| 历史源码包 | 历史回滚入口 `commercial-test-csp-20260712-003020.tar.gz`，已验证 SHA | 只含源码，不含数据库/数据卷，不能单独当完整灾备 |
| 本地 `localhost:3026` | 测试；代码与浏览器验证环境 | 不把本地数据库或 `.env*` 打入发布包 |
| RC 产物目录 | 测试/待发布；`release-candidates/niannian-video-reference-contract-1.4.0-rc1` | manifest 冻结后任何源改动都必须重建 |

## 与 `ai.cauai.fun` 的真实集成边界

当前代码和生产资料能确认的已存在集成：

- 品牌层面同属“念念 AI”，可通过页面链接或导航形成产品入口关系。
- 视频工作台拥有独立域名 `sd2.cauai.fun`，可以作为主网页的子能力页面被链接访问。
- 生产渠道与 Mac Worker 服务于 sd2 的视频任务合同。

当前未发现、因而不能宣称存在的集成：

- 未发现 `ai.cauai.fun` 与 sd2 共用登录 session、SSO 或用户 ID 的证据。
- 未发现两站共用积分余额、积分账本或 LDXP 兑换状态的证据。
- 未发现两站共用任务记录、素材库、对象存储命名空间或数据库的证据。
- 未发现 ai 主站任务由 sd2 Mac Worker 领取的合同或接口证据。
- 未发现跨站用户数据同步、账号映射或统一客服审计的证据。

因此，按当前可见事实，用户从 `ai.cauai.fun` 进入 `sd2.cauai.fun` 很可能会遇到第二套登录、积分、任务记录和素材空间。这是高风险客户体验问题，但不属于本 RC 的授权范围；本次不得擅自合并数据库、账号或产品方向。正式对外导流前，主控应单独立项确认统一身份/积分的目标合同与迁移策略。
