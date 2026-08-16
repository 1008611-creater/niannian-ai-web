import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createId, DatabaseTransaction, dbAll, dbOne, dbRun, dbTransaction, timestamp } from "@/lib/auth";

export const serviceModes = ["automatic", "manual"] as const;
export type ServiceMode = (typeof serviceModes)[number];

const automaticCosts: Record<number, number> = {
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
  12: 48,
  13: 52,
  14: 56,
  15: 60,
};
const manualCosts: Record<number, number> = automaticCosts;
const ldxpPackages = [100, 300, 500, 1000] as const;
const rechargeStatuses = ["pending", "approved", "rejected"] as const;
const channelCreditMultiplier = 1.5;

function customerCosts(costs: Record<number, number>) {
  return Object.fromEntries(
    Object.entries(costs).map(([duration, cost]) => [duration, Math.ceil(cost * channelCreditMultiplier)]),
  ) as Record<number, number>;
}

const customerAutomaticCosts = customerCosts(automaticCosts);
const customerManualCosts = customerCosts(manualCosts);

type WalletRow = { balance: number | string };
type LedgerRow = {
  id: string;
  amount: number | string;
  balance_after: number | string;
  reason: string;
  task_id: string | null;
  recharge_request_id: string | null;
  created_at: string;
};
type RechargeRow = {
  id: string;
  user_id: string;
  requested_credits: number | string;
  note: string | null;
  status: string;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  email?: string;
};

function asInteger(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) ? parsed : 0;
}

export function validServiceMode(value: unknown): ServiceMode | null {
  return typeof value === "string" && serviceModes.includes(value as ServiceMode) ? value as ServiceMode : null;
}

export function taskCreditCost(serviceMode: ServiceMode, durationSeconds: number) {
  const costs = serviceMode === "manual" ? customerManualCosts : customerAutomaticCosts;
  const cost = costs[durationSeconds];
  if (!Number.isInteger(cost) || cost <= 0) throw new Error("CREDIT_QUOTE_INVALID");
  return cost;
}

export function creditPricing() {
  const shopUrl = process.env.LDXP_SHOP_URL?.trim() || null;
  return {
    automatic: customerAutomaticCosts,
    manual: customerManualCosts,
    recharge: {
      yuanPerCredit: 0.01,
      packages: ldxpPackages,
      fulfillment: "ldxp_card_code" as const,
      shopUrl,
      configured: Boolean(shopUrl && process.env.LDXP_REDEEM_SECRET),
    },
  };
}

function normalizeLdxpCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^NN-(100|300|500|1000)-[A-Z0-9]{16,64}-[A-F0-9]{32}$/.test(normalized) ? normalized : null;
}

export async function redeemLdxpCode(input: { userId: string; code: unknown }) {
  const secret = process.env.LDXP_REDEEM_SECRET;
  if (!secret || secret.length < 32) throw new Error("LDXP_PAYMENT_CHANNEL_UNAVAILABLE");
  const code = normalizeLdxpCode(input.code);
  if (!code) throw new Error("LDXP_REDEEM_CODE_INVALID");
  const parts = code.split("-");
  const credits = Number(parts[1]);
  const payload = parts.slice(0, 3).join("-");
  const received = Buffer.from(parts[3], "hex");
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32), "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("LDXP_REDEEM_CODE_INVALID");
  const codeHash = createHash("sha256").update(code).digest("hex");
  return dbTransaction(async (db) => {
    await ensureWallet(input.userId, db);
    const redeemedAt = timestamp();
    const claimed = await db.run(
      "INSERT INTO credit_redemptions (code_hash, user_id, credits, redeemed_at) VALUES (?, ?, ?, ?) ON CONFLICT(code_hash) DO NOTHING",
      [codeHash, input.userId, credits, redeemedAt],
    );
    if (claimed !== 1) throw new Error("LDXP_REDEEM_CODE_USED");
    await db.run("UPDATE user_credits SET balance = balance + ?, updated_at = ? WHERE user_id = ?", [credits, redeemedAt, input.userId]);
    const wallet = await db.one<WalletRow>("SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1", [input.userId]);
    const balanceAfter = asInteger(wallet?.balance);
    await db.run(
      "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at) VALUES (?, ?, ?, ?, 'ldxp_redeem', NULL, NULL, ?)",
      [createId(), input.userId, credits, balanceAfter, redeemedAt],
    );
    return { redeemedCredits: credits, balance: balanceAfter };
  });
}

async function ensureWallet(userId: string, transaction?: DatabaseTransaction) {
  const sql = "INSERT INTO user_credits (user_id, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(user_id) DO NOTHING";
  if (transaction) {
    await transaction.run(sql, [userId, timestamp()]);
    return;
  }
  await dbRun(sql, [userId, timestamp()]);
}

function publicLedger(row: LedgerRow) {
  return {
    id: row.id,
    amount: asInteger(row.amount),
    balanceAfter: asInteger(row.balance_after),
    reason: row.reason,
    taskId: row.task_id,
    rechargeRequestId: row.recharge_request_id,
    createdAt: row.created_at,
  };
}

function publicRecharge(row: RechargeRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.email ?? null,
    requestedCredits: asInteger(row.requested_credits),
    note: row.note,
    status: row.status,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

export async function getCreditSummary(userId: string) {
  await ensureWallet(userId);
  const [wallet, ledger, requests] = await Promise.all([
    dbOne<WalletRow>("SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1", [userId]),
    dbAll<LedgerRow>("SELECT id, amount, balance_after, reason, task_id, recharge_request_id, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [userId]),
    dbAll<RechargeRow>("SELECT * FROM credit_recharge_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", [userId]),
  ]);
  return {
    balance: asInteger(wallet?.balance),
    pricing: creditPricing(),
    ledger: ledger.map(publicLedger),
    rechargeRequests: requests.map(publicRecharge),
  };
}

export async function reserveTaskCredits(input: { userId: string; taskId: string; serviceMode: ServiceMode; durationSeconds: number }) {
  const cost = taskCreditCost(input.serviceMode, input.durationSeconds);
  return dbTransaction(async (db) => {
    await ensureWallet(input.userId, db);
    const changed = await db.run(
      "UPDATE user_credits SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
      [cost, timestamp(), input.userId, cost],
    );
    if (changed !== 1) throw new Error("CREDITS_INSUFFICIENT");
    const wallet = await db.one<WalletRow>("SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1", [input.userId]);
    const balanceAfter = asInteger(wallet?.balance);
    await db.run(
      "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
      [createId(), input.userId, -cost, balanceAfter, `video_${input.serviceMode}_reservation`, input.taskId, timestamp()],
    );
    return { cost, balanceAfter };
  });
}

/**
 * Charge a single editor operation against the same NianNian wallet used by
 * the main site. The task/reason pair is unique, so browser retries and
 * provider reconnects cannot charge the same operation twice.
 */
export async function consumeEditorCredits(input: {
  userId: string;
  operationId: string;
  step: string;
  credits: number;
}) {
  const amount = Math.trunc(input.credits);
  const step = input.step.trim().replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
  const operationId = input.operationId.trim().slice(0, 160);
  if (!operationId || !step || !Number.isInteger(amount) || amount < 0 || amount > 100000) throw new Error("EDITOR_CREDIT_REQUEST_INVALID");
  return dbTransaction(async (db) => {
    await ensureWallet(input.userId, db);
    const reason = `editor_${step}`;
    // Scope the idempotency key to the authenticated user. The editor supplies
    // an operation id, but it must never let two users share a ledger entry.
    const taskId = `editor:${input.userId}:${operationId}`;
    const existing = await db.one<LedgerRow>(
      "SELECT id, amount, balance_after, reason, task_id, recharge_request_id, created_at FROM credit_ledger WHERE task_id = ? AND reason = ? LIMIT 1",
      [taskId, reason],
    );
    if (existing) return { charged: false, credits: Math.abs(asInteger(existing.amount)), balanceAfter: asInteger(existing.balance_after), operationId, step };
    const changed = amount === 0 ? 1 : await db.run(
      "UPDATE user_credits SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
      [amount, timestamp(), input.userId, amount],
    );
    if (changed !== 1) throw new Error("CREDITS_INSUFFICIENT");
    const wallet = await db.one<WalletRow>("SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1", [input.userId]);
    const balanceAfter = asInteger(wallet?.balance);
    await db.run(
      "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
      [createId(), input.userId, -amount, balanceAfter, reason, taskId, timestamp()],
    );
    return { charged: true, credits: amount, balanceAfter, operationId, step };
  });
}

export async function refundTaskCredits(taskId: string) {
  return dbTransaction(async (db) => {
    const existing = await db.one<LedgerRow>(
      "SELECT id, amount, balance_after, reason, task_id, recharge_request_id, created_at FROM credit_ledger WHERE task_id = ? AND reason LIKE 'video_task_%_refund' LIMIT 1",
      [taskId],
    );
    if (existing) return { refunded: false, amount: 0 };
    const reservation = await db.one<LedgerRow & { user_id: string }>(
      "SELECT id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at FROM credit_ledger WHERE task_id = ? AND reason IN ('video_automatic_reservation', 'video_manual_reservation') LIMIT 1",
      [taskId],
    );
    if (!reservation || asInteger(reservation.amount) >= 0) return { refunded: false, amount: 0 };
    const amount = Math.abs(asInteger(reservation.amount));
    await ensureWallet(reservation.user_id, db);
    // Claim the one allowed refund before moving the wallet balance. The unique
    // task/reason constraint makes competing admin/worker retries harmless.
    const refundId = createId();
    const claimed = await db.run(
      "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at) VALUES (?, ?, ?, 0, 'video_task_refund', ?, NULL, ?) ON CONFLICT DO NOTHING",
      [refundId, reservation.user_id, amount, taskId, timestamp()],
    );
    if (claimed !== 1) return { refunded: false, amount: 0 };
    const updatedAt = timestamp();
    await db.run("UPDATE user_credits SET balance = balance + ?, updated_at = ? WHERE user_id = ?", [amount, updatedAt, reservation.user_id]);
    const wallet = await db.one<WalletRow>("SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1", [reservation.user_id]);
    await db.run(
      "UPDATE credit_ledger SET balance_after = ? WHERE id = ?",
      [asInteger(wallet?.balance), refundId],
    );
    return { refunded: true, amount };
  });
}

export async function createRechargeRequest(input: { userId: string; requestedCredits: number; note?: string }) {
  const requestedCredits = Math.trunc(input.requestedCredits);
  if (requestedCredits < 20 || requestedCredits > 100000) throw new Error("RECHARGE_CREDITS_INVALID");
  const note = input.note?.trim() || null;
  if (note && note.length > 280) throw new Error("RECHARGE_NOTE_INVALID");
  const now = timestamp();
  const request: RechargeRow = {
    id: createId(),
    user_id: input.userId,
    requested_credits: requestedCredits,
    note,
    status: "pending",
    processed_by: null,
    processed_at: null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    "INSERT INTO credit_recharge_requests (id, user_id, requested_credits, note, status, processed_by, processed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
    [request.id, request.user_id, requestedCredits, note, request.status, now, now],
  );
  return publicRecharge(request);
}

export async function adminCreditOverview() {
  const [wallets, requests] = await Promise.all([
    dbAll<WalletRow & { user_id: string; email: string }>(
      "SELECT user_credits.user_id, user_credits.balance, users.email FROM user_credits JOIN users ON users.id = user_credits.user_id ORDER BY user_credits.updated_at DESC LIMIT 100",
    ),
    dbAll<RechargeRow>(
      "SELECT credit_recharge_requests.*, users.email FROM credit_recharge_requests JOIN users ON users.id = credit_recharge_requests.user_id ORDER BY credit_recharge_requests.created_at DESC LIMIT 100",
    ),
  ]);
  return {
    wallets: wallets.map((wallet) => ({ userId: wallet.user_id, userEmail: wallet.email, balance: asInteger(wallet.balance) })),
    rechargeRequests: requests.map(publicRecharge),
  };
}

export async function approveRechargeRequest(input: { requestId: string; adminUserId: string }) {
  return dbTransaction(async (db) => {
    const request = await db.one<RechargeRow>("SELECT * FROM credit_recharge_requests WHERE id = ? LIMIT 1", [input.requestId]);
    if (!request) throw new Error("RECHARGE_REQUEST_NOT_FOUND");
    if (request.status !== "pending") throw new Error("RECHARGE_REQUEST_NOT_PENDING");
    const now = timestamp();
    const changed = await db.run(
      "UPDATE credit_recharge_requests SET status = 'approved', processed_by = ?, processed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      [input.adminUserId, now, now, request.id],
    );
    if (changed !== 1) throw new Error("RECHARGE_REQUEST_NOT_PENDING");
    await ensureWallet(request.user_id, db);
    const amount = asInteger(request.requested_credits);
    await db.run("UPDATE user_credits SET balance = balance + ?, updated_at = ? WHERE user_id = ?", [amount, now, request.user_id]);
    const wallet = await db.one<WalletRow>("SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1", [request.user_id]);
    await db.run(
      "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, task_id, recharge_request_id, created_at) VALUES (?, ?, ?, ?, 'recharge_approved', NULL, ?, ?)",
      [createId(), request.user_id, amount, asInteger(wallet?.balance), request.id, now],
    );
    return { request: publicRecharge({ ...request, status: "approved", processed_by: input.adminUserId, processed_at: now, updated_at: now }), balance: asInteger(wallet?.balance) };
  });
}

export async function rejectRechargeRequest(input: { requestId: string; adminUserId: string }) {
  return dbTransaction(async (db) => {
    const request = await db.one<RechargeRow>("SELECT * FROM credit_recharge_requests WHERE id = ? LIMIT 1", [input.requestId]);
    if (!request) throw new Error("RECHARGE_REQUEST_NOT_FOUND");
    if (request.status !== "pending") throw new Error("RECHARGE_REQUEST_NOT_PENDING");
    const now = timestamp();
    const changed = await db.run(
      "UPDATE credit_recharge_requests SET status = 'rejected', processed_by = ?, processed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      [input.adminUserId, now, now, request.id],
    );
    if (changed !== 1) throw new Error("RECHARGE_REQUEST_NOT_PENDING");
    return publicRecharge({ ...request, status: "rejected", processed_by: input.adminUserId, processed_at: now, updated_at: now });
  });
}

export function validRechargeStatus(value: string) {
  return rechargeStatuses.includes(value as (typeof rechargeStatuses)[number]);
}
