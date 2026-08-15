# 独立只读验收：用户确认无历史提交恢复

结论：**FAIL**。

- AC-001 失败：`lib/mimo-windows-worker.ts:265-285` 只将 `packetSha256` 作为环境配置和后续事件字段使用，没有从任务规格或权威绑定中读取并比较该任务的不可变 packet SHA；同一函数也没有验证 `task.aspect_ratio === "16:9"`。因此一个数据库记录仍可满足实现中的 task/worker/owner/派生图/成本条件，却没有被恢复路径实际绑定到当前 packet 或 16:9 规格。
- AC-002 未通过：虽然 `lib/mimo-windows-worker.ts:517-568` 的数据库 `UPDATE` 使用了 `updated_at` CAS 并在同一事务追加恢复事件，但上述缺失的 packet 与比例前置条件意味着它不能证明“唯一精确当前任务”才会从 `blocked/mimo_submit_unknown` 进入 `approved_for_execution`。
- AC-003 的已有幂等保护可读回：`priorRecovery` 拒绝和 `updated_at` CAS 存在；但因 AC-001/002 失败，整体验收不能通过。
- AC-004 的窄回归均通过：`node --test scripts/mimo-user-confirmed-no-submission-recovery.contract.test.mjs scripts/mimo-isolated-lease-recovery.contract.test.mjs scripts/mimo-text-queue.contract.test.mjs scripts/mimo-windows-visible-sync.contract.test.mjs` 为 `17/17 PASS`；`npm run worker:mimo-windows:contract` 通过；`npm run lint`（`tsc --noEmit`）通过。现有新测试没有覆盖 packet SHA 或 `16:9` 反例，不能弥补上述授权绑定缺口。

本次为独立只读验收：未修改生产代码、未部署、未访问生产数据库、未操作 Worker/Mimo/Provider、未上传/Generate/积分。
