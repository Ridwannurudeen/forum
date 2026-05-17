# Forum — X/Farcaster post drafts

> Pick one. No emojis (per global memory rule). Tag `@thecanteenapp` and `@arc`.
> Post once frontend is publicly reachable (forum.gudman.xyz live).

---

## Variant A — direct pitch (recommended)

```
Shipping Forum:
the operator + reputation substrate for the autonomous-agent economy, on Arc.

4 immutable contracts. SDKs in TS + Python. Reference V2 market-maker keeper
running continuously on VPS, publishing EIP-712-signed track records to
Arc every 10 minutes.

Canteen called the exact lane in their May 1 essay. We built it.

Live on Arc testnet:
https://github.com/Ridwannurudeen/forum
https://forum.gudman.xyz

@thecanteenapp @arc
```

---

## Variant B — research note framing

```
For the Agora Agents Hackathon, we shipped Forum — Arc-native operator
infrastructure for prediction-market bots.

The honest backtest: naive Avellaneda-Stoikov on real Polymarket V2 books
loses $77 across 16 markets over 7 days. Exactly what the literature predicts
for an MM without maker rebates.

That negative result is the whole pitch. Forum's TrackRecord makes every
operator's performance claims cryptographically falsifiable. Bad strategies
self-disqualify on-chain. Capital flows to the proven ones.

Numerai for autonomous agents, on the chain Circle raised $222M to build.

https://github.com/Ridwannurudeen/forum
https://forum.gudman.xyz

@thecanteenapp @arc
```

---

## Variant C — single-line teaser

```
Forum: registry + config + verifiable track record + USDC fee splits for
any prediction-market bot. Live on Arc. Built on the lane Canteen called
in writing.

https://github.com/Ridwannurudeen/forum  @thecanteenapp @arc
```

---

## Discord channel announcement (Canteen #showcase or similar)

> When `arc-canteen` CLI is authenticated and the frontend is live.

```
Shipped Forum for Agora — Arc-native operator + settlement plane for
prediction-market bots.

- 4 immutable contracts on Arc testnet (chain 5042002)
- Continuous reference keeper publishing EIP-712 track records every ~10min
- End-to-end fee flow proven (5 USDC routed through FeeDistributor)
- Honest backtest pipeline (16 markets, 7 days, -$77 portfolio PnL — literally what naive MM should do, that's the point of having a verifiable track record layer)
- SDKs in TS + Python, both CI-green
- Cites your own Research Hack #02 verbatim as the validation

Repo: github.com/Ridwannurudeen/forum
Frontend: forum.gudman.xyz
Submission notes: SUBMISSION.md

Looking for 1-2 external bots to plug in. Happy to write the adapter for
poly-lp-bot, PolyForge, or anyone else with structured cycle output.
```
