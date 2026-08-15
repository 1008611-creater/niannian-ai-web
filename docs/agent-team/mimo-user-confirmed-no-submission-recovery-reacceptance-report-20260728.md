# 第二次独立只读验收：用户确认无历史提交后的单任务 Mimo 恢复

日期：2026-07-28

结论：**PASS**。

## 验收范围

仅检查当前最小恢复候选的静态源码、不可变任务包、已有任务规格/实现报告与契约回归；未修改生产代码或配置，未部署，未访问生产数据库，未重启 Worker，未操作 Mimo、Provider、积分、上传、Generate 或 Harness。

目标正式任务为 `aPh_FVncAV5fdhK3z8lCrCTv`，目标 Worker 为
`windows-mimo-liulianggmUXHlg`，不可变 packet SHA256 为
`a3aa959e832535d191e4f5c9c184b7b8befb02d015f8e3ee1f2a1c09a90d8fe9`。

## 已验证通过

- `lib/mimo-windows-worker.ts:297-313` 实际读取固定的不可变任务包，按原始字节计算 SHA256，并在 CAS 事务前与受限配置的 `packetSha256` 严格比对。当前本地任务包实测 SHA256 与该值一致。
- 任务记录谓词在 `lib/mimo-windows-worker.ts:281-294` 严格限制 formal task、同一 Worker、owner、`codex_skill/mimo`、`blocked/mimo_submit_unknown`、`provider_task_id === null`、`submit_allowed === 0`、`cost_authorized === 1`、无 `provider_receipt_observed`，且明确检查任务记录 `aspect_ratio === "16:9"`。
- 恢复 SQL 使用 `updated_at` 比较并在同一数据库事务中将唯一匹配任务转为 `approved_for_execution`，再追加唯一 `mimo_user_confirmed_no_submission_recovered` 事件；已有恢复事件、receipt、Provider ID 或 CAS 竞争均返回空结果。
- 恢复函数本身不含创建任务、网站积分、上传、Generate 或 Provider 回执写入；首次恢复仅返回 `null`，普通 Worker 路由随后才进入既有预检。receipt 路由仍由既有 `claimReceiptRecoveryTask` 维持 sync-only。
- 窄回归已实跑通过：18/18 contract tests、`npm run worker:mimo-windows:contract`、`npm run lint`（`tsc --noEmit`）。

## 前次 P1 的复验

前次 FAIL 的唯一 P1 已修复。`isExactUserConfirmedNoSubmissionRecovery` 现在同时要求：

- 当前数据库任务 `input.task.aspect_ratio === "16:9"`；
- 当前正式任务 `input.spec.aspect_ratio === "16:9"`；
- SHA256 严格匹配的 immutable packet 中 `production_spec.aspect_ratio === "16:9"`。

`scripts/mimo-user-confirmed-no-submission-recovery.contract.test.mjs` 新增了“TaskSpec 缺失或非 `16:9` 必须拒绝”的闭合反例检查；本次最窄回归为 19/19 PASS。

## 最终验收判断

本次最小恢复候选同时满足四个严格授权条件：实际 immutable packet 原始字节 SHA256 与受限 `packetSha256` 比对、数据库任务 `16:9`、TaskSpec `16:9`、immutable packet `16:9`。同一恢复谓词还限定 exact formal task、same Worker、owner、派生参考 SHA、`blocked/mimo_submit_unknown`、无 Provider ID、无 receipt、单次恢复事件及 `updated_at` CAS。

receipt 或 Provider ID 出现时恢复分支拒绝；receipt 后仍由现有 sync-only 路由处理。恢复函数本身不创建任务、不写网站积分、不上传、不调用 Provider、不点击 Generate，且首次恢复只回到 `approved_for_execution` 供既有无成本 preflight 消费。基于本次只读源码审查与最窄回归，准予进入后续一级编码后审查；本报告不构成部署、预检、上传或 Generate 的执行结论。
