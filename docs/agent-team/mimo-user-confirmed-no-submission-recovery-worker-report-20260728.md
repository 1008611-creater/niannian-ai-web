# 用户确认无历史提交恢复：实现报告

日期：2026-07-28

## 实现结果

本实现只修改以下生产代码路径：

- `lib/mimo-windows-worker.ts`
- `scripts/mimo-user-confirmed-no-submission-recovery.contract.test.mjs`

新增的恢复分支默认关闭。只有全部环境绑定值与当前正式任务固定值完全一致时，
才会处理 `aPh_FVncAV5fdhK3z8lCrCTv`：同一 Worker
`windows-mimo-liulianggmUXHlg`、owner `liusb0713@qq.com`、派生参考图 SHA256
`ad87a15f8ada8cc0da952d0e0cfe754e1f2d539deb9708d30cb3528c89767fee`、packet SHA256
`a3aa959e832535d191e4f5c9c184b7b8befb02d015f8e3ee1f2a1c09a90d8fe9`，以及用户确认决策值。

恢复前在同一数据库事务中验证：任务属于该 owner、`blocked/mimo_submit_unknown`、
`provider_task_id IS NULL`、`submit_allowed=0`、`cost_authorized=1`、没有
`provider_receipt_observed`，并验证锁定的 4 秒/16:9/720P/Seedance 2.0 成本合同和
Face Processor 派生产物 SHA。CAS 只允许一次性转为 `approved_for_execution`，并只追加
`mimo_user_confirmed_no_submission_recovered` 恢复事件；已有该事件、存在 Provider receipt
或任一绑定不匹配都会拒绝。

验收返工补强：恢复前现在实际读取不可变任务包
`docs/agent-team/video-workbench-harness-v1/task-packets/NIANNIAN-WB-REAL-I2V-4S-20260728-01.json`，
计算其 SHA256 后与配置的 packet SHA256 比较，同时核验任务包的 owner、4 秒、16:9 和 720P。
恢复谓词也显式要求网站任务 `aspect_ratio === "16:9"`；包缺失、哈希不符或比例不符均在
CAS 前拒绝。

最终绑定补全：恢复谓词同时要求 `TaskSpec.aspect_ratio === "16:9"`。任务规格缺少该字段或
字段为任何非 `16:9` 值都会拒绝；最窄契约测试已覆盖该拒绝条件。

预检修正：用户确认无历史提交恢复不再要求提交前才由 Windows Worker 读回的
`provider_cost` 或数值 `TaskSpec.cost_gate`。恢复仍逐项验证网站任务及任务规格的
`image_to_video`、Seedance 2.0、4 秒、16:9、720P、派生参考图、owner、无 receipt，
并从实际不可变任务包验证已授权的 8 Mimo credits 上限。普通
`approved_for_execution` 领取分支没有改动，继续调用 `exactSubmitCostAuthorized`，因此
Provider 提交仍必须经过既有的完整费用合同与无成本预检。

首次恢复调用返回空领取结果，不会在恢复调用内继续执行。后续仍由既有 Windows Worker
无成本预检和普通领取路径负责。没有新增网站任务、积分记录、上传、Provider 回执、
Generate、部署、Worker 重启或 Harness 写入。

## 自测证据

以下本地验证均通过：

```text
node --test scripts/mimo-user-confirmed-no-submission-recovery.contract.test.mjs \
  scripts/mimo-isolated-lease-recovery.contract.test.mjs \
  scripts/mimo-text-queue.contract.test.mjs \
  scripts/mimo-windows-visible-sync.contract.test.mjs
# 20/20 PASS

npm run worker:mimo-windows:contract
# MIMO_WINDOWS_AGENT_CONTRACT_SELF_TEST_PASS

npm run lint
# tsc --noEmit PASS
```

这是实现与自测结果，不是独立只读验收、post-coding review 或生产部署结论。
