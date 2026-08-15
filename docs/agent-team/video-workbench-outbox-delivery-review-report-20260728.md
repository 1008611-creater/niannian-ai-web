# Independent Review Report: Harness 主控回传投递

## 验收结论

**PASS（P1 / P1-续修复后的第三次独立只读复验）**

此前 `master_ack_cursor` 可在对应 outbox 未实际投递时写入的 P1 已修复。当前
`consumeControllerOutbox` 与 reducer（归约器）的 `applyMasterOutboxConsumption` 均要求
`item.delivery` 和 `master_delivery_cursor.delivered_dedupe_keys` 已存在；未投递 direct ack
（直接确认）稳定以 `MASTER_ACK_DELIVERY_REQUIRED` 拒绝。独立临时夹具同时证明拒绝操作前后
账本及状态文件字节完全不变，成功投递后确认、事件链重建均通过。

本轮同时验证恢复节点已被并发/先前路径领取时的消费语义：完全匹配的
`task_id + packet_sha + node_id` 已领取节点允许 outbox 确认但不追加第二个 node run；同一节点
存在 task 或 packet SHA 不匹配的 claimed node run 时，稳定以
`MASTER_OUTBOX_RESUME_CLAIM_CONFLICT` 拒绝，且账本/状态字节完全不变。

## 验收范围

- 任务规格：`docs/agent-team/video-workbench-outbox-delivery-task-spec-20260728.md`
- 实现报告：`docs/agent-team/video-workbench-outbox-delivery-worker-report-20260728.md`
- 实现：
  - `scripts/video-workbench-harness-outbox-delivery.mjs`
  - `scripts/video-workbench-harness-state.mjs`
  - `scripts/video-workbench-harness-dispatcher.mjs`
- 测试：`scripts/video-workbench-harness-outbox-delivery.test.mjs` 及既有 Harness / Dispatcher 测试。

未访问 Provider（模型或服务提供方）、Windows Worker、网站积分、生产数据库，也未调用
Codex 任务消息接口。

## 执行命令和证据

| 验证动作 | 实际结果 |
| --- | --- |
| `node --test scripts/video-workbench-harness-outbox-delivery.test.mjs` | 6/6 PASS |
| `npm run test:video-workbench-dispatcher` | 12/12 PASS |
| `npm run test:video-workbench-harness` | 13/13 PASS |
| `npm run harness:video-workbench:validate` | PASS；本地账本 revision 51、链头 `cb1b593137d70f0cfd6332ad26e68c9fe37bf53b3ae871d95d1dbecd88851049` |
| `npm run lint` | PASS（`tsc --noEmit`） |
| 独立临时 Harness fixture（夹具）因果复验 | **PASS**：未调用 sender 时 direct ack 抛出 `MASTER_ACK_DELIVERY_REQUIRED`；`events.jsonl` 与 `state.json` 字节分别保持相同；成功 delivery 后 ack 通过且重建一致。 |
| 独立临时 Harness fixture（夹具）resume claim 复验 | **PASS**：完全匹配 claimed node 的 delivery 后 ack 不新增 node run；task/packet 不匹配 claimed node 抛出 `MASTER_OUTBOX_RESUME_CLAIM_CONFLICT`，拒绝前后 `events.jsonl` 与 `state.json` 字节相同。 |

独立复验使用已复制到系统临时目录的 Harness fixture；未修改仓库或生产账本。调用顺序为：

1. 激活临时 server writer；
2. 对 `pcr:dispatcher-liveness-outbox:revision-49` 构造合法 resume envelope；
3. **不调用** `deliverControllerOutbox`，直接调用 `consumeControllerOutbox`；
4. 收到精确错误 `MASTER_ACK_DELIVERY_REQUIRED`，并逐字节比较拒绝前后的
   `events.jsonl`、`state.json`；两者相同；
5. 以注入的无副作用 sender 成功调用 `deliverControllerOutbox`；
6. 对同一 `dedupe_key` 调用 ack 后重建 Harness，delivery cursor 与 ack cursor 均含该键。

## 逐项验收记录

| AC | 判定 | 证据 |
| --- | --- | --- |
| AC-001 | PASS | `master_handoff_delivered` 由 reducer 投影至 `master_delivery_cursor`；focused test 成功读取 target thread 与 delivery mapping，Harness 验证器通过重建一致性检查。 |
| AC-002 | PASS（受测范围） | focused test 验证 sender 成功后追加一次 `master_handoff_delivered`，后续同一 `dedupe_key` 返回 `idempotent=true` 且 sender 调用数保持 1。 |
| AC-003 | PASS | failing sender 抛出 `TEST_SENDER_UNAVAILABLE` 后，测试读回 delivery cursor 与 ack cursor 均没有目标 `dedupe_key`；随后成功重试可投递。 |
| AC-004 | PASS | `consumeControllerOutbox` 检查 `item.delivery` 的 event/delivery ID 及 `master_delivery_cursor`；reducer 对 revision 52 及以后的新消费事件执行同一检查。独立复验确认未投递 ack 被拒绝、字节不变；delivery 后 ack 与重建一致。 |
| AC-005 | PASS（结构/集成级） | 6/6 focused、12/12 Dispatcher、13/13 Harness、验证器和 TypeScript 均通过。真实 Codex 线程消息接口未在本复验调用，按范围仍由主控在 PCR 后执行。 |

## P1-续修复复验

- 完全匹配已领取节点：对同一 `task_id`、`packet_sha` 与 `node_id` 预先追加 claimed node run 后，
  delivery 后 ack 成功；`node_runs.length` 在 ack 前后相同，重建后仍相同。
- 冲突已领取节点：对同一 node 预先追加错误 packet SHA 的 claimed node run 后，delivery 后 ack
  精确抛出 `MASTER_OUTBOX_RESUME_CLAIM_CONFLICT`；拒绝前后 `events.jsonl`、`state.json` 逐字节相同。
- 实现中的 reducer（归约器）先检查 claimed node 的 task/packet 身份，只有不存在 claimed node
  时才追加新的 run；因此 ack 不会覆盖、重复或静默合并不兼容的恢复领取。

## 已关闭问题

### ISSUE-001（P1）：未投递 outbox 可以被主控确认

- 状态：**CLOSED（独立复验通过）**
- 绑定：`REQ-003`、`AC-004`
- 修复位置：`scripts/video-workbench-harness-dispatcher.mjs` 的
  `consumeControllerOutbox`，以及 `scripts/video-workbench-harness-state.mjs` 的
  `applyMasterOutboxConsumption`。
- 复验证据：未投递 ack 以 `MASTER_ACK_DELIVERY_REQUIRED` 拒绝并保持账本/状态字节不变；
  delivery 后 ack 可通过且 reducer 重建一致。

## 最终说明

本独立验收确认的是结构/集成路径：可注入 sender（发送器）的成功/失败/幂等、delivery-to-ack
因果绑定和状态重建。未调用真实 Codex 任务消息接口，未访问 Provider（模型或服务提供方）、
Windows Worker、积分或生产账本；真实投递仍须由唯一 controller writer（唯一控制者写入端）在
post-coding review（编码后审查）通过后执行。
