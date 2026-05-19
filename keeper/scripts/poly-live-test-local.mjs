#!/usr/bin/env node
// Phase 3 — local-Windows version of poly-live-test.mjs. Reads creds from
// C:\Users\gudma\Music\ instead of /root/.poly-keys/ on VPS. Designed to
// run from a Canada IP so Polymarket's Germany geoblock doesn't fire.
//
// Modes:
//   default      : discover market, build + sign order, print params.
//                  NEVER broadcasts.
//   --broadcast  : actually post the order + poll fills for 30s.
//
// Run:
//   cd C:\Users\gudma\OneDrive\Desktop\GITHUB-FILES\forum
//   node keeper\scripts\poly-live-test-local.mjs                # dry-run
//   node keeper\scripts\poly-live-test-local.mjs --broadcast    # real $$$$

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const SAFE = "0xcD6c77F267aa1745b9B57986Ad1A9C749212D1d8";
// Local Windows cred paths — adjust if you moved them.
const KEY_DIR = "C:\\Users\\gudma\\Music";
const PATHS = {
  signer:     `${KEY_DIR}\\polymarket-eoa-0x4f9efa49-signer.key`,
  apiKey:     `${KEY_DIR}\\polymarket-api-key`,
  apiSecret:  `${KEY_DIR}\\polymarket-api-secret`,
  passphrase: `${KEY_DIR}\\polymarket-api-passphrase`,
};

const BROADCAST = process.argv.includes("--broadcast");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const MAX_NOTIONAL = Number(arg("--max-notional", "2"));
const MID_MIN = Number(arg("--target-mid-min", "0.10"));
const MID_MAX = Number(arg("--target-mid-max", "0.90"));

const pk = readFileSync(PATHS.signer, "utf8").trim();
const apiKey = readFileSync(PATHS.apiKey, "utf8").trim();
const apiSecret = readFileSync(PATHS.apiSecret, "utf8").trim();
const apiPassphrase = readFileSync(PATHS.passphrase, "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

console.log(`signer:      ${account.address}`);
console.log(`funder safe: ${SAFE}`);
console.log(`mode:        ${BROADCAST ? "BROADCAST (real $$$$)" : "DRY-RUN (no broadcast)"}`);
console.log(`max notional: $${MAX_NOTIONAL}`);
console.log(``);

const clob = await import(
  pathToFileURL(
    resolve("keeper/node_modules/@polymarket/clob-client-v2/dist/index.cjs"),
  ).href
);
const ClobClient = clob.ClobClient;
const Side = clob.Side;
const OrderType = clob.OrderType;

const client = new ClobClient({
  host: "https://clob.polymarket.com",
  chain: 137,
  signer: walletClient,
  creds: { key: apiKey, secret: apiSecret, passphrase: apiPassphrase },
  funderAddress: SAFE,
  signatureType: 3, // POLY_1271
});

const bal = await client.getBalanceAllowance({ asset_type: "COLLATERAL" });
const balUsdc = Number(bal.balance) / 1e6;
console.log(`pUSD balance (API): ${balUsdc.toFixed(6)} pUSD`);
if (balUsdc < MAX_NOTIONAL + 0.1) {
  console.error(`insufficient balance: need ${MAX_NOTIONAL + 0.1}, have ${balUsdc}`);
  process.exit(1);
}

const { PolymarketReader } = await import(
  pathToFileURL(resolve("keeper/src/polymarket.ts")).href
);
const reader = new PolymarketReader();
const markets = await reader.discoverMarkets(10, 5000);
console.log(`discovered ${markets.length} markets`);

let chosen = null;
for (const m of markets) {
  const book = await reader.fetchBook(m.yesToken);
  const bid = PolymarketReader.bestBid(book);
  const ask = PolymarketReader.bestAsk(book);
  if (!bid || !ask) continue;
  const mid = (bid.price + ask.price) / 2;
  if (mid < MID_MIN || mid > MID_MAX) continue;
  const askDepthUsdc = ask.size * ask.price;
  if (askDepthUsdc < MAX_NOTIONAL) continue;
  chosen = { ...m, bid, ask, mid };
  break;
}
if (!chosen) {
  console.error(`no eligible market`);
  process.exit(1);
}
console.log(`\nchosen: ${chosen.slug}`);
console.log(`  question: ${chosen.question}`);
console.log(`  mid:      ${chosen.mid.toFixed(3)} (bid ${chosen.bid.price} / ask ${chosen.ask.price})`);

const userOrder = {
  tokenID: chosen.yesToken,
  amount: MAX_NOTIONAL,
  side: Side.BUY,
  orderType: OrderType.FOK,
  userUSDCBalance: balUsdc,
};
console.log(`\norder:`);
console.log(`  tokenID:   ${userOrder.tokenID}`);
console.log(`  side:      ${userOrder.side} amount=$${userOrder.amount} type=${userOrder.orderType}`);
console.log(`  expected: ~${(MAX_NOTIONAL / chosen.ask.price).toFixed(3)} shares @ ~${chosen.ask.price}`);

if (!BROADCAST) {
  console.log(`\nDRY-RUN — re-run with --broadcast to send.`);
  process.exit(0);
}

console.log(`\nBROADCASTING...`);
const result = await client.createAndPostMarketOrder(userOrder);
console.log(`POSTED:\n${JSON.stringify(result, null, 2)}`);

const orderId = result.orderID ?? result.order_id ?? result.id;
if (!orderId) {
  console.error(`no orderId in response`);
  process.exit(1);
}

console.log(`\npolling fills (30s) on ${orderId} ...`);
const deadline = Date.now() + 30_000;
let lastTrades = [];
while (Date.now() < deadline) {
  try {
    const trades = await client.getTrades({ id: orderId });
    if (Array.isArray(trades) && trades.length > lastTrades.length) {
      for (const t of trades.slice(lastTrades.length)) {
        console.log(`  trade ${t.id ?? t.trade_id} price=${t.price} size=${t.size} status=${t.status}`);
        console.log(`  tx: ${t.transaction_hash ?? t.transactionHash ?? "(pending)"}`);
      }
      lastTrades = trades;
      if (trades.every((t) => t.status === "MATCHED" || t.status === "MINED")) break;
    }
  } catch (e) { /* keep polling */ }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\nfinal trades (${lastTrades.length}):`);
console.log(JSON.stringify(lastTrades, null, 2));
