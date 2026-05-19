#!/usr/bin/env node
// Phase 3 readiness probe — instantiates ClobClient with the persisted
// creds + signer, runs a sequence of safe read-only checks to confirm
// every prereq is in place before we attempt any live order submission.
//
// Read-only. Never broadcasts. Never moves funds.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const KEY_DIR = process.env.POLY_KEYS_DIR ?? "/root/.poly-keys";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // Polygon native USDC

// Polymarket exchange contracts that may need USDC allowance for an EOA
// (deposit-wallet) signature flow. Documented at
// docs.polymarket.com/quickstart/setup. We check both — whichever is
// non-zero on this wallet is the one that gets used for fills.
const POLY_EXCHANGES = {
  CTFExchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NegRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
};

const pk = readFileSync(`${KEY_DIR}/signer.key`, "utf8").trim();
const apiKey = readFileSync(`${KEY_DIR}/api-key`, "utf8").trim();
const apiSecret = readFileSync(`${KEY_DIR}/api-secret`, "utf8").trim();
const apiPassphrase = readFileSync(`${KEY_DIR}/api-passphrase`, "utf8").trim();

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
console.log(`signer address:  ${account.address}`);
console.log(`api-key length:  ${apiKey.length}`);

// ── chain reads ──────────────────────────────────────────────────────
const pub = createPublicClient({ chain: polygon, transport: http() });
const [polWei, usdcMicros] = await Promise.all([
  pub.getBalance({ address: account.address }),
  pub.readContract({
    address: USDC,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [account.address],
  }),
]);
console.log(`POL gas:         ${formatUnits(polWei, 18)} POL`);
console.log(`USDC balance:    ${formatUnits(usdcMicros, 6)} USDC`);

console.log(``);
console.log(`USDC allowance on Polymarket exchanges:`);
const ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
]);
for (const [name, addr] of Object.entries(POLY_EXCHANGES)) {
  const allowance = await pub.readContract({
    address: USDC,
    abi: ALLOWANCE_ABI,
    functionName: "allowance",
    args: [account.address, addr],
  });
  console.log(`  ${name.padEnd(18)} (${addr}): ${formatUnits(allowance, 6)} USDC`);
}

// ── Polymarket SDK auth check ────────────────────────────────────────
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(),
});

const clob = await import(
  pathToFileURL(
    resolve("keeper/node_modules/@polymarket/clob-client-v2/dist/index.cjs"),
  ).href
);
const ClobClient = clob.ClobClient ?? clob.default?.ClobClient ?? clob.default;

const client = new ClobClient({
  host: "https://clob.polymarket.com",
  chain: 137,
  signer: walletClient,
  creds: { key: apiKey, secret: apiSecret, passphrase: apiPassphrase },
});

console.log(``);
console.log(`Polymarket API checks:`);

// 1. Unauthenticated reachability
try {
  const ok = await client.getOk();
  console.log(`  getOk():                  ${JSON.stringify(ok).slice(0, 80)}`);
} catch (e) {
  console.log(`  getOk() FAILED:           ${e.message}`);
}

// 2. Server time (sanity vs creds-required call)
try {
  const t = await client.getServerTime();
  console.log(`  getServerTime():          ${t}`);
} catch (e) {
  console.log(`  getServerTime() FAILED:   ${e.message}`);
}

// 3. Auth'd call: list our API keys (proves the 3-key auth flow works)
try {
  const r = await client.getApiKeys();
  const keys = r.apiKeys ?? r.api_keys ?? r;
  const count = Array.isArray(keys) ? keys.length : "?";
  console.log(`  getApiKeys() count=${count} (auth works if no error)`);
} catch (e) {
  console.log(`  getApiKeys() FAILED:      ${e.message}`);
}

// 4. Auth'd call: list our open orders (should be empty)
try {
  const open = await client.getOpenOrders({});
  const arr = open.data ?? open;
  console.log(`  getOpenOrders() count=${Array.isArray(arr) ? arr.length : "?"}`);
} catch (e) {
  console.log(`  getOpenOrders() FAILED:   ${e.message}`);
}

console.log(``);
console.log("If all 4 API checks returned values (no FAILED lines), auth is live.");
console.log("Next steps:");
console.log("  - If allowance is 0 for both exchanges, must USDC.approve() first.");
console.log("  - Then bot.ts --live --max-notional 2 can submit a real order.");
