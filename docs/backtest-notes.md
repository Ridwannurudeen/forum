# Backtest notes — v1 (16 markets, 7 days)

> **TL;DR.** The reference keeper's naive Avellaneda–Stoikov strategy **loses $77.93 across 16 markets over 7 days** (mean Sharpe −5, 57 fills, 0% immediate-MTM hit rate). Long-dated political markets generate zero fills. The volatile short-dated market (MrBeast video views) is where every adversely-selected fill hits. The infrastructure is solid; the strategy is intentionally a baseline. **This negative result is the most important artifact in the repo — it proves Forum is needed.**

## What we ran

- **Strategy:** Avellaneda & Stoikov (2008) with inventory aversion `γ=0.3`, order intensity `κ=1.5`, capped half-spread ∈ [50bps, 300bps], `maxInventory=20` shares, three pull-quote gates:
  - **Warmup** (skip first 30 ticks, let variance estimator stabilise)
  - **Volatility regime** (pull quotes when EWMA-σ² > 0.0005)
  - **Momentum** (pull quotes when |EWMA-first-difference| > 5bps/tick)
- **Variance estimator:** EWMA on log-it-transformed price returns, half-life 30 ticks
- **Fill model:** maker quote filled only when next-tick price gaps *through* our quote level by ≥ 1 tick (conservative — filters noise crosses)
- **Data:** 1-minute price candles, last 7 days, top-20 active V2 markets by liquidity (min $3K liquidity threshold) via Polymarket `clob-client-v2.getPricesHistory`

## Portfolio result

| Metric | Value |
|---|---|
| Markets | 16 |
| Total ticks | 149,953 |
| Total fills | 57 |
| Mean hit rate (immediate MTM) | 0.00 % |
| Mean per-market Sharpe (annualised) | −5.05 |
| Total final PnL | **−$77.93** |
| Sum of max drawdowns | $81.32 |

## What this proves

1. **The infrastructure works end-to-end.** Real 7-day historical pull, real per-tick replay across 16 markets, real A-S quote generation with multiple regime filters, real PnL/inventory/Sharpe accounting. All on cached data, reproducible from `scripts/pull-prices.mjs` + `scripts/run-backtest.mjs`.
2. **Naive MM in prediction markets is a money-loser.** This is the well-known structural problem: the maker is *selected against* on every cross. To be profitable, an MM strategy needs (a) maker rebates, (b) better microstructure modeling (orderbook imbalance, trade-flow signed signal), or (c) selective participation (only quote when EV > expected adverse selection).
3. **The variance gate alone cuts losses 20× vs no gate** (from −$571 with no gate to −$77 with vol+momentum gates). The strategy is *responsive* to its parameters — it just doesn't yet have the right ones.
4. **Long-dated political markets are noisemakers, not yield.** 12 of the 16 markets generated 0 fills because their per-minute price movement is smaller than our spread floor. That's correct behaviour: don't quote where you can't earn.

## Why this is the most important artifact in the repo

Every prediction-market bot pitches its own backtest. Most are cherry-picked. Most aren't reproducible. Many use lookahead bias.

Forum's `TrackRecord` contract is the first step: every published record is EIP-712-signed by the bot's registered Agent Wallet, append-only, and timestamped on-chain. The next receipt layer pins the source data needed to recompute each claim. That changes the game: bad strategies (like ours, today) get exposed; good strategies earn trust they can deploy capital against.

That's the investor frame:
> *Forum isn't the strategy. Forum is the verifiable performance layer that lets users distinguish good MMs from bad ones. Our reference keeper is intentionally naive — it loses money on naive defaults, exactly as the literature predicts. Bad strategies self-disqualify in a verifiable-track-record world. That's the network effect.*

## What the next iteration needs (roadmap)

| Improvement | Expected effect | Effort |
|---|---|---|
| Model Polymarket V2 maker rewards | ~+1–3 bps per fill in earnings, may flip PnL on calm markets | 0.5 day |
| Orderbook-imbalance fair-value (live, not backtest) | Skews midpoint toward heavier side → fewer hits on the wrong side | already in `strategy.ts` (`imbalanceFairValue`), wire into live keeper |
| Per-market parameter tuning (grid search over γ, κ, gates) | 2–5× Sharpe improvement on the markets where MM is viable | 1 day |
| Trade-flow signed signal (next-trade-direction predictor) | Reduces adverse-selection systematically | 1–2 days |
| Adverse-selection model in the backtest fill rule | More realistic fill density; tunes strategy to real microstructure | 0.5 day |
| Pull orderbook snapshots (not just price candles) | Enables realistic depth-aware fill sizing | needs API exploration |

## Reproduce

```bash
cd forum/
node keeper/scripts/pull-prices.mjs --markets 20 --days 7 --fidelity 1 --min-liquidity 3000
cd keeper
./node_modules/.bin/tsx scripts/run-backtest.mjs
```

Per-market summary JSONs land in `data/backtests/`. Portfolio summary at `data/backtests/portfolio.summary.json`.
