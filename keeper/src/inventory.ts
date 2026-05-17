// Per-market position tracker. Records each (simulated) fill and computes
// realized + unrealized PnL on the fly. Pure logic, no I/O.

export interface Fill {
  ts: number;
  side: "BUY" | "SELL";
  price: number; // 0..1
  size: number; // USDC notional
}

export interface Position {
  /** Net signed inventory: positive = long shares, negative = short shares. */
  net: number;
  /** Weighted-average cost basis (price per share) of current position. */
  avgPx: number;
  /** Realized PnL in USDC (locked in on closing trades). */
  realizedUsdc: number;
  /** Number of fills processed. */
  fills: number;
  /** Last fill timestamp (ms). */
  lastFillTs: number;
}

export class InventoryTracker {
  private pos: Position = {
    net: 0,
    avgPx: 0,
    realizedUsdc: 0,
    fills: 0,
    lastFillTs: 0,
  };

  apply(fill: Fill): void {
    const signed = fill.side === "BUY" ? +fill.size : -fill.size;
    const prevNet = this.pos.net;
    const newNet = prevNet + signed;

    if (prevNet === 0 || Math.sign(prevNet) === Math.sign(signed)) {
      // Opening or adding to existing position — update weighted avg cost.
      const absPrev = Math.abs(prevNet);
      const absSigned = Math.abs(signed);
      this.pos.avgPx =
        absPrev + absSigned > 0
          ? (this.pos.avgPx * absPrev + fill.price * absSigned) /
            (absPrev + absSigned)
          : fill.price;
    } else {
      // Reducing or flipping position — realize PnL on the closed portion.
      const closing = Math.min(Math.abs(signed), Math.abs(prevNet));
      const pnlPerShare =
        prevNet > 0
          ? fill.price - this.pos.avgPx // closing a long: sold at fill.price
          : this.pos.avgPx - fill.price; // closing a short: bought at fill.price
      this.pos.realizedUsdc += closing * pnlPerShare;

      if (Math.abs(signed) > Math.abs(prevNet)) {
        // Position flipped — remaining signed amount opens a new position.
        this.pos.avgPx = fill.price;
      }
      // If still closing (no flip), avgPx stays the same.
    }

    this.pos.net = newNet;
    this.pos.fills += 1;
    this.pos.lastFillTs = fill.ts;

    if (this.pos.net === 0) this.pos.avgPx = 0;
  }

  /** Mark-to-market the current position. */
  unrealizedAt(markPrice: number): number {
    if (this.pos.net === 0) return 0;
    return this.pos.net * (markPrice - this.pos.avgPx);
  }

  totalPnlAt(markPrice: number): number {
    return this.pos.realizedUsdc + this.unrealizedAt(markPrice);
  }

  snapshot(): Readonly<Position> {
    return { ...this.pos };
  }
}
