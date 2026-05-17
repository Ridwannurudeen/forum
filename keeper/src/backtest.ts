// Price-history backtest harness for the Forum reference keeper.
//
// Replays a {t, p} time series tick-by-tick. At each tick:
//   1. Update variance estimate from current price
//   2. Compute Avellaneda–Stoikov quotes from variance + remaining time + inventory
//   3. Decide whether the NEXT tick's price would have crossed our quotes
//   4. If crossed, fill at our quote level; update inventory + cost basis
//   5. Mark-to-market PnL using the new price
//
// Limitations (be honest):
//   - We only have midprice, not full orderbook depth. Fill model assumes
//     ANY price cross fills our full quote size — optimistic. A more
//     conservative version would discount the size by an estimated depth.
//   - No adverse-selection model: in reality, the trade flow that crossed
//     our quote is also informed about price direction, so MM PnL ex-spread
//     is on average negative. We approximate by setting κ to a value that
//     produces realistic half-spreads.
//   - No fees / no maker rebates modelled.
//
// Output: per-tick log + summary metrics (Sharpe, max DD, hit rate, etc.).

import {
  asQuotes,
  VarianceEstimator,
  type AvellanedaStoikovConfig,
  type ASQuoteSet,
} from "./strategy.js";
import { InventoryTracker, type Fill } from "./inventory.js";

export interface PriceTick {
  t: number;
  p: number;
}

export interface BacktestParams {
  /** Sorted ascending by t. */
  ticks: PriceTick[];
  /** Resolution time in seconds (unix epoch). Used to compute time-to-terminal. */
  resolutionTs: number;
  /** Strategy config. */
  cfg: AvellanedaStoikovConfig;
  /** Variance EWMA half-life in samples. */
  varianceHalfLife?: number;
}

export interface PerTickLog {
  t: number;
  midprice: number;
  variance: number;
  reservationPrice: number;
  halfSpread: number;
  bid: number | null;
  ask: number | null;
  inventory: number;
  fillThisTick: "BUY" | "SELL" | null;
  fillPrice: number | null;
  pnlUsdc: number;
}

export interface BacktestResult {
  log: PerTickLog[];
  summary: BacktestSummary;
}

export interface BacktestSummary {
  ticks: number;
  fills: number;
  finalInventory: number;
  finalPnlUsdc: number;
  pnlSeriesUsdc: number[];
  meanReturn: number;
  stddev: number;
  sharpe: number; // annualised assuming 1 tick = 1 minute
  maxDrawdown: number;
  hitRate: number; // fraction of fills that were profitable (closing)
  inventoryTurnover: number; // sum of |fill_size| / mean(|inventory|)
}

export function runBacktest(p: BacktestParams): BacktestResult {
  const { ticks, resolutionTs, cfg } = p;
  if (ticks.length < 3) {
    throw new Error(`Need ≥3 ticks; got ${ticks.length}`);
  }
  const variance = new VarianceEstimator(p.varianceHalfLife ?? 30);
  const inventory = new InventoryTracker();
  const log: PerTickLog[] = [];
  const pnlSeriesUsdc: number[] = [];
  let profitableFills = 0;
  let makerRebatesUsdc = 0;

  // Directional momentum EWMA on first-differences. Used to pull the side
  // that's getting hit by a trend. Half-life ~15 ticks (15min).
  const momentumAlpha = 1 - Math.pow(0.5, 1 / 15);
  let momentum = 0;
  let prevPrice: number | null = null;

  for (let i = 0; i < ticks.length - 1; i++) {
    const tick = ticks[i]!;
    const next = ticks[i + 1]!;
    const v = variance.update(tick.p);

    // Update directional momentum (signed first-difference EWMA).
    if (prevPrice !== null) {
      momentum = momentum + momentumAlpha * (tick.p - prevPrice - momentum);
    }
    prevPrice = tick.p;

    // Time-to-resolution in minutes (variance was computed per sample = per minute).
    const ttr = Math.max(1, (resolutionTs - tick.t) / 60);
    const pos = inventory.snapshot();

    // Three-stage gate: warmup + vol-regime + momentum filter. All pull quotes.
    // Momentum threshold: ~5bps/tick sustained move → market is trending against
    // makers, so we step aside until it cools.
    const inWarmup = i < cfg.warmupTicks;
    const volTooHigh = v > cfg.maxQuotingVariance;
    const trending = Math.abs(momentum) > 0.0005;
    const quotes: ASQuoteSet =
      inWarmup || volTooHigh || trending
        ? {
            midprice: tick.p,
            fairValue: tick.p,
            reservationPrice: tick.p,
            halfSpread: 0,
            bid: null,
            ask: null,
          }
        : asQuotes(tick.p, pos.net, v, ttr, cfg);

    let fillSide: "BUY" | "SELL" | null = null;
    let fillPrice: number | null = null;

    // Realistic fill rule: require the next-tick price to GAP THROUGH our
    // quote by at least 1 tick. A bare equality or sub-tick cross is more
    // likely noise (passing trades) than a real adverse-selection hit.
    const gapThreshold = cfg.tickSize;
    if (quotes.bid !== null && next.p < quotes.bid.price - gapThreshold) {
      // Bid hit by someone selling INTO us.
      const fill: Fill = {
        ts: tick.t * 1000,
        side: "BUY",
        price: quotes.bid.price,
        size: quotes.bid.size,
      };
      const before = inventory.totalPnlAt(next.p);
      inventory.apply(fill);
      // Maker rebate is added directly to realized PnL via a synthetic
      // credit on the inventory tracker.
      makerRebatesUsdc += cfg.makerRebateUsdcPerFill;
      const after = inventory.totalPnlAt(next.p) + makerRebatesUsdc;
      if (after > before) profitableFills += 1;
      fillSide = "BUY";
      fillPrice = quotes.bid.price;
    } else if (
      quotes.ask !== null &&
      next.p > quotes.ask.price + gapThreshold
    ) {
      const fill: Fill = {
        ts: tick.t * 1000,
        side: "SELL",
        price: quotes.ask.price,
        size: quotes.ask.size,
      };
      const before = inventory.totalPnlAt(next.p);
      inventory.apply(fill);
      makerRebatesUsdc += cfg.makerRebateUsdcPerFill;
      const after = inventory.totalPnlAt(next.p) + makerRebatesUsdc;
      if (after > before) profitableFills += 1;
      fillSide = "SELL";
      fillPrice = quotes.ask.price;
    }

    const pnl = inventory.totalPnlAt(next.p) + makerRebatesUsdc;
    pnlSeriesUsdc.push(pnl);
    log.push({
      t: tick.t,
      midprice: tick.p,
      variance: v,
      reservationPrice: quotes.reservationPrice,
      halfSpread: quotes.halfSpread,
      bid: quotes.bid?.price ?? null,
      ask: quotes.ask?.price ?? null,
      inventory: inventory.snapshot().net,
      fillThisTick: fillSide,
      fillPrice,
      pnlUsdc: pnl,
    });
  }

  const summary = computeSummary(log, pnlSeriesUsdc, profitableFills);
  return { log, summary };
}

function computeSummary(
  log: PerTickLog[],
  pnlSeriesUsdc: number[],
  profitableFills: number,
): BacktestSummary {
  const finalPnl = pnlSeriesUsdc[pnlSeriesUsdc.length - 1] ?? 0;
  const fills = log.filter((r) => r.fillThisTick !== null).length;
  const finalInv = log[log.length - 1]?.inventory ?? 0;

  // Per-tick returns from PnL series.
  const returns: number[] = [];
  for (let i = 1; i < pnlSeriesUsdc.length; i++) {
    returns.push(pnlSeriesUsdc[i]! - pnlSeriesUsdc[i - 1]!);
  }
  const mean =
    returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const stddev = Math.sqrt(variance);

  // Annualised Sharpe assuming 1 tick = 1 minute, 525600 minutes/year.
  const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(525_600) : 0;

  // Max drawdown.
  let peak = pnlSeriesUsdc[0] ?? 0;
  let maxDD = 0;
  for (const v of pnlSeriesUsdc) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
  }

  // Inventory turnover.
  const meanAbsInv =
    log.reduce((a, r) => a + Math.abs(r.inventory), 0) /
    Math.max(log.length, 1);
  const totalAbsFillSize = log.reduce(
    (a, r) => a + (r.fillThisTick !== null ? Math.abs(r.fillPrice ?? 0) : 0),
    0,
  );
  const inventoryTurnover = meanAbsInv > 0 ? totalAbsFillSize / meanAbsInv : 0;

  const hitRate = fills > 0 ? profitableFills / fills : 0;

  return {
    ticks: log.length,
    fills,
    finalInventory: finalInv,
    finalPnlUsdc: finalPnl,
    pnlSeriesUsdc,
    meanReturn: mean,
    stddev,
    sharpe,
    maxDrawdown: maxDD,
    hitRate,
    inventoryTurnover,
  };
}

export function formatSummary(s: BacktestSummary): string {
  return [
    `  ticks:               ${s.ticks}`,
    `  fills:               ${s.fills}`,
    `  hit rate:            ${(s.hitRate * 100).toFixed(2)}%`,
    `  final inventory:     ${s.finalInventory.toFixed(2)}`,
    `  final PnL:           $${s.finalPnlUsdc.toFixed(4)}`,
    `  mean ret/tick:       $${s.meanReturn.toFixed(6)}`,
    `  stddev:              $${s.stddev.toFixed(6)}`,
    `  annualised Sharpe:   ${s.sharpe.toFixed(3)}`,
    `  max drawdown:        $${s.maxDrawdown.toFixed(4)}`,
    `  inventory turnover:  ${s.inventoryTurnover.toFixed(2)}`,
  ].join("\n");
}
