# 念念 AI Windows Mimo 1.4.13 RC1 发布授权包

状态：本地候选，未获生产部署、Windows Worker 安装、真实任务、Provider 提交或费用授权。本文不是授权记录。

## 冻结身份

- Release ID：`niannian-windows-mimo-1.4.13-rc1`
- 网站：`2026.07.27-windows-rc1`
- Mimo 当前入口：`https://fd.aancn.cn`
- 参考素材合同：`2`
- 数据库附加迁移：`20260713_asset_reference_metadata_v1`
- Windows Mimo Worker：`1.4.13-windows-mimo.1`
- 历史 Mac Worker / Skill bundle：`1.4.12` / `1.2.8`，只兼容既有 `mac_codex`

最终文件集合、源树 SHA、制品 SHA 和字节数只以候选目录的 `release-manifest.json` 为准。历史 RC3、RC4 与其证据保持只读，不得覆盖、改写或冒充本候选。

## 受保护边界

- 不重建 PostgreSQL，不删除 Docker 数据卷，不修改积分、账本、任务或客户素材。
- 不提交 Mimo，不创建真实任务，不消耗 Provider 额度，不上传客户媒体。
- 不自动部署网站，不安装 Windows Worker，不输入、读取或收集凭据。
- Windows Mimo Worker 只可通过受控 loopback CDP 操作可见官方页面；首次登录由用户在 Windows 本机完成。
- 不修改 DNS、反向代理、无关容器、系统服务、网络规则或权限。

## 后续获授权时的回滚合同

执行前必须重新读取生产队列、任务、Provider、数据和 Windows Worker 状态，并创建网站、数据库、数据卷与 Worker 安装状态的 SHA 绑定备份。失败时回滚网站，保留数据库和数据卷，恢复部署前 Worker 状态；不得自动认定既有 Provider task ID 可以重新提交。

即使候选审计通过，也只证明本地发布包与当前源码一致。生产部署、Windows Worker 安装和真实 Provider 测试均不在本次候选范围内。
