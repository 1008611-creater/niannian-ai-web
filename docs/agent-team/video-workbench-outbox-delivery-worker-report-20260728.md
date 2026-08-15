# Worker Report: Harness 主控回传投递

## 可执行性复核

- 需求是否清晰：是。
- 实现计划是否合理：是；以 `controller_outbox` 为唯一候选来源，投递适配器只接受可注入 sender。
- 验收标准是否可执行：是。
- 是否需要补充：否。

## 实现摘要

- 新增 `master_handoff_delivered` 追加事件及 `master_delivery_cursor` 投影。投递成功后才会通过 CAS（比较并交换）写入 cursor；sender 失败时不会写 cursor，也不会写 `master_ack_cursor`。
- 新增项目内 `video-workbench-harness-outbox-delivery.mjs`：从未确认、未投递的 `controller_outbox` 选择事件，构造中文 typed handoff，并按 `dedupe_key` 保证已成功投递的重试不再次调用 sender。
- handoff 绑定 `event_id`、`dedupe_key`、正式任务、Harness 任务、packet SHA、证据、恢复节点和主控分支。`external_blocked` 映射到 `user_action_blocked`，交付/用户验收事件映射到 `user_acceptance_required`，其余可安全继续事件映射到 `auto_approve_and_continue`。
- 保留既有 `master_ack_cursor` 消费路径。新增测试覆盖先投递、后 ack 的投影一致性。
- 已修复独立验收指出的 P1：`consumeControllerOutbox` 与 reducer 的 `applyMasterOutboxConsumption` 对 revision 52 及以后的当前投递合同同时强制 `item.delivery` 和 `master_delivery_cursor.delivered_dedupe_keys`。未投递的直接 ack 稳定报错 `MASTER_ACK_DELIVERY_REQUIRED`，不会写入账本或状态。revision 1-51 的不可变历史保持兼容。
- 已修复真实账本恢复路径的 P1：当 `auto_approve_and_continue` 对应的 task、packet SHA 与 node 已有完全匹配的 claimed node run 时，消费只确认 outbox，不再新增 node run；同 node 的任一 task 或 packet SHA 不匹配 claimed run 会稳定报错 `MASTER_OUTBOX_RESUME_CLAIM_CONFLICT`，且不会持久化 ack 或状态变化。
- Dispatcher 既有测试夹具改为明确使用 revision 49 的不可变 pre-cutover ledger prefix，避免生产账本已经进入 revision 50/51 的 writer freeze 破坏其本来要验证的 local bootstrap 场景；reducer 运行时使用 `structuredClone`，不再把投影状态回写进测试事件而破坏事件哈希。

## 修改文件

- `scripts/video-workbench-harness-state.mjs`
- `scripts/video-workbench-harness-dispatcher.mjs`
- `scripts/validate-video-workbench-harness.mjs`
- `scripts/video-workbench-harness-outbox-delivery.mjs`
- `scripts/video-workbench-harness-outbox-delivery.test.mjs`
- `scripts/video-workbench-harness-dispatcher.test.mjs`
- `scripts/video-workbench-harness-dispatcher-repair.test.mjs`

## 自测结果

- `node --test scripts/video-workbench-harness-outbox-delivery.test.mjs`：6/6 PASS，含未投递 direct ack 拒绝、投递后 ack 与重建一致、完全匹配 preexisting claim 的幂等 ack、错误 claim 的零持久化修改拒绝。
- `npm run test:video-workbench-dispatcher`：12/12 PASS。
- `npm run test:video-workbench-harness`：13/13 PASS。
- `npm run harness:video-workbench:validate`：PASS，revision 51、event head `cb1b593137d70f0cfd6332ad26e68c9fe37bf53b3ae871d95d1dbecd88851049`。
- `npm run lint`：PASS。

## 未执行项

- 未调用真实 Codex 线程消息接口；本实现只提供注入 sender 的适配器和测试替身，真实投递由主控在独立验收与 PCR 后调用。
- 未访问或变更 Provider（模型或服务提供方）、Windows Worker、网站积分、上传、Generate、生产数据库、生产部署或任何秘密。

## 风险与验收关注点

- 跨进程真实 sender 成功后、CAS 持久化前的进程崩溃需要上层 Codex 消息端按 `dedupe_key` 幂等接收；当前投递协议已将该键写入中文 typed handoff。独立验收应重点检查真实 sender 集成点是否在成功返回后立即调用本适配器并把发送失败保留为未投递。
