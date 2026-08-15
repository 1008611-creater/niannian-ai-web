# 任务规格：用户确认无历史提交后的单任务 Mimo 恢复

## 背景和目标

正式任务 `aPh_FVncAV5fdhK3z8lCrCTv` 因旧 lease 过期而处于
`blocked/mimo_submit_unknown`。用户已在当前登录的官方 Mimo 历史界面翻至最早，
确认不存在“便利店悬浮”匹配记录。需要仅恢复该任务给同一 Windows Worker 进入既有
无成本预检，不能推定已经提交，也不能直接进行上传或 Generate。

## 本次范围

- REQ-001：新增一个显式 opt-in 的恢复路径，仅接受精确任务
  `aPh_FVncAV5fdhK3z8lCrCTv` 与 worker `windows-mimo-liulianggmUXHlg`。
- REQ-002：恢复前必须同时验证 `blocked/mimo_submit_unknown`、`provider_task_id IS NULL`、
  当前 owner/spec/派生参考 SHA 绑定、`submit_allowed=0` 的旧阻断状态，以及没有
  `provider_receipt_observed` 事件。
- REQ-003：恢复动作必须在一个事务中 CAS 更新为 `approved_for_execution`，仅追加一个
  typed recovery event；不得 INSERT 网站任务、信用账、上传记录或 Provider 回执。
- REQ-004：恢复必须幂等。已恢复、任何 receipt/Provider ID、非精确任务/Worker、缺少
  当前用户确认配置时均拒绝，不改变其他任务。

## 不做

- 不部署、不重启 Worker、不创建任务、不重复领取、不扣积分、不上传、不调用 Provider、
  不点击 Generate。
- 不改变 immutable packet、锁定 prompt、模型、时长、比例、分辨率、参考图 SHA 或费用上限。

## 权限与数据规则

- RULE-AUTH-001：用户证据仅适用于该正式任务的一次恢复，环境必须同时设置显式的
  `MIMO_WINDOWS_USER_CONFIRMED_NO_SUBMISSION_RECOVERY_*` 精确绑定值。
- RULE-DATA-001：Provider receipt 或 `provider_task_id` 一旦存在，永久 sync-only，
  本恢复分支不可用。
- RULE-DATA-002：不得修改网站 16 积分预留；恢复后仍需由现有 Worker 完成完整 no-cost preflight。

## 验收标准

- AC-001：配置缺失、task/worker 不匹配、状态不符、历史 receipt/Provider ID 存在时，恢复被拒绝且不写业务状态。
- AC-002：唯一匹配的 `blocked/mimo_submit_unknown` 任务在 CAS 事务中进入 `approved_for_execution`，只写一条恢复事件，不产生网站/积分/Provider 写入。
- AC-003：相同恢复配置重复调用不产生第二次转换或第二条恢复事件。
- AC-004：原有 isolated lease、receipt sync、Worker claim 和任务队列相关回归仍通过。

