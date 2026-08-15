import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createEnrollmentServer } from "./niannian-cos-local-enrollment-web.mjs";

async function fixture(runEnrollment = async () => {}) {
  const instance = await createEnrollmentServer({ runEnrollment });
  return {
    ...instance,
    close: async () => {
      if (!instance.server.listening) return;
      instance.server.close();
      await once(instance.server, "close");
    },
  };
}

function form(csrf, secretId = "A12345678", secretKey = "B12345678") {
  return new URLSearchParams({ csrf, secretId, secretKey }).toString();
}

test("serves only loopback page with hardened response headers", async (t) => {
  const app = await fixture();
  t.after(app.close);
  const response = await fetch(app.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  const html = await response.text();
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /method="post" action="\/enroll"/);
});

test("rejects invalid CSRF without invoking enrollment", async (t) => {
  let calls = 0;
  const app = await fixture(async () => { calls += 1; });
  t.after(app.close);
  const origin = new URL(app.url).origin;
  const response = await fetch(`${origin}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: form("wrong-token"),
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("accepts an opaque in-app-browser origin only with same-origin fetch metadata", async () => {
  let calls = 0;
  const app = await fixture(async () => { calls += 1; });
  const origin = new URL(app.url).origin;
  const response = await fetch(`${origin}/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "null",
      "Sec-Fetch-Site": "same-origin",
    },
    body: form(app.csrfToken),
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  if (app.server.listening) await once(app.server, "close");
});

test("rejects an opaque origin without same-origin fetch metadata", async (t) => {
  let calls = 0;
  const app = await fixture(async () => { calls += 1; });
  t.after(app.close);
  const origin = new URL(app.url).origin;
  const response = await fetch(`${origin}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "null" },
    body: form(app.csrfToken),
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("rejects oversized and malformed credential bodies", async (t) => {
  let calls = 0;
  const app = await fixture(async () => { calls += 1; });
  t.after(app.close);
  const origin = new URL(app.url).origin;
  const oversized = await fetch(`${origin}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: `csrf=${"x".repeat(1200)}`,
  }).catch((error) => error);
  assert.ok(oversized instanceof Error || oversized.status === 413);
  const malformed = await fetch(`${origin}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: form(app.csrfToken, "bad-id!", "validKey123"),
  });
  assert.equal(malformed.status, 400);
  assert.equal(calls, 0);
});

test("passes secrets only to injected enrollment function and closes after success", async () => {
  const received = [];
  const app = await fixture(async (...values) => { received.push(values); });
  const origin = new URL(app.url).origin;
  const secretId = "ExampleSecretId123";
  const secretKey = "ExampleSecretKey456";
  const response = await fetch(`${origin}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: form(app.csrfToken, secretId, secretKey),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(`${secretId}|${secretKey}`));
  assert.deepEqual(received, [[secretId, secretKey]]);
  if (app.server.listening) await once(app.server, "close");
});
