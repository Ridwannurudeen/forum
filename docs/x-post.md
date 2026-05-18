# Forum — X/Farcaster post drafts

> Pick one. No emojis (per global memory rule). Tag handles only after you verify them — `@thecanteenapp` matches the URL `thecanteenapp.com`, but I haven't verified `@arc` is the right Arc handle (could be `@arc`, `@arc_network`, `@arcdotnetwork`, etc.). Check before posting.
> Post once frontend is publicly reachable (forum.gudman.xyz live) — currently live.

---

## Variant A — direct pitch (recommended)

```
Shipping Forum: Covenant Accounts — programmable USDC credit lines for AI trading agents.

One vault on Arc. Operator gets execution rights bounded by an on-chain mandate (budget, drawdown, freshness, expiry, perf-fee, slash bond). They never custody the funds.

Anyone can call enforce(vault) — one tx flips it to PAUSED and slashes the bond. Atomic. No oracle.

Live demo tx (162,960 gas, 1.25 USDC autonomously slashed):
testnet.arcscan.app/tx/0x2c8e79a5...05d13

13 immutable contracts. 85 forge tests green.

https://github.com/Ridwannurudeen/forum
https://forum.gudman.xyz

Built for the Agora Agents Hackathon. @thecanteenapp
```

---

## Variant B — proof-first framing

```
We built a Covenant Account on Arc — and triggered it to slash itself, live, on-chain.

AgoraMind keeper missed its 30-minute publish window. Anyone could then call RiskKernelV2.enforce(vault). One did. In one tx (162,960 gas) the vault flipped to PAUSED and 1.25 USDC moved out of the operator's bond.

Atomic. Permissionless. No oracle. No off-chain step.

This is the primitive that makes AI agents fundable: capital deposits USDC, the bot gets bounded execution rights, the mandate enforces itself.

Live tx: testnet.arcscan.app/tx/0x2c8e79a5...05d13
Repo: github.com/Ridwannurudeen/forum
Frontend: forum.gudman.xyz

For Agora Agents Hackathon · Canteen × Circle × Arc. @thecanteenapp
```

---

## Variant C — single-line teaser

```
Forum: programmable USDC credit lines for AI trading agents, on Arc.

One vault, on-chain mandate, autonomous pause+slash in one tx. Live demo tx (1.25 USDC slashed in 162,960 gas):
forum.gudman.xyz

@thecanteenapp
```

---

## Discord channel announcement (Canteen #showcase or similar)

> Post after `arc-canteen` CLI is authenticated and the live demo is verified one more time.

```
Shipped Forum for Agora — Covenant Accounts on Arc.

What it is:
- A USDC vault where the operator gets execution rights bounded by an on-chain mandate (budget, drawdown, receipt freshness, expiry, perf-fee, slash bond). Never custodies depositor funds.
- A permissionless RiskKernelV2.enforce(vault) call that flips state AND slashes the operator's bond in one tx, atomically.

What's live:
- 13 immutable contracts on Arc testnet (chain 5042002)
- 85 forge tests green on CI
- AgoraMind LLM keeper publishing recomputable receipts every ~10 min, nudging the kernel each cycle
- First autonomous slash settled on-chain: tx 0x2c8e79a5...05d13 (162,960 gas, 1.25 USDC moved)
- Receipt JSON served at forum.gudman.xyz/receipts/ — keccak verifiable against on-chain evidenceHash

What's not (honest):
- No external trading firm has deposited yet (operator self-funded for the demo)
- Real Polymarket orders not yet submitted (paper-mode default)
- Circle stack usage beyond USDC+Arc is mostly roadmap (Paymaster doesn't yet support Arc testnet; USYC parkIdle, CCTP bridges are next)

Repo: github.com/Ridwannurudeen/forum
Frontend: forum.gudman.xyz
Submission: SUBMISSION.md

Looking for: 1-2 trading teams who want to deposit a token amount into a Covenant Account and run their bot under a real mandate. Happy to walk through the integration.
```

---

## Honest backtest note (optional reply / quote-tweet)

```
The naive Avellaneda-Stoikov backtest in the repo loses -$77.93 across 16 markets / 7 days. Posted as-is.

Forum isn't the strategy. It's the trust layer that makes anyone's strategy fundable. With a Covenant Account, a bad strategy (like our v1) self-disqualifies on chain in 30 minutes — receipt goes stale or drawdown breaches, enforce() pauses + slashes. Bad bots filter out automatically; capital flows to provable ones.

Full backtest in docs/backtest-notes.md.
```
