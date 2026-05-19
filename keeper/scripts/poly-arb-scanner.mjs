#!/usr/bin/env node
// Phase 4 strategy framework -- YES+NO arbitrage scanner for Polymarket V2.
//
// For each liquid binary market, fetches the YES book + NO book. If
// (YES_ask + NO_ask + fees) < $1.00, an arb exists: buy both legs, at
// resolution exactly one pays $1, profit = $1 - both_asks - fees.
//
// Modes:
//   default      : scan all markets, sort by gross spread, print top 10.
//   --execute    : if best market >= --min-edge-bps (default 200=2%),
//                  broadcast a $1 YES leg then $1 NO leg. Single-shot.
//
// Honest expectations:
//  - On efficient markets, YES+NO ~= $1.00 minus tiny spread. Real arbs
//    rare due to competition.
//  - Polymarket V2 platform fee ~0.5% per side (observed in D74/D78).
//    Two-leg arb pays ~1% in fees. Gross spread must clear that.
//  - Leg-out risk: FOK on each leg means if either cant fill atomically
//    it reverts and only that legs platform fee (~$0.005) is paid.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const SAFE = "0xcD6c77F267aa1745b9B57986Ad1A9C749212D1d8";
const KEY_DIR = "C:/Users/gudma/Music";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const EXECUTE = process.argv.includes("--execute");
const N_MARKETS = Number(arg("--markets", "30"));
const PER_LEG_USDC = Number(arg("--per-leg", "1.0"));
const MIN_EDGE_BPS = Number(arg("--min-edge-bps", "200"));

const pk = readFileSync(`${KEY_DIR}/polymarket-eoa-0x4f9efa49-signer.key`, "utf8").trim();
const apiKey = readFileSync(`${KEY_DIR}/polymarket-api-key`, "utf8").trim();
const apiSecret = readFileSync(`${KEY_DIR}/polymarket-api-secret`, "utf8").trim();
const apiPassphrase = readFileSync(`${KEY_DIR}/polymarket-api-passphrase`, "utf8").trim();
let builderCode = "";
try { builderCode = readFileSync(`${KEY_DIR}/polymarket-builder-code`, "utf8").trim(); } catch {}

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

const clob = await import(
  pathToFileURL(resolve("keeper/node_modules/@polymarket/clob-client-v2/dist/index.cjs")).href
);
const client = new clob.ClobClient({
  host: "https://clob.polymarket.com",
  chain: 137, signer: walletClient,
  creds: { key: apiKey, secret: apiSecret, passphrase: apiPassphrase },
  funderAddress: SAFE, signatureType: 3,
  ...(builderCode ? { builderConfig: { builderCode } } : {}),
});
const Side = clob.Side;
const OrderType = clob.OrderType;

const { PolymarketReader } = await import(
  pathToFileURL(resolve("keeper/src/polymarket.ts")).href
);
const reader = new PolymarketReader();

console.log(`mode:             ${EXECUTE ? "EXECUTE (if edge >= " + MIN_EDGE_BPS + "bps)" : "SCAN-ONLY"}`);
console.log(`markets to scan:  ${N_MARKETS}`);
console.log(`per-leg notional: $${PER_LEG_USDC}`);
console.log(``);

const bal = await client.getBalanceAllowance({ asset_type: "COLLATERAL" });
const balUsdc = Number(bal.balance) / 1e6;
console.log(`pUSD balance: ${balUsdc.toFixed(6)}`);
if (EXECUTE && balUsdc < PER_LEG_USDC * 2 + 0.1) {
  console.error(`insufficient balance for two ${PER_LEG_USDC} legs: need ${PER_LEG_USDC * 2 + 0.1}, have ${balUsdc}`);
  process.exit(1);
}
console.log(``);

const markets = await reader.discoverMarkets(N_MARKETS, 1_000);
console.log(`discovered ${markets.length} binary markets w/ liquidity > $1000\n`);

const opps = [];
for (const m of markets) {
  try {
    const [yesBook, noBook] = await Promise.all([
      reader.fetchBook(m.tokenIds[0]),
      reader.fetchBook(m.tokenIds[1]),
    ]);
    const yesAsk = PolymarketReader.bestAsk(yesBook);
    const noAsk  = PolymarketReader.bestAsk(noBook);
    if (!yesAsk || !noAsk) continue;
    const cost = yesAsk.price + noAsk.price;
    const grossEdgeBps = Math.round((1 - cost) * 10_000);
    const yesDepthUsdc = yesAsk.size * yesAsk.price;
    const noDepthUsdc  = noAsk.size  * noAsk.price;
    opps.push({
      slug: m.slug, tokenYes: m.tokenIds[0], tokenNo: m.tokenIds[1],
      yesAsk: yesAsk.price, noAsk: noAsk.price, cost, grossEdgeBps,
      yesDepthUsdc, noDepthUsdc,
    });
  } catch (e) { /* skip bad markets */ }
}

opps.sort((a, b) => b.grossEdgeBps - a.grossEdgeBps);
console.log(`top 10 by gross edge (1 - YES_ask - NO_ask):\n`);
console.log(`  edge_bps  cost    yes    no     yes$    no$     slug`);
console.log(`  --------  ------  -----  -----  ------  ------  ----`);
for (const o of opps.slice(0, 10)) {
  const tag = o.grossEdgeBps >= MIN_EDGE_BPS ? "OK" : "  ";
  console.log(
    `  ${tag} ${String(o.grossEdgeBps).padStart(5)}  ${o.cost.toFixed(4)}  ${o.yesAsk.toFixed(3)}  ${o.noAsk.toFixed(3)}  ${o.yesDepthUsdc.toFixed(2).padStart(6)}  ${o.noDepthUsdc.toFixed(2).padStart(6)}  ${o.slug.slice(0, 50)}`
  );
}

const best = opps[0];
if (!best || best.grossEdgeBps < MIN_EDGE_BPS) {
  console.log(``);
  console.log(`No market beats threshold (${MIN_EDGE_BPS} bps). ${EXECUTE ? "Nothing to execute." : "Re-run later when conditions change."}`);
  process.exit(0);
}

console.log(``);
console.log(`Best opportunity:`);
console.log(`  ${best.slug}`);
console.log(`  YES@${best.yesAsk} + NO@${best.noAsk} = ${best.cost.toFixed(4)} (${best.grossEdgeBps} bps gross edge)`);
console.log(`  After ~100 bps two-leg fee: ${(best.grossEdgeBps - 100)} bps net per $1`);

if (!EXECUTE) {
  console.log(``);
  console.log(`SCAN-ONLY -- re-run with --execute to fire two $${PER_LEG_USDC} legs on this market.`);
  process.exit(0);
}

if (best.yesDepthUsdc < PER_LEG_USDC || best.noDepthUsdc < PER_LEG_USDC) {
  console.error(`insufficient depth: yes=${best.yesDepthUsdc}, no=${best.noDepthUsdc}, need >= ${PER_LEG_USDC}`);
  process.exit(1);
}

console.log(``);
console.log(`BROADCASTING leg 1 (YES) ...`);
const yesOrder = {
  tokenID: best.tokenYes, amount: PER_LEG_USDC,
  side: Side.BUY, orderType: OrderType.FOK, userUSDCBalance: balUsdc,
  ...(builderCode ? { builderCode } : {}),
};
let yesResult;
try {
  yesResult = await client.createAndPostMarketOrder(yesOrder);
  console.log(`YES: ${JSON.stringify(yesResult, null, 2)}`);
} catch (e) {
  console.error(`YES leg failed: ${e.message}`);
  process.exit(1);
}
if (!yesResult.success) {
  console.error(`YES leg did not match -- aborting before NO leg.`);
  process.exit(1);
}

console.log(``);
console.log(`BROADCASTING leg 2 (NO) ...`);
const noOrder = { ...yesOrder, tokenID: best.tokenNo };
let noResult;
try {
  noResult = await client.createAndPostMarketOrder(noOrder);
  console.log(`NO: ${JSON.stringify(noResult, null, 2)}`);
} catch (e) {
  console.error(`NO leg failed AFTER YES filled -- you are exposed long YES only`);
  console.error(e.message);
  process.exit(1);
}

console.log(``);
console.log(`ARB COMPLETE.`);
console.log(`  YES paid: ${yesResult.makingAmount} pUSD, got ${yesResult.takingAmount} YES shares`);
console.log(`  NO  paid: ${noResult.makingAmount} pUSD, got ${noResult.takingAmount} NO shares`);
const totalPaid = Number(yesResult.makingAmount) + Number(noResult.makingAmount);
console.log(`  Total paid: ${totalPaid.toFixed(4)} pUSD`);
console.log(`  At resolution: $1.00 (exactly one side pays out)`);
console.log(`  Gross profit before platform fees: ${(1 - totalPaid).toFixed(4)} pUSD`);
