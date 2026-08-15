# Task Spec: Video Workbench Dispatcher Candidate

## 背景和目标

`NIANNIAN-WB-REAL-I2V-4S-20260728-01` 是 Harness 内的不可变包，生产
网站任务是 `aPh_FVncAV5fdhK3z8lCrCTv`。现有 Harness 有可验证的 ledger/CAS，
但没有可运行的、持续把生产只读事实写成 Harness checkpoint 的单 writer
Dispatcher 候选。本任务只交付候选与本地验证，不部署、不接管生产写入。

## 本次范围

- `REQ-001`：提供显式的 packet-task 到 production-task 绑定；绑定必须含
  packet SHA、owner、锁定 prompt SHA、派生参考 SHA、4 秒、16:9、720P、一次
  16 积分 reservation 的只读核对结果。
- `REQ-002`：提供 local freeze -> snapshot -> server activation 的 CAS 接口，
  snapshot 精确绑定 revision、event head、active claim、writer locks、decisions、
  packet SHA 和 production-task binding。
- `REQ-003`：active Dispatcher 只能追加 `controller_checkpoint` 和
  `resume_node_claimed`。每个 checkpoint 都保存 resume node、下一次检查时间、
  非秘密 production/worker 读回摘要；同一 runnable node 的重复 wake 必须幂等。
- `REQ-004`：提供一次运行 CLI，仅读 PostgreSQL 与受限 task-spec/worker-state
  文件，验证生产任务而不写生产数据库、积分、Worker、Provider 或网站任务。
- `REQ-005`：运行时必须拒绝 packet/production task 混淆、错误 owner、错误派生
  SHA、错误规格、重复或缺失 reservation、receipt 后再 submit 的状态推断，或
  双 writer。
- `REQ-006`：每个不可忽略的 durable transition 必须原子携带 append-only
  `controller_outbox` typed handoff，字段固定为 project/formal/harness task、packet
  SHA、事件、节点、状态、证据引用、恢复节点、发生时间和 dedupe key；master 只能
  以 `user_acceptance_required`、`auto_approve_and_continue` 或
  `user_action_blocked` 消费一次。自动继续必须形成不可变 resume envelope。
- `REQ-007`：活动 child/background work、Provider 同步或 active claim 必须有
  future next wake/resume；不得投影为 idle。dispatcher event/state 双文件提交必须有
  可恢复 journal，故障注入后不得重复事件。

## 本次不做

- `NON-001`：不部署 Dispatcher，不 SSH，不修改现有 Harness `state.json` /
  `events.jsonl`，不创建或领取网站任务。
- `NON-002`：不直接写生产数据库，不扣积分，不上传、不调用 Mimo、不 Generate；
  receipt 存在时只输出 `sync_only_provider_delivery` resume node。

## 规则和写集

- `RULE-AUTH-001`：只允许 active controller writer 对 Harness 追加事件；子进程
  只读 production truth，永不拥有 Provider/billing/worker surface。
- `RULE-DATA-001`：task spec 路径必须在配置的 data root 内；输出只含 SHA、ID、
  状态和时间，绝不输出 prompt 正文、cookie、token、路径或连接串。
- `RULE-DATA-002`：production binding 是 `NIANNIAN-WB-REAL-I2V-4S-20260728-01`
  -> `aPh_FVncAV5fdhK3z8lCrCTv`，不得将两者互换。
- `RULE-LIVE-001`：active claim 且 production task/worker 未终态时，checkpoint
  必须有未来 `next_check_at`；不得投影为 idle。
- 写集：候选只写副本 Harness 的 `state.json` 和 `events.jsonl`，且只经现有 CAS。

## 实施任务

- `TASK-001`：扩展 reducer/CAS 与 dispatcher snapshot，使其支持 binding 和
  liveness checkpoint。
- `TASK-002`：实现只读 PostgreSQL reconciliation + CLI runner。
- `TASK-003`：添加 fixture 测试，覆盖双 writer、snapshot 绑定、production
  mismatch、receipt sync-only、liveness checkpoint/restart/duplicate wake。

## 验收标准

- `AC-001`：错误 packet task、production task、owner、prompt/reference SHA、规格
  或 reservation 都被拒绝，且 Harness 字节不变。
- `AC-002`：server activation 在 local freeze 与完整 snapshot 之前被拒绝；切换后
  local writer 不能 append。
- `AC-003`：active writer 的 checkpoint 在 restart reconstruction 后仍保留
  production binding、resume node、future next check；重复同一 checkpoint 不产生
  第二个 node claim。
- `AC-004`：receipt/Provider task ID 的 reconciliation 只能得到 sync-only node；
  无 receipt 的 running task 得到 Worker resume/preflight node，Dispatcher 本身不
  提交 Provider。
- `AC-005`：Harness validator、dispatcher tests、TypeScript 均通过。
- `AC-006`：格式正确但错误的 prompt SHA、派生 SHA 或 16-credit binding 被拒绝；
  worker state 的 realpath 必须在 data root 内。
- `AC-007`：child lifecycle、outbox exactly-once 消费、自动继续 envelope、active
  work 非 idle、journal 恢复和 `observed_at` 均有 fixture 验证。

## 回滚

部署前保留当前 ledger/state byte snapshot；任何 activation/reconstruction/health
失败均不接受 server writer，恢复 frozen 前的 snapshot。此实现阶段不执行 cutover。
