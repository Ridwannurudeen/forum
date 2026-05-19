#!/usr/bin/env node
// Phase 3 — first live $2 trade against Polymarket V2.
//
// Two modes:
//   default      : discover a market, build + sign the order, print params.
//                  NEVER broadcasts. Safe to run any time.
//   --broadcast  : same flow, then actually POST the order to Polymarket
//                  and poll for fills for 30s.
//
// Flags:
//   --max-notional N    USD cap (default 2)
//   --target-mid-min P  skip markets whose midprice is below this (default 0.10)
//   --target-mid-max P  skip markets whose midprice is above this (default 0.90)
//
// Wallet: 0x4f9eFA49…Bac9 (signer) / 0xcD6c77F2…D1d8 (Polymarket Safe / pUSD holder).
// Signature type: POLY_1271 (3).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const SAFE = "0xcD6c77F267aa1745b9B57986Ad1A9C749212D1d8";
const KEY_DIR = process.env.POLY_KEYS_DIR ?? "/root/.poly-keys";

const BROADCAST = process.argv.includes("--broadcast");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const MAX_NOTIONAL = Number(arg("--max-notional", "2"));
const MID_MIN = Number(arg("--target-mid-min", "0.10"));
const MID_MAX = Number(arg("--target-mid-max", "0.90"));

// Load creds + signer
const pk = readFileSync(`${KEY_DIR}/signer.key`, "utf8").trim();
const apiKey = readFileSync(`${KEY_DIR}/api-key`, "utf8").trim();
const apiSecret = readFileSync(`${KEY_DIR}/api-secret`, "utf8").trim();
const apiPassphrase = readFileSync(`${KEY_DIR}/api-passphrase`, "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

console.log(`signer:      ${account.address}`);
console.log(`funder safe: ${SAFE}`);
console.log(`mode:        ${BROADCAST ? "BROADCAST (real $$$$)" : "DRY-RUN (no broadcast)"}`);
console.log(`max notional: $${MAX_NOTIONAL}`);
console.log(`midprice range: [${MID_MIN}, ${MID_MAX}]`);
console.log(``);

// Instantiate SDK
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

// 1. Confirm balance is enough
const bal = await client.getBalanceAllowance({ asset_type: "COLLATERAL" });
const balUsdc = Number(bal.balance) / 1e6;
console.log(`pUSD balance (API): ${balUsdc.toFixed(6)} pUSD`);
if (balUsdc < MAX_NOTIONAL + 0.1) {
  console.error(`insufficient balance: need ${MAX_NOTIONAL + 0.1}, have ${balUsdc}`);
  process.exit(1);
}

// 2. Discover markets — use the existing PolymarketReader from keeper/src.
const { PolymarketReader } = await import(
  pathToFileURL(resolve("keeper/src/polymarket.ts")).href
);
const reader = new PolymarketReader();
const markets = await reader.discoverMarkets(10, 5000);
console.log(`discovered ${markets.length} markets with sufficient liquidity`);

// 3. Pick the first market whose midprice is in our target range.
let chosen = null;
for (const m of markets) {
  const book = await reader.fetchBook(m.yesToken);
  const bid = PolymarketReader.bestBid(book);
  const ask = PolymarketReader.bestAsk(book);
  if (!bid || !ask) continue;
  const mid = (bid.price + ask.price) / 2;
  if (mid < MID_MIN || mid > MID_MAX) continue;
  // Need ask depth that can absorb our notional.
  const askDepthUsdc = ask.size * ask.price;
  if (askDepthUsdc < MAX_NOTIONAL) continue;
  chosen = { ...m, bid, ask, mid };
  break;
}
if (!chosen) {
  console.error(`no market in midprice range [${MID_MIN}, ${MID_MAX}] with sufficient ask depth`);
  process.exit(1);
}
console.log(``);
console.log(`chosen market: ${chosen.slug}`);
console.log(`  question:    ${chosen.question}`);
console.log(`  yesToken:    ${chosen.yesToken}`);
console.log(`  bestBid:     ${chosen.bid.price.toFixed(3)} x ${chosen.bid.size.toFixed(2)}`);
console.log(`  bestAsk:     ${chosen.ask.price.toFixed(3)} x ${chosen.ask.size.toFixed(2)}`);
console.log(`  midprice:    ${chosen.mid.toFixed(3)}`);

// 4. Build a market BUY order.
// UserMarketOrderV2: amount is the USDC notional for BUY orders.
const userOrder = {
  tokenID: chosen.yesToken,
  amount: MAX_NOTIONAL,
  side: Side.BUY,
  orderType: OrderType.FOK,
  userUSDCBalance: balUsdc,
};
console.log(``);
console.log(`order params (UserMarketOrderV2):`);
console.log(`  tokenID:   ${userOrder.tokenID}`);
console.log(`  side:      ${userOrder.side}`);
console.log(`  amount:    $${userOrder.amount}`);
console.log(`  orderType: ${userOrder.orderType}`);
console.log(`  expected fill price: ~${chosen.ask.price.toFixed(3)} (best ask)`);
console.log(`  expected shares:     ~${(MAX_NOTIONAL / chosen.ask.price).toFixed(3)}`);

if (!BROADCAST) {
  console.log(``);
  console.log("DRY-RUN — exiting before order signing/broadcast.");
  console.log("Re-run with --broadcast to actually submit + capture proof.");
  process.exit(0);
}

// 5. Broadcast.
console.log(``);
console.log(`BROADCASTING order...`);
const result = await client.createAndPostMarketOrder(userOrder);
console.log(`POSTED:`);
console.log(JSON.stringify(result, null, 2));

// 6. Poll for fills.
const orderId = result.orderID ?? result.order_id ?? result.id;
if (!orderId) {
  console.error(`no orderId returned — can't poll for fills`);
  process.exit(1);
}
console.log(``);
console.log(`polling for fills (30s) on order ${orderId}...`);
const deadline = Date.now() + 30_000;
let lastTrades = [];
while (Date.now() < deadline) {
  try {
    const trades = await client.getTrades({ id: orderId });
    if (Array.isArray(trades) && trades.length > lastTrades.length) {
      console.log(`+${trades.length - lastTrades.length} new trade(s):`);
      for (const t of trades.slice(lastTrades.length)) {
        console.log(`  trade ${t.id ?? t.trade_id} | price=${t.price} size=${t.size} status=${t.status}`);
        console.log(`  tx: ${t.transaction_hash ?? t.transactionHash ?? "(pending)"}`);
      }
      lastTrades = trades;
      if (trades.every((t) => t.status === "MATCHED" || t.status === "MINED")) break;
    }
  } catch (e) {
    // some implementations: getTrades wants different params
  }
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(``);
console.log(`final trades: ${lastTrades.length}`);
console.log(JSON.stringify(lastTrades, null, 2));
