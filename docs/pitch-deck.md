# Forum — investor deck (10 slides, markdown source)

> Build deck from this with Pitch.com / Notion / Slides. Each `##` heading is one slide.
> Numbers are sourced from on-chain state at the time of writing and `docs/backtest-notes.md`.

---

## 1 · Title

**Forum — the operator and reputation substrate for the autonomous-agent economy.**

Live on Arc · github.com/Ridwannurudeen/forum · MIT

---

## 2 · Problem

When agents started earning revenue on-chain, four operator problems showed up everywhere and got solved nowhere:

1. **Identity.** Builder codes attribute fees on Polymarket V2, Hyperliquid HIP-3, Pump.fun. Each is a separate `bytes32`/PDA with no cross-venue registry. Anyone can squat your code.
2. **Live config.** Operators tune spread / size / inventory daily. Today: SSH and edit a YAML.
3. **Verifiable track record.** Every agent claims great returns. Zero of them are cryptographically falsifiable. Numerai proved this matters for ML models — nothing exists for trading agents.
4. **Fee settlement.** Builder fees arrive on Polygon as pUSD. Cross-chain split logic for multi-party builder consortia: doesn't exist.

Each of these is an internal hack at every quant team. Together they're a missing market structure.

---

## 3 · Solution — Forum

Four immutable contracts on Arc (`5042002`):

| Contract | Role |
|---|---|
| `BuilderCodeRegistry` | First-claim-wins binding `bytes32` → owner. ERC-8021-compatible. |
| `KeeperConfig` | Append-only per-bot config history operators write, bots read. |
| `TrackRecord` | EIP-712-signed PnL entries by `BotKind` (MAKER/TAKER/ARB/OTHER). |
| `FeeDistributor` | Per-code attribution table; pull-pattern USDC claim. |

Plus symmetric SDKs (TS + Python), a reference V2 market-making keeper, and a single-file dashboard.

---

## 4 · Why now

| Anchor | Source |
|---|---|
| Circle raised **$222M** for Arc on the "agents are the customer" thesis | CNBC, BlackRock + Apollo lead, May 11 2026 |
| Polymarket V2 launched April 28 2026 — `bytes32` builder attribution per signed order; broke every public MM tool | Polymarket docs |
| Hyperliquid HIP-3 went live Oct 2025 — `~$790M OI` by Jan 2026 with deployer-level attribution | The Block |
| Canteen's *own* May 1 essay called the exact lane: *"a thin agent-as-builder wrapper that registers any agent framework as a Polymarket V2 builder, exposes its structured outputs as a signed feed, and earns USDC builder fees per fill — Arc's ~\$0.01 fees make per-pick economics work at retail size."* | agora.thecanteenapp.com Research #02 |

We're building the substrate Allaire told investors he needs. The hackathon's own research told us what to build.

---

## 5 · Moat — flywheel, not first-mover

| Layer | Compounding mechanism |
|---|---|
| `BuilderCodeRegistry` | First credible Arc-side cross-venue identity becomes the default. ERC-8021-compatible (complementary to Base, not competing). |
| `TrackRecord` | Data moat — longest verifiable reputation graph wins capital allocation. |
| `FeeDistributor` | Integration lock-in — once bots route fees through Forum, switching has real cost (re-onboarding recipients). |
| Reference keeper + SDKs | Distribution — "fork this, change 5 lines, you're earning attributable fees with a verifiable track record." Bottom-up adoption flywheel. |

**The loop:** more bots register → reputation graph deepens → trust enables capital flows to top agents → top agents need Forum to receive/split fees → more bots register.

---

## 6 · Live traction (verifiable on-chain)

- **4 contracts** immutably deployed on Arc testnet (chain 5042002), all bytecode-verified
- **5 bots** registered across all 4 `BotKind` enums (MAKER/TAKER/ARB/OTHER + continuous keeper)
- **Continuous reference keeper** running 24/7 on VPS as systemd, publishing TrackRecord every ~10 min across 5 simultaneously-quoted Polymarket V2 markets
- **End-to-end fee flow proven**: 5 USDC routed through `FeeDistributor` with 70/30 attribution, recipient claim works
- **20+ on-chain transactions** during the event window and counting (~144 publishes/day from the keeper alone)
- **Real backtest pipeline**: 16 markets × 7 days × 1-min ticks (~149K replays), full Avellaneda-Stoikov with vol-regime and momentum gates, fully reproducible (`scripts/pull-prices.mjs` + `scripts/run-backtest.mjs`)
- **CI green**: forge build/test + TS typecheck + Python import — all pass on every push

---

## 7 · Honest backtest

Naive A-S on real V2 books over 7 days, 16 markets:

```
total fills:   57
mean Sharpe:   -5.05  (annualised)
total PnL:     -$77.93
sum max DD:    $81.32
```

**This negative result is the most important artifact in the repo.**

Naive MM without maker rebates is well-known to lose to adverse selection (literature: Avellaneda 2008, Cartea/Jaimungal 2015). The variance + momentum gates we built cut losses 7× vs no-gate baseline — the strategy *is* responsive; parameters need real tuning + maker rebate modelling.

**The investor frame:** Forum isn't the strategy, it's the verifiable performance layer. With it, users can falsify any operator's pitch on-chain. Bad strategies (like our v1) self-disqualify; capital flows to proven ones. That's the network effect.

---

## 8 · Monetisation (v2)

| Lever | Path |
|---|---|
| **Protocol fee** on USDC flowing through `FeeDistributor` | 5bps takerate; scales with attribution GMV |
| **Premium analytics tier** on operator dashboard | Risk-adjusted leaderboards, Sharpe percentiles, alerting — SaaS subscription |
| **Hosted keeper-as-a-service** | "Run-my-MM" for non-technical operators; X bps of attributable fees |
| **Enterprise reputation-graph access** | Prediction-market venues (Polymarket, Kalshi, future Arc-native ones) pay for reputation-API to reward proven bots / slash bad ones |

Hackathon v1 is free + permissionless. The contracts are immutable and self-sovereign — there's no rug. Revenue surfaces are off-protocol services, not protocol-mandated taxes.

---

## 9 · Roadmap

| Q3 2026 (post-hackathon) | Q4 2026 | Q1 2027 |
|---|---|---|
| Maker-rebate model in backtest; per-market parameter tuning | HIP-3 + Pump.fun adapters | Mainnet beta (Arc) |
| Orderbook-imbalance fair-value wired to live keeper | First external bot adopter | Reputation-as-collateral product |
| Frontend v2: Next.js + shadcn + live PnL charts | x402 nanopayment integration for signal feeds | Enterprise reputation-API ($) |
| Onboard 3 external bots via Canteen + Arc Discord outreach | $1k/month revenue from hosted keeper | Stake-backed leaderboard slashing |

---

## 10 · Ask

We're shipping the substrate Circle just raised \$222M to build a market for.

**The hackathon is the proof.** With:
- A grand prize tier ($10K / $7.5K × 2 / $5K × 3) for clear-substrate wins
- Standout-team tier ($650–\$750 × ~12) for the contrarian operator-plane angle
- Builder-Fund follow-on for projects with continued traction

…this gives us the runway to recruit the first 10 external bots before mainnet. After that, we want to talk to anyone serious about the agent-economy substrate thesis.

**Contact:** nraheemst@gmail.com · github.com/Ridwannurudeen/forum
