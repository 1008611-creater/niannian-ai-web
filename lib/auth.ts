import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import initSqlJs, { Database } from "sql.js";

const scrypt = promisify(scryptCallback);
const DATABASE_PATH = path.join(process.cwd(), "data", "niannian-auth.sqlite");
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const OTP_TTL_SECONDS = 60 * 10;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

type OtpPurpose = "register" | "password_reset";
type SqlDatabase = Database;
type PostgresPool = {
  query: (query: string, values?: SqlValue[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect: () => Promise<PostgresClient>;
};
type PostgresClient = {
  query: (query: string, values?: SqlValue[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  release: () => void;
};
type SqlValue = string | number | null;
export type DatabaseTransaction = {
  run: (sql: string, values?: SqlValue[]) => Promise<number>;
  one: <T>(sql: string, values?: SqlValue[]) => Promise<T | null>;
  all: <T>(sql: string, values?: SqlValue[]) => Promise<T[]>;
};
type OtpRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
  attempt_count: number;
  max_attempts: number;
  send_count: number;
  last_sent_at: string;
};
type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
};
type CountRow = { count: number | string };
type OtpVerificationResult =
  | { otp: OtpRow }
  | {
      error:
        | "OTP_CONSUMED"
        | "OTP_EXPIRED"
        | "OTP_TOO_MANY_ATTEMPTS"
        | "OTP_INVALID";
    };

declare global {
  var niannianAuthDatabase: Promise<SqlDatabase> | undefined;
  var niannianAuthPostgres: Promise<PostgresPool> | undefined;
}

function now() {
  return new Date().toISOString();
}

function id() {
  return randomBytes(18).toString("base64url");
}

function localMode() {
  return process.env.AUTH_MAIL_MODE === "local";
}

function secret(name: "AUTH_OTP_PEPPER" | "AUTH_SESSION_SECRET") {
  const value = process.env[name];
  if (value) return value;
  if (localMode()) return `niannian-local-${name}-replace-before-deploy`;
  throw new Error(`${name} is required outside local mail mode`);
}

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '准备中',
    episodes INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_user_updated
    ON projects(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS canvas_documents (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS canvas_documents_user_updated
    ON canvas_documents(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS uploaded_assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    local_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS uploaded_assets_user_created
    ON uploaded_assets(user_id, created_at);
  -- Library visibility is reversible presentation state. The uploaded asset
  -- row and bytes remain immutable for every locked historical task.
  CREATE TABLE IF NOT EXISTS asset_library_visibility (
    asset_id TEXT PRIMARY KEY REFERENCES uploaded_assets(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS asset_library_visibility_user_hidden
    ON asset_library_visibility(user_id, hidden, updated_at);
  -- Metadata is additive so historical uploaded_assets rows and task manifests
  -- remain readable while newer tasks can express multi-reference intent.
  CREATE TABLE IF NOT EXISTS asset_reference_metadata (
    asset_id TEXT PRIMARY KEY REFERENCES uploaded_assets(id) ON DELETE CASCADE,
    reference_intent TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    chinese_duty TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS video_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    channel TEXT NOT NULL,
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    resolution TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    aspect_ratio TEXT NOT NULL,
    asset_manifest TEXT NOT NULL,
    task_spec_path TEXT NOT NULL,
    status TEXT NOT NULL,
    blocker TEXT,
    provider_task_id TEXT,
    output_path TEXT,
    submit_allowed INTEGER NOT NULL DEFAULT 0,
    cost_authorized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS video_tasks_user_updated
    ON video_tasks(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS project_assets (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES uploaded_assets(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, asset_id)
  );
  CREATE INDEX IF NOT EXISTS project_assets_project_created
    ON project_assets(project_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS project_task_links (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES video_tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, task_id)
  );
  CREATE INDEX IF NOT EXISTS project_task_links_project_created
    ON project_task_links(project_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS script_workflow_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    requirements TEXT NOT NULL,
    canonical_project_id TEXT,
    status TEXT NOT NULL,
    blocker TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS script_workflow_requests_project_updated
    ON script_workflow_requests(project_id, updated_at DESC);
  -- Product names are public. Provider channels remain administrator-only
  -- routing decisions resolved when a new task is created.
  CREATE TABLE IF NOT EXISTS product_routing (
    product_code TEXT PRIMARY KEY,
    channel TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS video_task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    event TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS video_task_events_task_created
    ON video_task_events(task_id, created_at);
  -- Channel state deliberately stores operational readbacks only.  Browser
  -- credentials, cookies, OAuth data and one-time codes never enter this DB.
  CREATE TABLE IF NOT EXISTS channel_sessions (
    channel TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    visible_project_url TEXT,
    credit_readback TEXT,
    model_readback TEXT,
    last_preflight_at TEXT,
    last_success_at TEXT,
    last_blocker TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_handoffs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    action TEXT NOT NULL,
    state TEXT NOT NULL,
    instructions TEXT NOT NULL,
    browser_url TEXT,
    resume_from TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS channel_handoffs_task_state
    ON channel_handoffs(task_id, state, created_at DESC);
  CREATE TABLE IF NOT EXISTS channel_execution_receipts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL,
    ledger_path TEXT,
    output_path TEXT,
    media_probe_passed INTEGER NOT NULL DEFAULT 0,
    content_qa_passed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS redraw_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    idempotency_key TEXT NOT NULL,
    source_asset_id TEXT NOT NULL,
    reference_asset_ids TEXT NOT NULL,
    requirements_json TEXT NOT NULL,
    skill_bundle_version TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    plan_json TEXT,
    provider_transaction_key TEXT NOT NULL,
    provider_task_id TEXT,
    output_artifact_id TEXT,
    qa_json TEXT,
    blocker TEXT,
    worker_claim_token TEXT,
    worker_claimed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS redraw_jobs_user_idempotency
    ON redraw_jobs(user_id, idempotency_key);
  CREATE UNIQUE INDEX IF NOT EXISTS redraw_jobs_provider_transaction
    ON redraw_jobs(provider_transaction_key);
  CREATE INDEX IF NOT EXISTS redraw_jobs_user_updated
    ON redraw_jobs(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS redraw_jobs_status_updated
    ON redraw_jobs(status, updated_at ASC);
  CREATE TABLE IF NOT EXISTS redraw_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    transaction_key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL,
    input_urls_json TEXT,
    output_sha256 TEXT,
    qa_json TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(job_id, attempt_number)
  );
  CREATE INDEX IF NOT EXISTS redraw_attempts_job_number
    ON redraw_attempts(job_id, attempt_number);
  CREATE TABLE IF NOT EXISTS redraw_artifacts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    object_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS redraw_artifacts_job_role_sha
    ON redraw_artifacts(job_id, role, sha256);
  CREATE INDEX IF NOT EXISTS redraw_artifacts_job_created
    ON redraw_artifacts(job_id, created_at);
  CREATE TABLE IF NOT EXISTS redraw_job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    event TEXT NOT NULL,
    public_status TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS redraw_job_events_job_created
    ON redraw_job_events(job_id, created_at);
  CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    task_id TEXT,
    recharge_request_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_ledger_user_created
    ON credit_ledger(user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_task_reason_unique
    ON credit_ledger(task_id, reason)
    WHERE task_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_recharge_unique
    ON credit_ledger(recharge_request_id)
    WHERE recharge_request_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS credit_recharge_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    requested_credits INTEGER NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    processed_by TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_recharge_requests_user_created
    ON credit_recharge_requests(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS credit_recharge_requests_status_created
    ON credit_recharge_requests(status, created_at ASC);
  CREATE TABLE IF NOT EXISTS credit_redemptions (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    redeemed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_redemptions_user_redeemed
    ON credit_redemptions(user_id, redeemed_at DESC);
  CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    send_count INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT NOT NULL,
    ip_hash TEXT,
    user_agent_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS otp_lookup
    ON otp_codes(email, purpose, consumed_at, expires_at);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_lookup
    ON sessions(token_hash, expires_at);
  CREATE TABLE IF NOT EXISTS auth_audit (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    email_hash TEXT NOT NULL,
    ip_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_rate_events (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_rate_events_lookup
    ON auth_rate_events(key_hash, created_at);
`;

async function database() {
  if (!globalThis.niannianAuthDatabase) {
    globalThis.niannianAuthDatabase = (async () => {
      const SQL = await initSqlJs({
        locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
      });
      let bytes: Uint8Array | undefined;
      try {
        bytes = await readFile(DATABASE_PATH);
      } catch {
        // First boot creates a new local database.
      }
      const db = new SQL.Database(bytes);
      db.run(schema);
      return db;
    })();
  }
  return globalThis.niannianAuthDatabase;
}

function postgresSql(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function postgres() {
  if (!process.env.DATABASE_URL) return null;
  if (!globalThis.niannianAuthPostgres) {
    globalThis.niannianAuthPostgres = (async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      });
      await pool.query(schema);
      return pool;
    })();
  }
  return globalThis.niannianAuthPostgres;
}

async function persist(db: SqlDatabase) {
  await mkdir(path.dirname(DATABASE_PATH), { recursive: true });
  const temporary = `${DATABASE_PATH}.tmp`;
  await writeFile(temporary, db.export());
  await rename(temporary, DATABASE_PATH);
}

async function run(sql: string, values: SqlValue[] = []) {
  const pool = await postgres();
  if (pool) {
    const result = await pool.query(postgresSql(sql), values);
    return result.rowCount ?? 0;
  }
  const db = await database();
  db.run(sql, values);
  await persist(db);
  return db.getRowsModified();
}

async function one<T>(sql: string, values: SqlValue[] = []) {
  const pool = await postgres();
  if (pool) {
    const result = await pool.query(postgresSql(sql), values);
    return (result.rows[0] as T | undefined) ?? null;
  }
  const db = await database();
  const statement = db.prepare(sql);
  statement.bind(values);
  const result = statement.step() ? (statement.getAsObject() as T) : null;
  statement.free();
  return result;
}

async function all<T>(sql: string, values: SqlValue[] = []) {
  const pool = await postgres();
  if (pool) {
    const result = await pool.query(postgresSql(sql), values);
    return result.rows as T[];
  }
  const db = await database();
  const statement = db.prepare(sql);
  statement.bind(values);
  const rows: T[] = [];
  while (statement.step()) rows.push(statement.getAsObject() as T);
  statement.free();
  return rows;
}

export async function dbRun(sql: string, values: SqlValue[] = []) {
  await run(sql, values);
}

export async function dbRunCount(sql: string, values: SqlValue[] = []) {
  return run(sql, values);
}

export async function dbOne<T>(sql: string, values: SqlValue[] = []) {
  return one<T>(sql, values);
}

export async function dbAll<T>(sql: string, values: SqlValue[] = []) {
  return all<T>(sql, values);
}

export async function dbTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>) {
  const pool = await postgres();
  if (pool) {
    const client = await pool.connect();
    const transaction: DatabaseTransaction = {
      run: async (sql, values = []) => (await client.query(postgresSql(sql), values)).rowCount ?? 0,
      one: async <Result>(sql: string, values: SqlValue[] = []) => {
        const result = await client.query(postgresSql(sql), values);
        return (result.rows[0] as Result | undefined) ?? null;
      },
      all: async <Result>(sql: string, values: SqlValue[] = []) => (await client.query(postgresSql(sql), values)).rows as Result[],
    };
    await client.query("BEGIN");
    try {
      const result = await work(transaction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const db = await database();
  const transaction: DatabaseTransaction = {
    run: async (sql, values = []) => {
      db.run(sql, values);
      return db.getRowsModified();
    },
    one: async <Result>(sql: string, values: SqlValue[] = []) => {
      const statement = db.prepare(sql);
      statement.bind(values);
      const result = statement.step() ? (statement.getAsObject() as Result) : null;
      statement.free();
      return result;
    },
    all: async <Result>(sql: string, values: SqlValue[] = []) => {
      const statement = db.prepare(sql);
      statement.bind(values);
      const rows: Result[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as Result);
      statement.free();
      return rows;
    },
  };
  db.run("BEGIN IMMEDIATE");
  try {
    const result = await work(transaction);
    db.run("COMMIT");
    await persist(db);
    return result;
  } catch (error) {
    try { db.run("ROLLBACK"); } catch { /* Transaction did not start or was already closed. */ }
    throw error;
  }
}

export function createId() {
  return id();
}

export function timestamp() {
  return now();
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function validPassword(value: unknown) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /[a-zA-Z]/.test(value) &&
    /\d/.test(value)
  );
}

async function passwordHash(password: string, salt = randomBytes(16).toString("base64url")) {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: derived.toString("base64url") };
}

async function verifyPassword(password: string, hash: string, salt: string) {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "base64url");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function otpHash(email: string, purpose: OtpPurpose, code: string) {
  return createHmac("sha256", secret("AUTH_OTP_PEPPER"))
    .update(`${email}:${purpose}:${code}`)
    .digest("hex");
}

function opaqueHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function validRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/+$/, "");
  if (configuredOrigin) return origin === configuredOrigin;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  const protocol = request.headers.get("x-forwarded-proto") ?? "http";
  return origin === `${protocol}://${host}`;
}

async function rateLimited(key: string, limit: number, windowMs = 15 * 60 * 1000) {
  const timestamp = now();
  const keyHash = opaqueHash(key);
  await run("INSERT INTO auth_rate_events (id, key_hash, created_at) VALUES (?, ?, ?)", [
    id(),
    keyHash,
    timestamp,
  ]);
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = await one<CountRow>(
    "SELECT COUNT(*) AS count FROM auth_rate_events WHERE key_hash = ? AND created_at > ?",
    [keyHash, cutoff],
  );
  if (randomInt(0, 100) === 0) {
    await run("DELETE FROM auth_rate_events WHERE created_at <= ?", [
      new Date(Date.now() - RATE_LIMIT_RETENTION_MS).toISOString(),
    ]);
  }
  return Number(row?.count ?? 0) > limit;
}

async function audit(event: string, email: string, ip: string) {
  await run(
    "INSERT INTO auth_audit (id, event, email_hash, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    [id(), event, opaqueHash(email), opaqueHash(ip), now()],
  );
}

async function sendCode(email: string, code: string, purpose: OtpPurpose) {
  if (localMode()) {
    console.info(`[niannian-auth local mail] ${purpose} verification code for ${email}: ${code}`);
    return;
  }
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  if (!host || !user || !pass || !from) throw new Error("MAIL_DELIVERY_FAILED");
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  const isReset = purpose === "password_reset";
  await transport.sendMail({
    from,
    to: email,
    subject: isReset ? "念念AI视频工作台 重置密码验证码" : "念念AI视频工作台 注册验证码",
    text: `你的念念AI视频工作台${isReset ? "重置密码" : "注册"}验证码是 ${code}，10分钟内有效。若非本人操作，请忽略本邮件。`,
  });
}

async function issueOtp(input: {
  email: string;
  purpose: OtpPurpose;
  credential: { hash: string; salt: string };
  ip: string;
  userAgent: string | null;
  sendCount?: number;
}) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const timestamp = now();
  const otpId = id();
  await run(
    "INSERT INTO otp_codes (id, email, purpose, password_hash, password_salt, code_hash, expires_at, consumed_at, attempt_count, max_attempts, send_count, last_sent_at, ip_hash, user_agent_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)",
    [
      otpId,
      input.email,
      input.purpose,
      input.credential.hash,
      input.credential.salt,
      otpHash(input.email, input.purpose, code),
      new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
      OTP_MAX_ATTEMPTS,
      input.sendCount ?? 1,
      timestamp,
      opaqueHash(input.ip),
      opaqueHash(input.userAgent ?? ""),
      timestamp,
      timestamp,
    ],
  );
  try {
    await sendCode(input.email, code, input.purpose);
  } catch {
    await run("DELETE FROM otp_codes WHERE id = ?", [otpId]);
    return false;
  }
  await run(
    "UPDATE otp_codes SET consumed_at = ?, updated_at = ? WHERE email = ? AND purpose = ? AND id <> ? AND consumed_at IS NULL",
    [timestamp, timestamp, input.email, input.purpose, otpId],
  );
  return true;
}

async function resendOtp(email: string, purpose: OtpPurpose, ip: string) {
  const previous = await one<OtpRow>(
    "SELECT * FROM otp_codes WHERE email = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [email, purpose],
  );
  if (!previous) return { error: "OTP_REQUIRED" as const };
  const elapsed = Math.floor((Date.now() - Date.parse(previous.last_sent_at)) / 1000);
  if (elapsed < OTP_COOLDOWN_SECONDS) {
    return {
      error: "OTP_RESEND_COOLDOWN" as const,
      cooldownSeconds: OTP_COOLDOWN_SECONDS - elapsed,
    };
  }
  if (
    (await rateLimited(`resend:${purpose}:${email}`, 5)) ||
    (await rateLimited(`resend:${purpose}:ip:${ip}`, 20))
  ) {
    return { error: "OTP_RATE_LIMITED" as const };
  }
  const delivered = await issueOtp({
    email,
    purpose,
    credential: { hash: previous.password_hash, salt: previous.password_salt },
    ip,
    userAgent: null,
    sendCount: previous.send_count + 1,
  });
  if (!delivered) return { error: "MAIL_DELIVERY_FAILED" as const };
  await audit(`${purpose}_code_resent`, email, ip);
  return { cooldownSeconds: OTP_COOLDOWN_SECONDS, expiresInSeconds: OTP_TTL_SECONDS };
}

async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  code: string,
  ip: string,
): Promise<OtpVerificationResult> {
  const otp = await one<OtpRow>(
    "SELECT * FROM otp_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
    [email, purpose],
  );
  if (!otp || otp.consumed_at) return { error: "OTP_CONSUMED" as const };
  if (Date.parse(otp.expires_at) <= Date.now()) return { error: "OTP_EXPIRED" as const };
  if (otp.attempt_count >= otp.max_attempts) return { error: "OTP_TOO_MANY_ATTEMPTS" as const };
  const receivedHash = otpHash(email, purpose, code);
  const validFormat = /^[0-9]{6}$/.test(code);
  const validHash =
    validFormat &&
    receivedHash.length === otp.code_hash.length &&
    timingSafeEqual(Buffer.from(otp.code_hash), Buffer.from(receivedHash));
  if (!validHash) {
    await run("UPDATE otp_codes SET attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?", [
      now(),
      otp.id,
    ]);
    await audit(`${purpose}_code_failed`, email, ip);
    return { error: "OTP_INVALID" as const };
  }
  return { otp };
}

export async function startRegistration(
  email: string,
  password: string,
  ip: string,
  userAgent: string | null,
) {
  if (await one<UserRow>("SELECT id FROM users WHERE email = ?", [email])) {
    return { error: "EMAIL_ALREADY_REGISTERED" as const };
  }
  if (
    (await rateLimited(`register:${email}`, 5)) ||
    (await rateLimited(`register:ip:${ip}`, 20))
  ) {
    return { error: "OTP_RATE_LIMITED" as const };
  }
  const credential = await passwordHash(password);
  const delivered = await issueOtp({
    email,
    purpose: "register",
    credential,
    ip,
    userAgent,
  });
  if (!delivered) return { error: "MAIL_DELIVERY_FAILED" as const };
  await audit("register_code_sent", email, ip);
  return { cooldownSeconds: OTP_COOLDOWN_SECONDS, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function resendRegistrationCode(email: string, ip: string) {
  return resendOtp(email, "register", ip);
}

export async function verifyRegistration(email: string, code: string, ip: string) {
  const verified = await verifyOtp(email, "register", code, ip);
  if (!("otp" in verified)) return verified;
  const userId = id();
  try {
    await run(
      "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
      [userId, email, verified.otp.password_hash, verified.otp.password_salt, now()],
    );
  } catch {
    return { error: "EMAIL_ALREADY_REGISTERED" as const };
  }
  await run("UPDATE otp_codes SET consumed_at = ?, updated_at = ? WHERE id = ?", [
    now(),
    now(),
    verified.otp.id,
  ]);
  await audit("register_verified", email, ip);
  return { user: { id: userId, email } };
}

export async function startPasswordReset(
  email: string,
  newPassword: string,
  ip: string,
  userAgent: string | null,
) {
  if (
    (await rateLimited(`password-reset:${email}`, 5)) ||
    (await rateLimited(`password-reset:ip:${ip}`, 20))
  ) {
    return { error: "OTP_RATE_LIMITED" as const };
  }
  const credential = await passwordHash(newPassword);
  const user = await one<UserRow>("SELECT id FROM users WHERE email = ?", [email]);
  if (user) {
    const delivered = await issueOtp({
      email,
      purpose: "password_reset",
      credential,
      ip,
      userAgent,
    });
    if (!delivered) return { error: "MAIL_DELIVERY_FAILED" as const };
    await audit("password_reset_code_sent", email, ip);
  } else {
    await audit("password_reset_requested_unknown", email, ip);
  }
  return { cooldownSeconds: OTP_COOLDOWN_SECONDS, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function resendPasswordResetCode(email: string, ip: string) {
  const result = await resendOtp(email, "password_reset", ip);
  if ("error" in result && result.error === "OTP_REQUIRED") {
    return { cooldownSeconds: OTP_COOLDOWN_SECONDS, expiresInSeconds: OTP_TTL_SECONDS };
  }
  return result;
}

export async function verifyPasswordReset(email: string, code: string, ip: string) {
  const verified = await verifyOtp(email, "password_reset", code, ip);
  if (!("otp" in verified)) return verified;
  const user = await one<UserRow>("SELECT id FROM users WHERE email = ?", [email]);
  if (!user) return { error: "OTP_INVALID" as const };
  const timestamp = now();
  await run("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?", [
    verified.otp.password_hash,
    verified.otp.password_salt,
    user.id,
  ]);
  await run("UPDATE otp_codes SET consumed_at = ?, updated_at = ? WHERE id = ?", [
    timestamp,
    timestamp,
    verified.otp.id,
  ]);
  await run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [
    timestamp,
    user.id,
  ]);
  await audit("password_reset_verified", email, ip);
  return { ok: true };
}

export async function login(email: string, password: string, ip: string) {
  if (
    (await rateLimited(`login:${email}`, 10)) ||
    (await rateLimited(`login:ip:${ip}`, 40))
  ) {
    return { error: "LOGIN_RATE_LIMITED" as const };
  }
  const user = await one<UserRow>(
    "SELECT id, email, password_hash, password_salt FROM users WHERE email = ?",
    [email],
  );
  if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
    await audit("login_failed", email, ip);
    return { error: "LOGIN_INVALID" as const };
  }
  await audit("login_succeeded", email, ip);
  return { user: { id: user.id, email: user.email } };
}

export async function createSession(user: { id: string; email: string }) {
  const token = randomBytes(32).toString("base64url");
  await run(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    [
      id(),
      user.id,
      opaqueHash(`${secret("AUTH_SESSION_SECRET")}:${token}`),
      new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
      now(),
    ],
  );
  return { token, maxAge: SESSION_TTL_SECONDS, email: user.email };
}

export async function sessionFromToken(token: string | undefined) {
  if (!token) return null;
  const row = await one<{ id: string; email: string }>(
    "SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ?",
    [opaqueHash(`${secret("AUTH_SESSION_SECRET")}:${token}`), now()],
  );
  return row ? { id: row.id, email: row.email } : null;
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  await run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", [
    now(),
    opaqueHash(`${secret("AUTH_SESSION_SECRET")}:${token}`),
  ]);
}

export const authCookie = "niannian_session";
