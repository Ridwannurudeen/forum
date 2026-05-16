#!/usr/bin/env python3
"""Pull 30 days of Polymarket V2 market metadata + trades for backtest.

Used by D8 backtest harness. Stores to data/historical/<market_id>.json
(metadata) and data/historical/<market_id>.trades.jsonl (trade stream).

Usage:
    python scripts/pull-historical.py --markets 10 --days 30
    python scripts/pull-historical.py --slugs slug1,slug2,slug3

Network: gamma-api.polymarket.com (public, rate-limited).
Strategy: pull active V2 markets sorted by liquidity, take top N, dump each.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Iterable

GAMMA = "https://gamma-api.polymarket.com"
DATA_API = "https://data-api.polymarket.com"
OUT = pathlib.Path("data/historical")


def _get(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> Any:
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{qs}"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            time.sleep(2**attempt)


def discover_markets(
    limit: int, min_liquidity_usdc: float = 1_000.0
) -> list[dict[str, Any]]:
    """Pull active V2 markets sorted by liquidity descending."""
    raw = _get(
        f"{GAMMA}/markets",
        {
            "limit": min(limit * 5, 500),
            "active": "true",
            "closed": "false",
            "order": "liquidity",
            "ascending": "false",
        },
    )
    if not isinstance(raw, list):
        raise RuntimeError(f"Unexpected gamma response: {type(raw)}")
    out = []
    for m in raw:
        if not m.get("enableOrderBook"):
            continue
        try:
            liq = float(m.get("liquidity") or 0)
        except (TypeError, ValueError):
            liq = 0.0
        if liq < min_liquidity_usdc:
            continue
        out.append(m)
        if len(out) >= limit:
            break
    return out


def fetch_market(slug: str) -> dict[str, Any]:
    rows = _get(f"{GAMMA}/markets", {"slug": slug, "limit": 1})
    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f"Market not found: {slug}")
    return rows[0]


def dump_market(market: dict[str, Any]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    mid = market.get("id") or market.get("conditionId") or market["slug"]
    meta_path = OUT / f"{mid}.json"
    meta_path.write_text(json.dumps(market, indent=2))
    print(f"  meta  -> {meta_path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markets", type=int, default=10, help="Top-N by liquidity")
    ap.add_argument(
        "--days", type=int, default=30, help="Days of history (informational)"
    )
    ap.add_argument(
        "--slugs", type=str, help="Comma-separated slugs (overrides --markets)"
    )
    ap.add_argument(
        "--min-liquidity",
        type=float,
        default=1_000.0,
        help="Skip markets with less than this USDC liquidity",
    )
    args = ap.parse_args()

    markets: Iterable[dict[str, Any]]
    if args.slugs:
        slugs = [s.strip() for s in args.slugs.split(",") if s.strip()]
        print(f"Fetching {len(slugs)} markets by slug...")
        markets = [fetch_market(s) for s in slugs]
    else:
        print(
            f"Discovering top {args.markets} V2 markets by liquidity "
            f"(min ${args.min_liquidity:,.0f})..."
        )
        markets = discover_markets(args.markets, args.min_liquidity)

    print(
        f"Found {len(list(markets) if not isinstance(markets, list) else markets)} markets."
    )
    if not isinstance(markets, list):
        markets = list(markets)

    for m in markets:
        slug = m.get("slug", "?")
        liq = m.get("liquidity", "?")
        end = m.get("endDate", "?")
        print(f"\n{slug}  liq={liq}  ends={end}")
        dump_market(m)

    print(f"\nDONE. Pulled {len(markets)} markets to {OUT.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
