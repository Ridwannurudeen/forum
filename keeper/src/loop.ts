// The main keeper loop: every interval, for each market:
//   1. Fetch latest book
//   2. Compute fair value
//   3. Generate quotes (paper)
//   4. Simulate fills against the next book snapshot
//   5. Update inventory + PnL
// Every publish_every ticks: push a TrackRecord summary to Arc.

import { PolymarketReader, type MarketSpec } from "./polymarket.js";
import {
  FairValueEstimator,
  QuoteGenerator,
  type QuoterConfig,
  type QuoteSet,
} from "./quoter.js";
import { InventoryTracker } from "./inventory.js";
import { simulateFills } from "./paper.js";
import { ForumBridge } from "./forum.js";
import { keccak256, toHex } from "viem";

export interface LoopOptions {
  intervalMs: number;
  publishEveryTicks: number;
  quoterConfig: QuoterConfig;
  bridge: ForumBridge;
  markets: MarketSpec[];
  /** If set, stop after this many ticks. Useful for smoke tests. */
  maxTicks?: number;
}

interface PerMarket {
  market: MarketSpec;
  estimator: FairValueEstimator;
  quoter: QuoteGenerator;
  inventory: InventoryTracker;
  lastQuotes: QuoteSet | null;
}

export async function runLoop(opts: LoopOptions): Promise<void> {
  const reader = new PolymarketReader();
  const state: PerMarket[] = opts.markets.map((m) => ({
    market: m,
    estimator: new FairValueEstimator(opts.quoterConfig),
    quoter: new QuoteGenerator(opts.quoterConfig),
    inventory: new InventoryTracker(),
    lastQuotes: null,
  }));

  console.log(`Keeper booting on ${state.length} market(s):`);
  for (const s of state) {
    console.log(
      `  ${s.market.slug}  liq=${s.market.liquidity.toFixed(0)}  end=${s.market.endDate}`,
    );
  }

  const reg = await opts.bridge.ensureRegistered();
  console.log(
    reg.alreadyRegistered
      ? `Bot already registered (botId=${opts.bridge.botId})`
      : `Registered bot in tx ${reg.txHash}`,
  );

  let tick = 0;
  // Run forever (or until maxTicks); user interrupts with Ctrl-C.
  while (opts.maxTicks === undefined || tick < opts.maxTicks) {
    tick += 1;
    const ts = Math.floor(Date.now() / 1000);

    for (const s of state) {
      try {
        const book = await reader.fetchBook(s.market.yesToken);
        const bid = PolymarketReader.bestBid(book);
        const ask = PolymarketReader.bestAsk(book);
        if (!bid || !ask) {
          console.log(`tick=${tick} ${s.market.slug} empty book, skipping`);
          continue;
        }
        const midprice = (bid.price + ask.price) / 2;
        const fv = s.estimator.update(midprice);
        const pos = s.inventory.snapshot();
        const quotes = s.quoter.generate(fv, pos.net);

        // Simulate fills against this NEW book using the PREVIOUS tick's quotes.
        if (s.lastQuotes) {
          const sim = simulateFills(
            ts * 1000,
            s.lastQuotes.bid,
            s.lastQuotes.ask,
            book,
          );
          if (sim.buy) {
            s.inventory.apply(sim.buy);
            console.log(
              `  FILL  BUY  ${s.market.slug} px=${sim.buy.price} sz=${sim.buy.size}`,
            );
          }
          if (sim.sell) {
            s.inventory.apply(sim.sell);
            console.log(
              `  FILL  SELL ${s.market.slug} px=${sim.sell.price} sz=${sim.sell.size}`,
            );
          }
        }
        s.lastQuotes = quotes;

        const totalPnl = s.inventory.totalPnlAt(fv);
        console.log(
          `tick=${tick} ${s.market.slug} mid=${midprice.toFixed(3)} fv=${fv.toFixed(3)} ` +
            `bid=${quotes.bid ? quotes.bid.price.toFixed(3) : "-"} ` +
            `ask=${quotes.ask ? quotes.ask.price.toFixed(3) : "-"} ` +
            `net=${pos.net.toFixed(2)} pnl=${totalPnl.toFixed(4)}`,
        );
      } catch (e) {
        console.error(
          `tick=${tick} ${s.market.slug} ERROR`,
          (e as Error).message,
        );
      }
    }

    if (tick % opts.publishEveryTicks === 0) {
      try {
        let totalPnl = 0;
        let totalFills = 0;
        for (const s of state) {
          const pos = s.inventory.snapshot();
          totalPnl += s.inventory.totalPnlAt(0.5); // fallback mark; per-market mark would be better
          totalFills += pos.fills;
        }
        // Polymarket prices are 0..1. PnL is in USDC. Convert to micros (1e6).
        const pnlMicros = BigInt(Math.round(totalPnl * 1_000_000));
        const metaHash = keccak256(
          toHex(
            `tick=${tick};markets=${state.map((s) => s.market.slug).join(",")}`,
          ),
        );
        const hash = await opts.bridge.publishRecord(
          pnlMicros,
          totalFills,
          metaHash,
          ts,
        );
        console.log(
          `PUBLISH tx=${hash} pnlMicros=${pnlMicros} fills=${totalFills}`,
        );
      } catch (e) {
        console.error(`PUBLISH failed:`, (e as Error).message);
      }
    }

    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}
