# Task Spec: Harness 主控回传投递

## 背景和目标

任务等级：L。`controller_outbox` 已作为账本事实源，但尚未形成可验证的 Codex 主控线程投递。目标是在念念 AI 视频工作台项目内补齐最小投递合同；不触碰 Provider、Windows Worker、积分、上传或 Generate。

## 本次范围

- `REQ-001`：未确认的可投递 outbox 事件生成绑定 `event_id` 和 `dedupe_key` 的中文 typed handoff。
- `REQ-002`：投递成功后才追加 `master_delivery_cursor`；投递失败不得确认、不得丢弃、可按同一 `dedupe_key` 幂等重试。
- `REQ-003`：主控确认仍仅通过既有 `master_ack_cursor` 写入，且必须与被投递 outbox 事件匹配。
- `REQ-004`：为真实 Codex 消息接口提供可注入投递适配器，测试不得访问 Provider、Worker、积分或生产数据库。

## 本次不做

- `NON-001`：不创建或变更网站任务，不重新领取，不扣积分，不上传，不调用 Mimo 或 Generate。
- `NON-002`：不增加第二控制者、不全局化本项目机制、不读取或输出任何秘密。

## 数据和权限规则

- `RULE-001`：可投递事件至少覆盖 `external_blocked`、`delivery_completed`、`deployment_verified` 及含主控分支的 `user_acceptance_required`、`auto_approve_and_continue` handoff；非终态 `progress_checkpoint` 保留可投递语义。
- `RULE-002`：每个 handoff 必须含 `project_id`、`formal_task_id`、`harness_task_id`、`packet_sha`、`event_type`、`status`、`evidence_refs`、`next_resume`、`dedupe_key`、`event_id` 与 `required_master_branch`。
- `RULE-003`：同一 `dedupe_key` 已成功投递时不得第二次发送；失败时不得推进 delivery cursor 或 ack cursor。

## 实现任务

- `TASK-001`：扩展 reducer、CAS 追加接口和 dispatcher，持久化 `master_delivery_cursor`。
- `TASK-002`：新增只依赖可注入 sender 的 delivery runner/adapter 与针对成功、失败、重试、ack 的 focused tests。
- `TASK-003`：提供用于当前 revision 53 未 ack checkpoint 的真实主控 handoff 证据，但不得改动生产业务状态。

## 验收标准

- `AC-001`：事件链重建后 `master_delivery_cursor` 与已投递 event/dedupe 映射一致。
- `AC-002`：sender 成功只追加一次 delivery 事件；重复执行不再次 sender 调用。
- `AC-003`：sender 失败不写 delivery cursor，不写 `master_ack_cursor`，且下次可重试。
- `AC-004`：主控 ack 后 cursor 和 outbox 投递绑定保持一致，且不能重复消费。
- `AC-005`：现有 Harness/Dispatcher 重点测试、验证器与 TypeScript 通过；独立只读验收和 Level 1 PCR 均覆盖真实投递路径。
