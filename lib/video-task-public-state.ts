export function publicTaskStatus(status: string, blocker: string | null) {
  if (status === "blocked" && blocker === "awaiting_content_qa") return "processing";
  if (["awaiting_human_login", "awaiting_human_verification"].includes(status)) return "needs_you";
  if (status === "queued_skill" && blocker === "awaiting_cost_readback_and_submit_authorization") return "authorization";
  if (["awaiting_manual_operator", "manual_in_progress", "queued_mac", "queued_skill", "queued_server"].includes(status)) return "queued";
  if (["approved_for_execution", "dispatching_skill", "dispatching_server"].includes(status)) return "approved";
  if (["running_on_mac", "syncing_skill", "syncing_server", "running"].includes(status)) return "processing";
  if (status === "completed") return "completed";
  if (status === "blocked") return "blocked";
  return "queued";
}

export function publicTaskExecutionNotice(input: {
  status: string;
  blocker: string | null;
  channel: string;
  providerTaskId: string | null;
}, mimoReadyToClaim: boolean | null = null) {
  if (input.status === "queued_skill" && input.blocker === "awaiting_cost_readback_and_submit_authorization") {
    if (input.channel === "astorie") return "等待本条 AStorie 执行授权；授权上限为 75 AStorie credits，Windows 执行器仍会先读回画布实际价格，再决定是否生成。";
    const workerState = mimoReadyToClaim === true ? "当前 Windows 执行器已就绪。" : mimoReadyToClaim === false ? "当前 Windows 执行器暂不可领取。" : "";
    return `等待执行授权，尚未提交 Mimo，也不会重复扣费。${workerState}授权后 Windows 执行器会自动领取本条任务。`;
  }
  if (input.status === "queued_skill" && input.channel === "mimo" && input.blocker === null) return "正在排队";
  if (["queued_skill", "approved_for_execution"].includes(input.status) && input.channel === "astorie") return "已获得单次 AStorie 授权，等待 Windows Chrome 执行器读取页面价格后生成。";
  if (input.status === "running" && input.channel === "astorie") return input.providerTaskId ? "AStorie 已收到生成请求，正在同步结果。" : "Windows Chrome 执行器正在读取已锁定的 AStorie 参数。";
  if (input.status === "completed" && input.channel === "astorie") return "AStorie 成片已通过媒体检查并自动交付。";
  if (input.status === "approved_for_execution" && input.channel === "mimo") return mimoReadyToClaim === false ? "正在排队" : "已获得执行授权，等待 Windows 执行器领取；尚未提交 Mimo。";
  if (input.status === "running" && input.channel === "mimo") return input.providerTaskId ? "Mimo 已收到生成请求，正在同步结果。" : "Windows 执行器正在准备已锁定的素材与提示词。";
  if (input.status === "blocked" && input.blocker === "awaiting_content_qa") return "成片已回传，正在进行内容验收；验收通过后才能播放和下载。";
  if (input.status === "completed" && input.channel === "mimo") return "媒体检查通过，已自动交付。";
  return null;
}
