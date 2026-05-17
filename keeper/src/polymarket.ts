// Thin wrapper over @polymarket/clob-client-v2 for the read-only paper-mode keeper.
// We need: market discovery, order book snapshots, midpoint, tick size.
// We do NOT need: order submission (paper mode); wallet signing (read-only).

import {
  ClobClient,
  Chain,
  type OrderBookSummary,
} from "@polymarket/clob-client-v2";

const POLYMARKET_CLOB_HOST = "https://clob.polymarket.com";
const POLYMARKET_GAMMA = "https://gamma-api.polymarket.com";

export interface MarketSpec {
  conditionId: string;
  slug: string;
  question: string;
  endDate: string;
  tokenIds: [string, string]; // [yes, no] outcome tokens
  yesToken: string;
  liquidity: number;
}

export class PolymarketReader {
  private readonly clob: ClobClient;

  constructor() {
    // Polygon mainnet (V2 lives here). Read-only — no signer needed.
    this.clob = new ClobClient({
      host: POLYMARKET_CLOB_HOST,
      chain: Chain.POLYGON,
    });
  }

  /** Pull active V2 markets sorted by liquidity descending. */
  async discoverMarkets(
    limit: number,
    minLiquidityUsdc = 1_000,
  ): Promise<MarketSpec[]> {
    // Gamma's `order=liquidity&ascending=false` is unreliable — many top results
    // come back with tiny liquidity. Fetch a wide page and filter client-side.
    const fetchCount = Math.min(Math.max(limit * 20, 100), 500);
    const url =
      `${POLYMARKET_GAMMA}/markets?limit=${fetchCount}` +
      `&active=true&closed=false&order=liquidity&ascending=false`;
    const res = await fetch(url, {
      headers: {
        "user-agent": "forum-keeper/0.0.1",
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`gamma /markets failed: ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;

    const out: MarketSpec[] = [];
    for (const m of rows) {
      if (!m.enableOrderBook) continue;
      const liq = Number(m.liquidity ?? 0);
      if (liq < minLiquidityUsdc) continue;
      const tokenIdsRaw = m.clobTokenIds;
      let tokenIds: string[] = [];
      if (typeof tokenIdsRaw === "string") {
        try {
          tokenIds = JSON.parse(tokenIdsRaw) as string[];
        } catch {
          continue;
        }
      } else if (Array.isArray(tokenIdsRaw)) {
        tokenIds = tokenIdsRaw as string[];
      }
      if (tokenIds.length !== 2) continue;
      out.push({
        conditionId: String(m.conditionId ?? ""),
        slug: String(m.slug ?? ""),
        question: String(m.question ?? ""),
        endDate: String(m.endDate ?? ""),
        tokenIds: [tokenIds[0]!, tokenIds[1]!],
        yesToken: tokenIds[0]!,
        liquidity: liq,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async fetchBook(tokenId: string): Promise<OrderBookSummary> {
    return this.clob.getOrderBook(tokenId);
  }

  /** Best bid (highest price someone will pay). null if empty side. */
  static bestBid(
    book: OrderBookSummary,
  ): { price: number; size: number } | null {
    const b = book.bids?.[book.bids.length - 1]; // V2 returns bids sorted ascending
    if (!b) return null;
    return { price: Number(b.price), size: Number(b.size) };
  }

  /** Best ask (lowest price someone will accept). null if empty side. */
  static bestAsk(
    book: OrderBookSummary,
  ): { price: number; size: number } | null {
    const a = book.asks?.[book.asks.length - 1]; // V2 returns asks sorted descending
    if (!a) return null;
    return { price: Number(a.price), size: Number(a.size) };
  }
}
