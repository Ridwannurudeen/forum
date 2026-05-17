// Avellaneda–Stoikov inventory-aware market making, adapted for binary
// prediction markets where price ∈ (0, 1) and resolution is a known T.
//
// Original A-S (2008):
//   reservation_price r = s - q · γ · σ² · (T - t)
//   half_spread      δ  = ½ · [γ · σ² · (T - t) + (2/γ) · ln(1 + γ/κ)]
//
// Where:
//   s = current midprice
//   q = signed inventory (shares)
//   γ = inventory aversion (higher = more aggressive skew)
//   σ² = price-variance estimate (per-unit-time)
//   T - t = remaining time to terminal (e.g., resolution)
//   κ = market-order arrival-rate density (higher = faster fills)
//
// For prediction markets, we clamp [bid, ask] to (tick_size, 1 - tick_size)
// and round to tick_size since Polymarket has discrete grids.
//
// References:
//   Avellaneda & Stoikov, "High-frequency trading in a limit order book" (2008)
//   Cartea, Jaimungal, Penalva, "Algorithmic and High-Frequency Trading" (2015)

export interface AvellanedaStoikovConfig {
  /** Inventory aversion. Typical: 0.1–2.0. Higher → tighter inventory control. */
  gamma: number;
  /** Market-order arrival intensity (per unit time, per quote distance). Typical: 1.5–4. */
  kappa: number;
  /** Quote size in USDC notional. */
  sizeUsdc: number;
  /** Max absolute inventory (shares) before the quoter goes one-sided. */
  maxInventory: number;
  /** Price tick size (Polymarket V2 typically 0.001 or 0.0001). */
  tickSize: number;
  /** Floor on half-spread, in price units (e.g., 0.001 = 10bps). */
  minHalfSpread: number;
  /** Cap on half-spread (e.g., 0.05 = 500bps). */
  maxHalfSpread: number;
  /** If variance estimate exceeds this, pull quotes entirely (vol regime is unsafe). */
  maxQuotingVariance: number;
  /** Number of warmup ticks before quoting (let the variance estimator stabilise). */
  warmupTicks: number;
}

export const DEFAULT_AS_CONFIG: AvellanedaStoikovConfig = {
  gamma: 0.3, // moderate inventory aversion
  kappa: 1.5, // lower order intensity → wider adverse-sel spread
  sizeUsdc: 5,
  maxInventory: 20, // tighter cap pulls quotes one-sided sooner
  tickSize: 0.001,
  minHalfSpread: 0.005, // 50bps floor — wider than V1's 20bps to dodge noise crosses
  maxHalfSpread: 0.03, // 300bps cap — keep fills happening on real moves
  maxQuotingVariance: 0.0005, // pull quotes when σ² exceeds (e.g., during news)
  warmupTicks: 30, // skip first N ticks while variance estimator stabilises
};

export interface ASQuote {
  side: "BUY" | "SELL";
  price: number;
  size: number;
}

export interface ASQuoteSet {
  midprice: number;
  fairValue: number;
  reservationPrice: number;
  halfSpread: number;
  bid: ASQuote | null;
  ask: ASQuote | null;
}

/**
 * Compute Avellaneda–Stoikov quotes.
 *
 * @param midprice  current observed midprice in (0, 1)
 * @param inventory signed inventory (positive = long shares of YES)
 * @param variance  current variance estimate (σ²) per unit time
 * @param timeToResolution time-to-terminal in same units as variance (e.g., minutes)
 * @param cfg       strategy config
 */
export function asQuotes(
  midprice: number,
  inventory: number,
  variance: number,
  timeToResolution: number,
  cfg: AvellanedaStoikovConfig,
): ASQuoteSet {
  // Skew toward unloading inventory.
  const inventoryPenalty = inventory * cfg.gamma * variance * timeToResolution;
  const reservationPrice = midprice - inventoryPenalty;

  // Half-spread = (1/2) · [γ σ² (T-t) + (2/γ) · ln(1 + γ/κ)]
  const inventoryComponent = (cfg.gamma * variance * timeToResolution) / 2;
  const adverseSelectionComponent =
    (1 / cfg.gamma) * Math.log(1 + cfg.gamma / cfg.kappa);
  let halfSpread = inventoryComponent + adverseSelectionComponent;

  // Clamp half-spread to sane bounds (variance estimates blow up early on).
  halfSpread = Math.max(
    cfg.minHalfSpread,
    Math.min(cfg.maxHalfSpread, halfSpread),
  );

  const round = (p: number): number =>
    Math.round(p / cfg.tickSize) * cfg.tickSize;

  let bidPx = round(reservationPrice - halfSpread);
  let askPx = round(reservationPrice + halfSpread);

  // Enforce price domain (0, 1) and bid < ask after rounding.
  bidPx = Math.max(cfg.tickSize, Math.min(1 - cfg.tickSize, bidPx));
  askPx = Math.max(cfg.tickSize, Math.min(1 - cfg.tickSize, askPx));
  if (bidPx >= askPx) askPx = Math.min(1 - cfg.tickSize, bidPx + cfg.tickSize);

  const bid: ASQuote | null =
    inventory >= cfg.maxInventory
      ? null
      : { side: "BUY", price: bidPx, size: cfg.sizeUsdc };
  const ask: ASQuote | null =
    inventory <= -cfg.maxInventory
      ? null
      : { side: "SELL", price: askPx, size: cfg.sizeUsdc };

  return {
    midprice,
    fairValue: midprice, // could be replaced by an imbalance-adjusted midprice
    reservationPrice,
    halfSpread,
    bid,
    ask,
  };
}

/**
 * Rolling variance estimator for log-price returns.
 *
 * Uses a simple EWMA on squared returns. Stable and online.
 */
export class VarianceEstimator {
  private prevLog: number | null = null;
  private ema: number = 0;
  /** Decay; halfLife=N means weight halves after N samples. */
  private readonly alpha: number;

  constructor(halfLifeSamples: number = 30) {
    this.alpha = 1 - Math.pow(0.5, 1 / Math.max(halfLifeSamples, 1));
  }

  update(price: number): number {
    // Polymarket prices ∈ (0, 1); guard against domain errors.
    const p = Math.max(0.001, Math.min(0.999, price));
    const logp = Math.log(p / (1 - p)); // logit, behaves linearly across (0,1)
    if (this.prevLog === null) {
      this.prevLog = logp;
      return this.ema;
    }
    const r = logp - this.prevLog;
    this.prevLog = logp;
    this.ema = this.ema + this.alpha * (r * r - this.ema);
    return this.ema;
  }

  get value(): number {
    return this.ema;
  }
}

/**
 * Orderbook-imbalance signal: returns midprice shifted by a fraction of the
 * spread toward the heavier side. Positive imbalance (more bid depth) ⇒
 * pushes fair value up; negative ⇒ down.
 *
 *   imbalance = (bidDepth - askDepth) / (bidDepth + askDepth)
 *   fair_value = midprice + imbalance × spread × beta
 *
 * Used for live quoting; not available for the price-history backtest.
 */
export function imbalanceFairValue(
  midprice: number,
  bidDepth: number,
  askDepth: number,
  spread: number,
  beta: number = 0.3,
): number {
  const total = bidDepth + askDepth;
  if (total <= 0) return midprice;
  const imbalance = (bidDepth - askDepth) / total;
  return midprice + imbalance * spread * beta;
}
