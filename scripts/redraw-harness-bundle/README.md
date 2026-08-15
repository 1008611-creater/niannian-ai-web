# 员工版转绘项目 Harness

这个包是 `employee-redraw-video-skill-bundle-v1.zip` 的配套项目 Harness。Skill 包负责“怎么做转绘”，Harness 负责“当前项目做到哪一步、下一个节点是什么、什么证据才能算完成”。

## 交给员工的两个包

1. `employee-redraw-video-skill-bundle-v1.zip`
2. `employee-redraw-project-harness-v1.zip`

员工应先让 Codex 安装 Skill 包，再把本 Harness 解压到一个新的空项目目录。不要把 Harness 直接覆盖到已有生产项目。

## 第一次启动

```powershell
node tools\init_redraw_project_harness.js --root . --job-id "job-001" --project-name "项目名称"
node tools\compute_redraw_route_decision.js --job ".\jobs\job-001"
node tools\test_compute_redraw_route_decision.js
node tools\test_redraw_routing_contracts.js
```

初始化后，当前任务目录位于 `jobs/<job-id>/`。Codex 应把原视频、目标商品素材和权威事实登记为精确路径与 SHA，不得把文件复制进 Harness 后就自动视为已接受。

## Harness 产物

- `task.json`: 当前任务、输出目标、所需能力和授权状态。
- `checkpoint.json`: 当前节点、blocker、恢复事件和下一动作。
- `artifact_ledger.json`: 权威产物路径、SHA、验证、QA 和交付状态。
- `gate_dashboard.json`: 当前门禁投影；不是权威完成来源。
- `route_decision.json`: 最早断点和下一节点；默认只建议，不授权提交。
- `result_manifest.json`: 最终结果和交付边界。

## 安全边界

本包不包含 API key、cookie、验证码、浏览器会话、生产视频或历史任务。真实渠道执行依赖员工自己的账号环境，并需要当前任务明确授权。
