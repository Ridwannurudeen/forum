// Fair-value estimation and two-sided quote generation.
// Two strategies for fair value:
//   - 'midprice'  : (bestBid + bestAsk) / 2, naive
//   - 'ewma'      : exponentially-weighted moving average of midprices

export type FairValueStrategy = "midprice" | "ewma";

export interface QuoterConfig {
  /** Fair-value strategy. */
  strategy: FairValueStrategy;
  /** EWMA half-life in ticks (only when strategy='ewma'). */
  ewmaHalfLife: number;
  /** Half-spread in basis points (1bp = 0.01%). */
  spreadBps: number;
  /** Quote size in USDC. */
  sizeUsdc: number;
  /** Inventory skew: how much to shift midpoint per unit inventory. */
  skewBpsPerUnit: number;
  /** Max inventory (absolute) before quoter goes one-sided. */
  maxInventory: number;
  /** Polymarket tick size — quotes get rounded to this. */
  tickSize: number;
}

export const DEFAULT_QUOTER_CONFIG: QuoterConfig = {
  strategy: "midprice",
  ewmaHalfLife: 10,
  spreadBps: 50, // 0.50%
  sizeUsdc: 5,
  skewBpsPerUnit: 5,
  maxInventory: 50,
  tickSize: 0.001,
};

export interface Quote {
  side: "BUY" | "SELL";
  price: number; // 0..1 (Polymarket convention)
  size: number; // USDC notional
}

export interface QuoteSet {
  fairValue: number;
  bid: Quote | null;
  ask: Quote | null;
}

export class FairValueEstimator {
  private ema: number | null = null;
  private readonly alpha: number;

  constructor(
    private readonly cfg: Pick<QuoterConfig, "strategy" | "ewmaHalfLife">,
  ) {
    // alpha derived from half-life: alpha = 1 - 2^(-1/halfLife)
    this.alpha = 1 - Math.pow(0.5, 1 / Math.max(cfg.ewmaHalfLife, 1));
  }

  update(midprice: number): number {
    if (this.cfg.strategy === "midprice") return midprice;
    this.ema =
      this.ema === null
        ? midprice
        : this.ema + this.alpha * (midprice - this.ema);
    return this.ema;
  }

  /** Reset the estimator (e.g., after market gap or risk halt). */
  reset(): void {
    this.ema = null;
  }
}

export class QuoteGenerator {
  constructor(private cfg: QuoterConfig) {}

  /** Round a price to the configured tick size. */
  private round(p: number): number {
    return Math.round(p / this.cfg.tickSize) * this.cfg.tickSize;
  }

  /** Generate two-sided quotes given fair value and current inventory. */
  generate(fairValue: number, inventory: number): QuoteSet {
    if (fairValue <= 0 || fairValue >= 1) {
      return { fairValue, bid: null, ask: null };
    }
    // Inventory skew: positive inventory => lower midpoint (encourages sells)
    const skewFrac = (this.cfg.skewBpsPerUnit / 10_000) * inventory;
    const adjustedMid = fairValue - skewFrac;
    const half = this.cfg.spreadBps / 10_000;
    let bidPx = this.round(adjustedMid - half);
    let askPx = this.round(adjustedMid + half);

    // Guard against bad rounding (bid >= ask) and stay strictly inside (0,1).
    bidPx = Math.max(this.cfg.tickSize, Math.min(1 - this.cfg.tickSize, bidPx));
    askPx = Math.max(this.cfg.tickSize, Math.min(1 - this.cfg.tickSize, askPx));
    if (bidPx >= askPx) {
      askPx = Math.min(1 - this.cfg.tickSize, bidPx + this.cfg.tickSize);
    }

    // One-sided when inventory hits the cap.
    const bid: Quote | null =
      inventory >= this.cfg.maxInventory
        ? null
        : { side: "BUY", price: bidPx, size: this.cfg.sizeUsdc };
    const ask: Quote | null =
      inventory <= -this.cfg.maxInventory
        ? null
        : { side: "SELL", price: askPx, size: this.cfg.sizeUsdc };

    return { fairValue, bid, ask };
  }

  updateConfig(cfg: Partial<QuoterConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  get config(): Readonly<QuoterConfig> {
    return this.cfg;
  }
}
