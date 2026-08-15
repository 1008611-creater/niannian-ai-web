import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import { pathToFileURL } from "node:url";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024;
const ENROLL_TIMEOUT_MS = 45_000;
const SECRET_PATTERN = /^[A-Za-z0-9]{8,128}$/;
const READY_MARKER = "NIANNIAN_COS_ENCRYPTED_CREDENTIALS_READY";

function securityHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function htmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function page(csrfToken, message = "") {
  const safeToken = htmlEscape(csrfToken);
  const safeMessage = htmlEscape(message);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>念念 AI · COS 凭据录入</title>
<style>
:root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f3f5f8;color:#172033}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(480px,100%);background:#fff;border:1px solid #dce2ea;border-radius:18px;padding:28px;box-shadow:0 18px 60px #19233b18}h1{font-size:24px;margin:0 0 8px}p{line-height:1.6;color:#536078;margin:0 0 22px}label{display:block;font-weight:650;margin:16px 0 7px}input{width:100%;padding:12px 14px;border:1px solid #bac4d2;border-radius:10px;font:inherit}input:focus{outline:3px solid #326cff2b;border-color:#326cff}button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;background:#275ee7;color:#fff;font:700 16px inherit;cursor:pointer}.note{font-size:13px;margin-top:16px;color:#6c7587}.message{padding:11px 13px;border-radius:9px;background:#fff2f2;color:#a52c2c;margin-bottom:14px}
</style></head><body><main class="card"><h1>录入腾讯 COS 凭据</h1><p>内容只会通过本机 SSH 标准输入送到服务器，并由 systemd 加密保存。本网页不写磁盘、不记日志，成功后自动关闭服务。</p>${safeMessage ? `<div class="message" role="alert">${safeMessage}</div>` : ""}<form method="post" action="/enroll" autocomplete="off"><input type="hidden" name="csrf" value="${safeToken}"><label for="secretId">SecretId</label><input id="secretId" name="secretId" type="password" minlength="8" maxlength="128" pattern="[A-Za-z0-9]+" required autocomplete="off" spellcheck="false"><label for="secretKey">SecretKey</label><input id="secretKey" name="secretKey" type="password" minlength="8" maxlength="128" pattern="[A-Za-z0-9]+" required autocomplete="off" spellcheck="false"><button type="submit">加密保存到服务器</button></form><p class="note">请从腾讯云当前创建成功页复制两项。不要关闭这个页面，提交成功后会明确显示结果。</p></main></body></html>`;
}

function successPage() {
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>已完成</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f3f5f8;color:#172033}.card{background:white;padding:32px;border-radius:18px;box-shadow:0 18px 60px #19233b18}h1{color:#137a42}</style></head><body><main class=\"card\"><h1>凭据已安全保存</h1><p>本机录入服务已经关闭，可以关闭此页。</p></main></body></html>";
}

function tokensEqual(received, expected) {
  const left = Buffer.from(received, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.destroy();
      const error = new Error("BODY_TOO_LARGE");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function runRemoteEnrollment(secretId, secretKey) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-T", "tencent-niannian", "sudo", "--", "/usr/local/sbin/niannian-enroll-cos-credentials", "--stdin"],
      { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let stdout = "";
    let stderrBytes = 0;
    const timeout = setTimeout(() => child.kill(), ENROLL_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 256) stdout += chunk.slice(0, 256 - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(error.code === "ENOENT" ? "SSH_NOT_FOUND" : "SSH_START_FAILED"));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim() === READY_MARKER) resolve();
      else reject(new Error(signal ? "SSH_ENROLL_TIMEOUT" : `REMOTE_ENROLL_FAILED_${code ?? "UNKNOWN"}_${stderrBytes > 0 ? "WITH_DIAGNOSTIC" : "NO_DIAGNOSTIC"}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${secretId}\n${secretKey}\n`, "utf8");
  });
}

export async function createEnrollmentServer({ runEnrollment = runRemoteEnrollment } = {}) {
  const csrfToken = randomBytes(32).toString("base64url");
  let expectedHost = "";
  let consumed = false;
  let enrolling = false;

  const server = http.createServer(async (request, response) => {
    const reply = (status, body, type = "text/html; charset=utf-8") => {
      response.writeHead(status, { ...securityHeaders(), "Content-Type": type });
      response.end(body);
    };
    const remote = request.socket.remoteAddress;
    if (remote !== LOOPBACK_HOST && remote !== `::ffff:${LOOPBACK_HOST}`) return reply(403, "Forbidden", "text/plain; charset=utf-8");
    if (request.headers.host !== expectedHost) return reply(400, "Invalid host", "text/plain; charset=utf-8");

    if (request.method === "GET" && request.url === "/") return reply(200, page(csrfToken));
    if (request.method !== "POST" || request.url !== "/enroll") return reply(404, "Not found", "text/plain; charset=utf-8");
    if (consumed || enrolling) return reply(409, "Enrollment already used", "text/plain; charset=utf-8");
    const expectedOrigin = `http://${expectedHost}`;
    const originAccepted = request.headers.origin === expectedOrigin
      || (request.headers.origin === "null" && request.headers["sec-fetch-site"] === "same-origin");
    if (!originAccepted) return reply(403, "Invalid origin", "text/plain; charset=utf-8");
    if (request.headers["content-type"] !== "application/x-www-form-urlencoded") return reply(415, "Unsupported media type", "text/plain; charset=utf-8");

    let rawBody;
    try {
      rawBody = await readBody(request);
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE" && !response.destroyed) reply(413, "Request too large", "text/plain; charset=utf-8");
      return;
    }

    const fields = new URLSearchParams(rawBody);
    const csrfValues = fields.getAll("csrf");
    const idValues = fields.getAll("secretId");
    const keyValues = fields.getAll("secretKey");
    if (csrfValues.length !== 1 || !tokensEqual(csrfValues[0], csrfToken)) return reply(403, "Invalid request token", "text/plain; charset=utf-8");
    if (idValues.length !== 1 || keyValues.length !== 1 || !SECRET_PATTERN.test(idValues[0]) || !SECRET_PATTERN.test(keyValues[0])) return reply(400, page(csrfToken, "格式不正确：两项都必须是 8–128 位字母或数字。"));

    enrolling = true;
    try {
      await runEnrollment(idValues[0], keyValues[0]);
      consumed = true;
      reply(200, successPage());
      response.once("finish", () => server.close());
    } catch {
      reply(502, page(csrfToken, "服务器加密保存失败。页面未保存凭据，请检查 SSH 后重试。"));
    } finally {
      rawBody = "";
      idValues.fill("");
      keyValues.fill("");
      enrolling = false;
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, resolve);
  });
  const address = server.address();
  expectedHost = `${LOOPBACK_HOST}:${address.port}`;
  return { server, url: `http://${expectedHost}/`, csrfToken };
}

async function main() {
  const { server, url } = await createEnrollmentServer();
  server.on("error", () => process.exitCode = 1);
  process.stdout.write(`${url}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("LOCAL_ENROLLMENT_WEB_FAILED\n");
    process.exitCode = 1;
  });
}
