# 念念 AI 视频工作台 1.4.11 RC3 发布授权包

状态：本地候选，未获生产部署、Mac 安装、真实任务、Provider 提交或费用授权。本文不是授权记录。

## 冻结身份

- Release ID：`niannian-video-reference-contract-1.4.11-rc3`
- 网站：`2026.07.21-rc3`
- 参考素材合同：`2`
- 数据库附加迁移：`20260713_asset_reference_metadata_v1`
- Mac Worker：`1.4.11`
- Skill bundle：`1.2.7`

最终文件集合、源树 SHA、制品 SHA 和字节数只以本候选目录的 `release-manifest.json` 为准。历史 `1.4.1-rc2` 候选保持只读，不得覆盖或冒充本版本。

## 受保护边界

- 不重建 PostgreSQL，不删除 Docker 数据卷，不修改积分、账本、任务或客户素材。
- 不提交 Mimo，不创建真实任务，不消耗 Provider 额度。
- 不自动部署网站、不安装 Mac Worker、不输入或收集凭据。
- 不修改 DNS、Nginx、无关容器、系统服务或权限。

## 后续获授权时的回滚合同

执行前必须重新读取生产队列、任务、Provider、数据和 Worker 状态，并创建网站、数据库、数据卷与 Mac 安装状态的 SHA 绑定备份。失败时回滚网站，保留数据库和数据卷，恢复部署前 Worker 状态；不得假定部署前版本仍是历史 `1.3.0`。

即使候选审计通过，也只证明本地发布包与当前源码一致。生产部署和一次真实 Provider 测试分别需要独立、明确的当前授权。
