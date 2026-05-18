// Forum × Polymarket V2 reference adapter — runnable picker bot.
//
// PAPER-MODE: discovers markets, reads books, picks a directional bias each
// tick, publishes a Forum receipt every N ticks. No orders submitted.
//
// Run from repo root:
//   ./keeper/node_modules/.bin/tsx adapters/poly-v2-reference/bot.ts \
//     --label my-v2-bot-v1 --markets 3 --interval 60 --publish-every 10 \
//     --receipts-dir /tmp/forum-receipts \
//     --receipts-base-url https://example.com/receipts

import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keccak256, toHex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
process.chdir(REPO_ROOT);

const fileUrl = (p: string) => pathToFileURL(resolve(p)).href;
const { PolymarketReader } = await import(fileUrl("keeper/src/polymarket.ts"));
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt } = await import(fileUrl("keeper/src/receipt.ts"));

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = a.indexOf(k);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    label: get("--label", "poly-v2-reference-v1"),
    markets: Number(get("--markets", "3")),
    intervalSec: Number(get("--interval", "60")),
    publishEvery: Number(get("--publish-every", "10")),
    receiptsDir: get("--receipts-dir", "/tmp/forum-receipts"),
    receiptsBaseUrl: get("--receipts-base-url", "https://example.com/receipts"),
    maxTicks: process.argv.includes("--max-ticks")
      ? Number(get("--max-ticks", "0"))
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// STRATEGY — REPLACE THIS WITH YOUR LOGIC
//
// Inputs: a normalized view of the market (slug, midprice, depth, ts).
// Output: a Decision the receipt records. Returning a Decision does NOT submit
// an order — it only goes into the on-chain receipt as your stated intent.
//
// Forum doesn't grade your alpha. It grades the consistency between what you
// claim and what verifiably happened (via the receipt + the chain).
// ---------------------------------------------------------------------------

interface MarketView {
  slug: string;
  marketId: string;
  midprice: number;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  ts: number;
}

interface Decision {
  marketSlug: string;
  marketId: string;
  action: "BUY" | "SELL" | "HOLD";
  sizeUsdc: number;
  rationale: string;
}

function pickDirection(m: MarketView): Decision {
  // Toy reference strategy:
  //   - HOLD when book is wide (spread > 5%)
  //   - BUY when midprice < 0.50 (cheap "yes")
  //   - SELL when midprice >= 0.50
  // Replace with your strategy. The interface contract is the only thing
  // Forum cares about — Decision shape goes into the receipt as your trace.
  const spread = m.askPrice - m.bidPrice;
  if (spread / m.midprice > 0.05) {
    return {
      marketSlug: m.slug,
      marketId: m.marketId,
      action: "HOLD",
      sizeUsdc: 0,
      rationale: `wide spread ${(spread * 100).toFixed(1)}%`,
    };
  }
  if (m.midprice < 0.5) {
    return {
      marketSlug: m.slug,
      marketId: m.marketId,
      action: "BUY",
      sizeUsdc: 5,
      rationale: `mid ${m.midprice.toFixed(3)} below 0.50, accumulate cheap YES`,
    };
  }
  return {
    marketSlug: m.slug,
    marketId: m.marketId,
    action: "SELL",
    sizeUsdc: 5,
    rationale: `mid ${m.midprice.toFixed(3)} >= 0.50, fade premium`,
  };
}

// ---------------------------------------------------------------------------
// Publish loop — boilerplate, do not edit unless you know the receipt schema.
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  console.log(
    `[adapter] label=${args.label} markets=${args.markets} interval=${args.intervalSec}s publishEvery=${args.publishEvery}`,
  );

  mkdirSync(args.receiptsDir, { recursive: true });

  const reader = new PolymarketReader();
  const markets = await reader.discoverMarkets(args.markets, 5_000);
  if (markets.length === 0) {
    console.error("[adapter] no markets with sufficient liquidity");
    process.exit(1);
  }
  console.log(`[adapter] booting on ${markets.length} markets:`);
  for (const m of markets)
    console.log(`  ${m.slug} liq=$${m.liquidity.toFixed(0)}`);

  const bridge = new ForumV2Bridge({
    deploymentPath: `${REPO_ROOT}/deployments/arc-testnet.json`,
    botLabel: args.label,
    receiptsDir: args.receiptsDir,
    receiptsBaseUrl: args.receiptsBaseUrl,
  });
  console.log(
    `[adapter] signer=${bridge.account.address} botId=${bridge.botId}`,
  );

  const reg = await bridge.ensureRegistered(0); // 0 = MAKER; swap 1=TAKER, 2=ARB, 3=OTHER
  console.log(
    reg.alreadyRegistered
      ? `[adapter] bot already registered`
      : `[adapter] registered in tx ${reg.txHash}`,
  );

  let seq = (await bridge.lastSeq()) + 1;
  let prevHash = await bridge.lastRecordHash();
  let periodStartTs = Math.floor(Date.now() / 1000);
  const strategyConfigHash = keccak256(toHex(`${args.label}-config-v1`));
  let tick = 0;
  let cycleBookSnapshots: any[] = [];
  let cycleDecisions: any[] = [];

  while (args.maxTicks === undefined || tick < args.maxTicks) {
    tick += 1;
    const ts = Math.floor(Date.now() / 1000);

    for (const m of markets) {
      try {
        const book = await reader.fetchBook(m.yesToken);
        const bid = PolymarketReader.bestBid(book);
        const ask = PolymarketReader.bestAsk(book);
        if (!bid || !ask) {
          console.log(`[adapter] tick=${tick} ${m.slug} empty book`);
          continue;
        }
        const midprice = (bid.price + ask.price) / 2;
        const decision = pickDirection({
          slug: m.slug,
          marketId: m.yesToken,
          midprice,
          bidPrice: bid.price,
          bidSize: bid.size,
          askPrice: ask.price,
          askSize: ask.size,
          ts,
        });
        console.log(
          `[adapter] tick=${tick} ${m.slug} mid=${midprice.toFixed(3)} -> ${decision.action} ${decision.sizeUsdc} (${decision.rationale})`,
        );
        cycleBookSnapshots.push({
          marketId: m.yesToken,
          start: {
            bids: [{ price: bid.price, size: bid.size }],
            asks: [{ price: ask.price, size: ask.size }],
            ts,
            source: "polymarket-clob-v2",
          },
          end: {
            bids: [{ price: bid.price, size: bid.size }],
            asks: [{ price: ask.price, size: ask.size }],
            ts,
            source: "polymarket-clob-v2",
          },
        });
        cycleDecisions.push(decision);
      } catch (e: any) {
        console.error(`[adapter] tick=${tick} ${m.slug} ERROR`, e.message);
      }
    }

    if (tick % args.publishEvery === 0) {
      try {
        const periodEndTs = Math.floor(Date.now() / 1000);
        const receipt = buildReceipt({
          botId: bridge.botId,
          seq,
          periodStart: periodStartTs,
          periodEnd: periodEndTs,
          markets: markets.map((mm: any) => mm.slug),
          bookSnapshots: cycleBookSnapshots,
          fills: [], // paper mode: zero fills
          inventory: markets.map((mm: any) => ({
            marketId: mm.yesToken,
            openShares: 0,
            closeShares: 0,
          })),
          pnl: {
            realizedUsdc: 0,
            unrealizedUsdc: 0,
            makerRebatesUsdc: 0,
            totalUsdcMicros: 0,
            formulaVersion: "v1",
          },
          strategy: { name: args.label, configHash: strategyConfigHash },
          decisionTrace: {
            traceUri: "",
            traceHash: ("0x" + "0".repeat(64)) as `0x${string}`,
          },
        });

        const { uri, hash, localPath } = bridge.writeReceipt(seq, receipt);
        console.log(`[adapter] RECEIPT seq=${seq} hash=${hash} ${localPath}`);

        const metaHash = keccak256(
          toHex(`seq=${seq};label=${args.label};markets=${markets.length}`),
        );
        const { txHash, recordHash } = await bridge.publishRecordAwait({
          seq,
          periodStart: periodStartTs,
          periodEnd: periodEndTs,
          pnlMicros: 0n,
          fills: 0,
          metaHash,
          evidenceUri: uri,
          evidenceHash: hash,
          prevRecordHash: prevHash,
        });
        console.log(`[adapter] PUBLISH-V2 tx=${txHash} seq=${seq} uri=${uri}`);
        prevHash = recordHash;
        seq += 1;
        periodStartTs = periodEndTs + 1;
        cycleBookSnapshots = [];
        cycleDecisions = [];
      } catch (e: any) {
        console.error("[adapter] PUBLISH-V2 failed:", e.message);
      }
    }

    await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
  }
}

main().catch((e) => {
  console.error("[adapter] FATAL", e);
  process.exit(1);
});
