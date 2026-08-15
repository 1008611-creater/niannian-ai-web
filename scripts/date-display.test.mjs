import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTime } from "../lib/date-display.ts";

test("valid timestamps render while malformed timestamps use a clear fallback", () => {
  assert.notEqual(formatDateTime("2026-07-27T08:28:57.109Z"), "时间待同步");
  assert.equal(formatDateTime('2026-07-27"T"08:28:57.109"Z"'), "时间待同步");
  assert.equal(formatDateTime(null), "时间待同步");
});
