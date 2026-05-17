// Paper-mode fill simulator. Given a resting quote pair and the next book
// snapshot, decide which (if any) quotes would have been hit by takers.
//
// Conservative rule:
//   - Our BUY is filled if the next book's best ASK <= our BUY price
//     (a taker willing to sell at our bid price would have hit us)
//   - Our SELL is filled if the next book's best BID >= our SELL price
//
// Fill size is capped by the opposite side's depth at the crossed level.

import type { Quote } from "./quoter.js";
import type { Fill } from "./inventory.js";
import { PolymarketReader } from "./polymarket.js";
import type { OrderBookSummary } from "@polymarket/clob-client-v2";

export interface SimulatedFills {
  buy: Fill | null;
  sell: Fill | null;
}

export function simulateFills(
  ts: number,
  bidQuote: Quote | null,
  askQuote: Quote | null,
  nextBook: OrderBookSummary,
): SimulatedFills {
  const out: SimulatedFills = { buy: null, sell: null };
  const bestAsk = PolymarketReader.bestAsk(nextBook);
  const bestBid = PolymarketReader.bestBid(nextBook);

  if (bidQuote && bestAsk && bestAsk.price <= bidQuote.price) {
    const filledSize = Math.min(bidQuote.size, bestAsk.size);
    out.buy = { ts, side: "BUY", price: bidQuote.price, size: filledSize };
  }
  if (askQuote && bestBid && bestBid.price >= askQuote.price) {
    const filledSize = Math.min(askQuote.size, bestBid.size);
    out.sell = { ts, side: "SELL", price: askQuote.price, size: filledSize };
  }
  return out;
}
