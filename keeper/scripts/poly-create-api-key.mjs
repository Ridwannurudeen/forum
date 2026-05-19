#!/usr/bin/env node
// Phase 3 prerequisite — bootstrap Polymarket CLOB API creds against a
// fresh mainnet EOA. Two phases:
//
//   dry-run (default): generate a viem account in memory, print its
//   address + the steps that WOULD run. No files written. No HTTPS
//   call. No state persisted anywhere.
//
//   --confirm: actually generate + persist signer.key, instantiate
//   ClobClient on Polygon mainnet, call createOrDeriveApiKey(), and
//   write the 3 returned files. Real network call to Polymarket.
//
// Files written (mode 600, root-only):
//   /root/.poly-keys/signer.key       — 0x-prefixed 32-byte private key
//   /root/.poly-keys/api-key
//   /root/.poly-keys/api-secret
//   /root/.poly-keys/api-passphrase
//
// The wallet has ZERO USDC and ZERO POL after this script runs. Funding
// is a separate user action (CEX withdrawal → Polygon, or bridge).

import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { polygon } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const CONFIRM = process.argv.includes("--confirm");
const KEY_DIR = process.env.POLY_KEYS_DIR ?? "/root/.poly-keys";

// Reuse an existing signer.key if it's already on disk — calling
// createOrDeriveApiKey() against an existing wallet returns the same creds
// (Polymarket's API is idempotent per-wallet). Important for re-runs after
// partial failures.
let pk;
let source;
const existingKey = `${KEY_DIR}/signer.key`;
if (existsSync(existingKey)) {
  pk = readFileSync(existingKey, "utf8").trim();
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  source = "existing signer.key";
} else {
  pk = generatePrivateKey();
  source = "fresh in-memory generation";
}

const account = privateKeyToAccount(pk);
console.log(`signer source: ${source}`);
console.log(`signer addr:   ${account.address}`);
console.log(`chain:         polygon mainnet (137)`);
console.log(`clob host:     https://clob.polymarket.com`);
console.log(`key dir:       ${KEY_DIR}`);
console.log(``);

if (!CONFIRM) {
  console.log("DRY-RUN — no files written, no Polymarket API call made.");
  console.log("Re-run with --confirm to:");
  console.log(`  1. Persist signer.key to ${existingKey} (mode 600)`);
  console.log(`  2. POST clob-client-v2.createOrDeriveApiKey() to Polymarket`);
  console.log(`  3. Persist api-key / api-secret / api-passphrase (mode 600)`);
  console.log(``);
  console.log(`After --confirm, fund ${account.address} with:`);
  console.log(`  - Polygon USDC (bridged USDC, not USDC.e):  >= 5 USDC`);
  console.log(`  - POL for gas:                              >= 0.5 POL`);
  process.exit(0);
}

mkdirSync(KEY_DIR, { recursive: true });
chmodSync(KEY_DIR, 0o700);

// Persist signer.key BEFORE the API call, so a partial-success leaves the
// key on disk and a re-run with the same key is idempotent.
if (!existsSync(existingKey)) {
  writeFileSync(existingKey, pk, { mode: 0o600 });
  console.log(`wrote ${existingKey}`);
}

const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(),
});

const clob = await import(pathToFileURL(
  resolve("keeper/node_modules/@polymarket/clob-client-v2/dist/index.cjs"),
).href);

const Client = clob.ClobClient ?? clob.default?.ClobClient ?? clob.default;
if (!Client) {
  console.error("could not locate ClobClient export — SDK shape changed?");
  process.exit(1);
}

const client = new Client({
  host: "https://clob.polymarket.com",
  chain: 137,
  signer: walletClient,
});

console.log("calling clob.createOrDeriveApiKey() ...");
const creds = await client.createOrDeriveApiKey();
console.log("received creds (will persist; not echoing values):");
console.log(`  key length:         ${creds.key?.length}`);
console.log(`  secret length:      ${creds.secret?.length}`);
console.log(`  passphrase length:  ${creds.passphrase?.length}`);

for (const [name, value] of [
  ["api-key", creds.key],
  ["api-secret", creds.secret],
  ["api-passphrase", creds.passphrase],
]) {
  if (typeof value !== "string" || value.length === 0) {
    console.error(`SDK returned empty ${name} — aborting before persist`);
    process.exit(1);
  }
  writeFileSync(`${KEY_DIR}/${name}`, value, { mode: 0o600 });
  console.log(`wrote ${KEY_DIR}/${name}`);
}

console.log(``);
console.log(`done. wallet ${account.address} is now bound to Polymarket CLOB.`);
console.log(`next: fund the wallet with Polygon USDC + POL, then re-run`);
console.log(`adapters/poly-v2-reference/bot.ts --live --max-notional 2`);
