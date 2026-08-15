# Worker Report: Video Workbench Dispatcher Candidate

## 可执行性复核

- 需求是否清晰：是。
- 实现计划是否合理：是；以现有 hash-chain/CAS 为唯一 Harness 写入口，production
  仅在 `BEGIN READ ONLY` 事务中读取。
- 验收标准是否可执行：是。
- 是否需要补充：否；部署、cutover、任务写入和 Worker 唤醒均留给 controller 的
  后续授权节点。

## 实现摘要

- 增加精确 packet task -> formal sd2 task binding，绑定 owner、派生 SHA、4 秒、
  16:9、720P 与 16 credit reservation。
- 扩展 reducer/CAS，追加 `controller_checkpoint` 以持久化 future check、resume node
  和非秘密生产/Worker readback；checkpoint 后才可 CAS claim resume node。
- 增加一次运行的 Dispatcher CLI：只使用
  `NIANNIAN_DISPATCHER_READONLY_DATABASE_URL`，并在 `BEGIN READ ONLY` 事务内核对
  PostgreSQL、受限 task spec 和 Worker state。它不含 task/credit/Provider/Worker 写入。
- 加固 exact binding：锁定 prompt SHA、派生资产 SHA 与唯一 `-16`
  `video_automatic_reservation` 均必须精确相符；worker state 使用 realpath data-root
  containment，reconciliation 持久化 `observed_at`。
- 新增 append-only `controller_outbox` / `master_ack_cursor`。checkpoint、resume、child
  lifecycle 会同时写 typed handoff；master 仅能一次消费为用户验收、自动继续或用户动作
  阻塞。自动继续需要哈希绑定的 immutable resume envelope。
- 新增 child/background liveness projection 与 recovery journal。活动工作没有 future
  wake 或被投影 idle 会拒绝；`after_ledger_rename` 故障注入由下一次恢复完整提交一次。
- 集中修复独立验收的三项 P1：contract fixture 以 append-only revision 22+ 的失败验收/
  自动返工投影为准；`claimTaskCas` 也使用相同 journal 恢复协议；resume envelope 在
  `consumeControllerOutbox` 入口和 reducer 两处都与被消费 outbox 精确交叉绑定。

## 修改文件

- `scripts/video-workbench-harness-state.mjs`
- `scripts/video-workbench-harness-dispatcher.mjs`
- `scripts/video-workbench-harness-dispatcher-runner.mjs`
- `scripts/video-workbench-harness-dispatcher-repair.test.mjs`
- `scripts/video-workbench-harness-dispatcher.test.mjs`
- `scripts/video-workbench-harness-dispatcher-runner.test.mjs`
- `package.json`
- `docs/agent-team/video-workbench-dispatcher-task-spec-20260728.md`

## 自测结果

- `npm run test:video-workbench-dispatcher`: 11/11 PASS。
- `npm run harness:video-workbench:validate`: PASS，主控当前 Harness revision 23/head
  `aadf140b...38f5a`；该账本演进未由本实现子智能体写入。
- `npm run test:video-workbench-harness`: 13/13 PASS。
- `npm run lint`: PASS。

## 未覆盖项与风险

- 未部署、未 SSH、未 freeze/activate 实际 production writer、未读取生产数据库、未写
  真实 Harness state/events、未操作 Windows Worker、积分或 Provider。测试期间主控
  自身将真实账本推进到 revision 23；实现子智能体未写该账本。
- 独立只读验收仍必须在 implementation 停止后执行；在此之前不得 cutover 或使用
  Dispatcher 唤醒 Worker。
