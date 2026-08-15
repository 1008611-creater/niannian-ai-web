# Mac 培训：视频工作台集成与验收支持（2026-07-15）

## 范围与状态

- 范围：只提供工作台现有合同、fixture 和无费用验收证据。
- 禁止：生产部署、创建真实客户任务、真实 Mimo/provider 提交、积分扣除、视觉背景继续生成或扩展产品方向。
- 当前结论：本地合同与 fixture 可验证；生产 Mac/Web 版本一致性仍未证明，不能宣称自动执行已在生产修复。

## 1. 版本一致性

| 层 | 本地源头事实 | 状态 |
|---|---|---|
| 网站发布合同 | `lib/release-version.ts`: Worker `1.4.1`，Skill bundle `1.2.1` | 陈旧 |
| 本地 Mac Worker | `mac-agent/niannian-mac-worker.mjs`: `1.4.8` | 已读取 |
| 本地 Skill bundle | `mac-agent/skill-bundle/bundle.config.json`: `1.2.6` | 已读取 |
| bundle 最低 Worker | `1.4.6` | 已读取 |
| 生产 Mac 实际版本 | 本轮未连接生产 Mac、未读取 heartbeat | 未验证 |

因此当前 parity 状态是 `blocked_version_parity_readback`。Mac 培训 owner 必须先决定并固定生产所需版本，再让网站 release identity、Worker、bundle manifest、安装包和 heartbeat readback 完全一致。不得把本地 `1.4.8 / 1.2.6` 单元测试通过表述为生产 Mac 已升级。

## 2. Reference-intent 合同

权威源：`lib/video-tasks.ts`。

允许的语义意图：

```text
identity
asset_lock
scene
motion_performance
camera_language
rhythm
composition
dynamics
atmosphere
overall_expression
```

合同规则：

1. 角色与意图分离；文件是视频不等于 `action_transfer`。
2. 历史 `motion` 默认解释为 `motion_performance`，新视频参考使用 `reference_video` 角色和显式意图。
3. 每份素材保留 `reference_intent`、`is_primary`、`sort_order`、`chinese_duty`、SHA256 和用户确认。
4. 单任务最多保留 12 份可上传参考；Mimo 选择计划记录每份素材是否选中、排名和原因，超限素材仍保留在 task spec 中。
5. 新任务统一生成 `reference_guided_video`；最终渠道操作由执行路由根据锁定合同决定，不由上传文件类型直接决定。
6. 当前公开 Mimo 可见前端只支持图片参考。客户 UI 将视频参考标记为“暂未开放”，服务端在预留积分前返回 `REFERENCE_VIDEO_UNSUPPORTED`。
7. 上述通道限制不等于删除泛化视频参考合同；历史视频参考仍可读，后续只有在渠道能力和真实上传链路验证后才能重新开放创建。

## 3. 自动 claim 与租约恢复

权威源：`lib/mac-codex-worker.ts` 与 `mac-agent/niannian-mac-worker.mjs`。

- 父 Worker 独占 preflight、heartbeat、claim、租约恢复和 run-loop。
- 子 Codex 员工只消费父 Worker 已锁定、已落盘的 `task.json`，不得再次运行 preflight/heartbeat/claim/run-once。
- claim 只选择：
  - `execution_mode=mac_codex`
  - `status=approved_for_execution`
  - `submit_allowed=1`
  - `cost_authorized=1`
  - worker ID 与新鲜 readiness heartbeat 匹配
- claim 使用条件更新把状态原子地改为 `running_on_mac`，避免重复领取。
- 陈旧 `running_on_mac` 由父级 claim 前自动恢复为 `approved_for_execution`，记录 `mac_worker_lease_expired`；不依赖手工 SQL。
- 素材下载必须属于当前任务、位于用户素材根目录，并通过服务端 SHA256 校验。

## 4. Mimo receipt、下载与 QA

现有 fixture 证明的正确路径：

1. 官方 Mimo client 在第一次轮询前持久化真实 provider task ID。
2. Mac Worker 先以 `status=running` 回传 receipt；服务端保存 `provider_task_id` 和 `mac_worker_provider_running` 事件。
3. 已有 provider task ID 时只允许同步、轮询、下载和 QA，不得再次提交。
4. 成片必须下载到当前任务 `output/result.mp4`，同时写 `ledger/execution-ledger.json`。
5. 服务端接收 output 与 ledger 后执行真实媒体探测和时长容差检查；失败文件会删除，不进入交付。
6. 媒体探测通过后任务仍保持 `blocked / awaiting_content_qa`，不会直接对客户显示完成。
7. 管理员内容 QA 通过后才改为 `completed`。
8. 用户下载接口要求当前用户拥有任务、状态为 `completed`、输出路径位于该任务 downloads 根目录。
9. 播放支持 HTTP Range `206`，下载使用 `?download=1` 返回 attachment；均为 private/no-store。

## 5. Retry、fallback 与 refund

- provider task ID 已存在但同步失败：保存为 `provider_sync_failed`，保留同一 provider ID；恢复时走 `resume_provider_sync`，禁止重提。
- provider ID 尚未产生且自动执行失败：转 `manual_assist / awaiting_manual_operator`，不增加价格，记录原始自动失败原因。
- pre-submit 失败且原成本授权仍有效：允许同一授权恢复到 `approved_for_execution`。
- 需要全新自动重试时：清空提交授权，回到 `queued_mac / awaiting_cost_readback_and_submit_authorization`，必须重新取得成本授权。
- 管理员明确 block 时调用幂等退款；credit ledger 防止重复退款。
- 退款、人工兜底和自动重试都不得丢失原 task ID、素材 SHA、事件或账本证据。

## 6. 无费用 fixture 结果

2026-07-15 本地执行：

```text
npm run test:video-worker                 PASS 9/9
npm run test:mimo-direct                  PASS 2/2
npm run test:mimo-official-client         PASS 1/1
npm run test:mimo-safari-visible-submit   PASS 2/2
npm run test:mac-worker                   PASS 4/4
npm run test:mac-skill-bundle             PASS 2/2
npm run test:mac-worker:integration       MAC_WORKER_API_INTEGRATION_PASS
npm run test:delivery-route:integration   DELIVERY_ROUTE_INTEGRATION_PASS
npm run test:manual-task:integration      MANUAL_TASK_INTEGRATION_PASS
```

这些 fixture 使用本地测试令牌、临时用户/任务、生成的黑色视频媒体 fixture 和清理逻辑；没有连接 Mimo、没有 provider 提交、没有真实客户积分或生产数据变更。

诊断过程中两次在 fixture 正式进入 `try/finally` 前失败，留下 2 条没有 session、素材、积分或任务依赖的本地临时用户行；已用受限条件删除并复查为 `temporaryUsers=0 / temporaryTasks=0`。该清理只作用于 `127.0.0.1:55432/niannian` 本地测试库。

## 7. Fixture 修正

`scripts/manual-task.integration.mjs` 原先在同一文件中先断言公开路由必须拒绝视频参考，后面又用同一视频参考创建 provider-output review 任务，造成自相矛盾并返回 `REFERENCE_VIDEO_UNSUPPORTED`。

本次只将 provider-output review fixture 改为使用 `characterId`。视频参考负向门禁仍由前面的断言和 `mimo-safari-visible-submit` fixture 覆盖；没有收窄或改变产品合同。

## 8. Mac 培训 owner 的最小验收顺序

在不创建真实任务的阶段：

1. 固定网站 required Worker/bundle 版本。
2. 核对 Mac 安装文件、Worker `--version`、bundle manifest 和每个 Skill SHA。
3. 只读 preflight：Codex auth、workspace、ffprobe、Mimo 认证/额度 readback。
4. heartbeat：版本完全一致、`readyToClaim=true`、队列为空、activeTaskId 为空。
5. 用本文件列出的 fixture 复核 reference-intent、claim、receipt、下载、QA、fallback/refund 和 Range delivery。

只有上述完成后，且用户另行授权一次唯一真实测试任务及最高 Mimo 成本，才能验证生产自动 claim、真实 receipt、真实下载、ffprobe、视觉 QA 和网站播放。当前不能宣称该真实闭环已经由本轮验证完成。
