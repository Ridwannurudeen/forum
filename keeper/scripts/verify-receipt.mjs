#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const receiptUrlOrPath = process.argv[2];
if (!receiptUrlOrPath) {
  console.error(
    "usage: tsx keeper/scripts/verify-receipt.mjs <receipt-json-url-or-path> [expected-evidence-hash]",
  );
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const fileUrl = (p) => pathToFileURL(resolve(REPO_ROOT, p)).href;
const { receiptHash, verifyReceipt } = await import(
  fileUrl("keeper/src/receipt.ts")
);

async function loadReceipt(input) {
  if (/^https?:\/\//.test(input)) {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  }
  return JSON.parse(readFileSync(input, "utf8"));
}

const receipt = await loadReceipt(receiptUrlOrPath);
const hash = receiptHash(receipt);
const expected = process.argv[3];
const mismatch = verifyReceipt(receipt);

console.log(`receipt: ${receiptUrlOrPath}`);
console.log(`schema:  ${receipt.schema}`);
console.log(`botId:   ${receipt.botId}`);
console.log(`seq:     ${receipt.seq}`);
console.log(`hash:    ${hash}`);

if (expected) {
  const ok = hash.toLowerCase() === expected.toLowerCase();
  console.log(`chain:   ${expected}`);
  console.log(`match:   ${ok ? "yes" : "no"}`);
  if (!ok) process.exitCode = 1;
}

if (mismatch) {
  console.log(`pnl:     invalid (${mismatch})`);
  process.exitCode = 1;
} else {
  console.log("pnl:     valid");
}
