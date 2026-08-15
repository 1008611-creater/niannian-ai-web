import { createHmac, randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const allowedPackages = new Set([100, 300, 500, 1000]);
const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));
const credits = Number(args.credits);
const count = Number(args.count ?? 100);
const output = args.output ? path.resolve(args.output) : null;
const secret = process.env.LDXP_REDEEM_SECRET;

if (!allowedPackages.has(credits)) throw new Error("LDXP_PACKAGE_INVALID");
if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error("LDXP_CODE_COUNT_INVALID");
if (!output) throw new Error("LDXP_OUTPUT_PATH_REQUIRED");
if (!secret || secret.length < 32) throw new Error("LDXP_REDEEM_SECRET_REQUIRED");

const codes = new Set();
while (codes.size < count) {
  const nonce = randomBytes(12).toString("hex").toUpperCase();
  const payload = `NN-${credits}-${nonce}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32).toUpperCase();
  codes.add(`${payload}-${signature}`);
}

await writeFile(output, `${[...codes].join("\r\n")}\r\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
if (process.platform !== "win32") await chmod(output, 0o600);
console.log(JSON.stringify({ output, credits, count: codes.size }));
