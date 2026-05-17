# Forum — investor deck (10 slides, markdown source)

> Build deck from this with Pitch.com / Notion / Slides. Each `##` heading is one slide.
> All on-chain claims verifiable at `https://testnet.arcscan.app/`. Tx hashes in §Appendix.

---

## 1 · Title

**Forum — Covenant Accounts: programmable USDC credit lines for AI trading agents.**

Stripe Connect + Numerai for autonomous market agents, settled on Arc.

Live · github.com/Ridwannurudeen/forum · MIT

---

## 2 · Problem

AI trading agents now generate real revenue (Polymarket V2 builder fees, Hyperliquid HIP-3 deployer attribution, ETF-rebalancer bots). Capital wants to fund them. But there is no trust-free way for capital to back an agent:

1. **Hand the agent your private key** → the agent (or its operator) can run away with the money.
2. **Use a regulated managed account** → custody, KYC, monthly NAV statements, multi-day onboarding. Doesn't compose with agents that act in milliseconds.
3. **Build your own audit pipeline** → every quant team rebuilds the same thing: mandate enforcement, drawdown gates, position limits, perf-fee crystallisation, slashing on breach. None of it composes across teams or venues.

So capital sits on the sidelines, and bots run on operator-owned wallets where every claim — Sharpe, win-rate, drawdown — is unverifiable marketing.

This is the same gap **Stripe Connect** solved for marketplaces (programmable funds-flow with embedded compliance) and **Numerai** solved for ML models (verifiable performance graph with skin-in-the-game staking). Nobody has built it for autonomous trading agents.

---

## 3 · Solution — Covenant Accounts

A Covenant Account is a USDC vault on Arc whose **mandate is encoded on-chain**:

- `budgetUsdc` — max credit the operator can ever pull from depositors
- `maxDrawdownBps` — automatic pause if peak-to-trough exceeds this
- `receiptFreshnessSec` — automatic pause if the bot stops publishing receipts
- `expiry` — automatic pause at end of mandate
- `perfFeeBps` — operator's share of profits *above* high-water-mark, paid in USDC, crystallised in-contract
- `bondContract` — operator-posted USDC bond that gets **autonomously slashed** on any operator-fault breach

The operator never holds depositor funds. They have *execution rights* against the vault, bounded by the mandate. A permissionless `enforce(vault)` call by any third party flips state to PAUSED **and** transfers slash funds out of the bond — in one tx.

```
┌─────────── Arc (sub-second BFT) ────────────────┐
│                                                 │
│   CovenantVault   ←──  RiskKernelV2 ──→ SlashBond│
│   (depositor      enforce()     attestor (autonomous)
│    capital)                                     │
│           ▲                                     │
│           │     TrackRecordV2 (recomputable     │
│           │     EIP-712 signed receipts +       │
│           │     evidenceUri/Hash hash-chain)    │
│           │                                     │
└──────── AgoraMind agent (LLM) ──────────────────┘
                  │
                  ▼ Polymarket V2 (builder code)
```

Plus: `AgentPool` for non-mandate-bounded permissionless capital, symmetric SDKs (TS + Python), reference V2 keeper, and a live dashboard.

---

## 4 · Why now

| Anchor | Source |
|---|---|
| Circle raised **$222M** for Arc on the "agents are the customer" thesis | CNBC, BlackRock + Apollo lead, May 11 2026 |
| Polymarket V2 launched April 28 2026 with `bytes32` builder attribution per signed order — every existing tool broke | Polymarket docs |
| Coinbase Verifications + Talent Builder Score + Basenames create the first credible identity layer for autonomous actors | Coinbase, June 2025 onward |
| Canteen's *own* hackathon brief asks for: *"a thin agent-as-builder wrapper that registers any agent framework as a Polymarket V2 builder, exposes its structured outputs as a signed feed, and earns USDC builder fees per fill — Arc's ~\$0.01 fees make per-pick economics work at retail size."* | agora.thecanteenapp.com Research #02 |

Covenant Accounts sit one layer below the "agent-as-builder" wrapper Canteen asked for. The thin wrapper exposes the bot; the Covenant Account is what makes someone else's money trust the bot.

---

## 5 · Moat — AgentScore data graph

The single hardest thing in the agent economy to bootstrap is **reputation that can't be faked**. Forum has it as a byproduct of normal operation:

| Layer | Compounding mechanism |
|---|---|
| `TrackRecordV2` | Strict sequence + monotonic time + hash-chain + replay protection + signed `evidenceUri/Hash`. Every record is **recomputable** by a third party from the published receipt JSON. The graph of (botId → records → receipts → realized fills → realized PnL) is the deepest verifiable trading-agent reputation graph that exists. |
| `RiskKernelV2 + SlashBond` | Every breach is on-chain, dated, and stake-backed. "This operator has been slashed 3 times" is a fact, not a Tweet. |
| `CovenantVault` mandate library | Mandate templates (conservative / aggressive / scalping / overnight) become the schema everyone reuses. Schema lock-in is distribution lock-in. |
| Reference keeper + SDKs (TS + Python on npm + PyPI) | "Fork this, change 5 lines, your bot has a verifiable track record and is fundable by anyone." Bottom-up adoption flywheel. |

**The loop:** more bots opt in → reputation graph deepens → capital allocators trust the graph → bots that want capital MUST opt in → more bots opt in.

This is exactly Numerai's flywheel, applied to trading agents instead of ML predictions, with the verification primitive built into the rails instead of bolted on.

---

## 6 · Live traction (verifiable on-chain, Arc testnet 5042002)

- **9 immutable contracts deployed** — BuilderCodeRegistry, KeeperConfig, TrackRecord (v1+v2), FeeDistributor, AgentPool, SlashBond (v1+v1.1), RiskKernel (v1+v2), CovenantVault (v1+v1.1+v1.2). All bytecode-verifiable on `testnet.arcscan.app`.
- **Live AI agent** — AgoraMind keeper running 24/7 as systemd on VPS, quoting 3 Polymarket V2 markets continuously, decision traces hashed and published as receipts.
- **Autonomous pause+slash, end-to-end** — single 162,960-gas tx flipped a vault ACTIVE→PAUSED *and* moved 1.25 USDC out of the operator's bond, all triggered by an organic stale-receipt violation, no choreography. Tx in appendix.
- **Recomputable receipts** — every TrackRecordV2 publish includes `evidenceUri` (nginx-served JSON with full book snapshots + decisions + PnL inputs) and `evidenceHash`. Any third party can download the JSON, recompute the hash, and verify the on-chain claim.
- **Honest backtest** — 16 markets × 7 days × 1-min ticks, ~149K replays. Result: −$77.93 on naive Avellaneda-Stoikov. Published in `docs/backtest-notes.md` as-is, not redacted.
- **CI green** — 61 forge tests + TS typecheck + Python import smoke + vitest (~40 tests) all pass on every push.

---

## 7 · Honest stance on the backtest

Naive A-S on real V2 books over 7 days, 16 markets:

```
total fills:   57
mean Sharpe:   −5.05  (annualised)
total PnL:     −$77.93
sum max DD:    $81.32
```

**This negative result is the most important artifact in the repo.**

Naive market making without maker rebates loses to adverse selection — well-known in the literature (Avellaneda 2008, Cartea/Jaimungal 2015). Forum's variance + momentum gates cut losses 7× vs ungated baseline. The strategy *is* responsive; parameters need real tuning + maker-rebate modelling. None of which is what Forum sells.

**Forum isn't the strategy. Forum is the trust layer that makes anyone's strategy fundable.** With Covenant Accounts, a bad strategy (like our v1) self-disqualifies on chain in 30 minutes via stale receipt or drawdown. A good strategy proves itself through receipts. That's the moat — bad bots get filtered out automatically, capital flows to provable ones.

---

## 8 · Monetisation

| Lever | Path |
|---|---|
| **Performance-fee carry** on Covenant Account vaults | 1–5% of operator's perf fee, paid in USDC at HWM crystallisation. Recurring per vault, scales with AUM. |
| **Bond-slash protocol fee** | 10% of slashed amount (rest goes to depositors). Scales with bond AUM × violation rate. |
| **Reputation-graph API** — paid access to AgentScore data | Prediction-market venues (Polymarket, Kalshi, future Arc-native), funds, allocators. Per-query pricing or enterprise tier. |
| **Hosted keeper-as-a-service** | "Run-my-bot on Covenant Account rails" for non-technical operators. % of attributable fees. |
| **Mandate template marketplace** | Quants publish parametrised mandates ("conservative O/N MM, 7-day expiry"); others stake into them. Curation fee. |

Hackathon v1 is free + permissionless. The contracts are immutable and self-sovereign — there's no rug. Revenue surfaces are off-protocol services and opt-in fee splits, not protocol-mandated taxes.

---

## 9 · Roadmap

| Q3 2026 (post-hackathon) | Q4 2026 | Q1 2027 |
|---|---|---|
| Hashnote USYC integration: idle vault USDC earns yield (`CovenantVault.parkIdle()`) | HIP-3 + Pump.fun adapters | Arc mainnet beta deployment |
| Maker-rebate model in backtest + per-market parameter tuning | First external trading firm depositing into a Covenant Account | Reputation-as-collateral product (borrow against AgentScore) |
| Indexer service for AgentScore reputation graph (replaces RPC-direct frontend reads) | x402 nanopayment integration for signal feeds | Stake-backed leaderboard slashing — capital allocators bet *against* under-performing bots |
| Mandate template library (conservative / aggressive / scalping / overnight) | $10k+/month revenue from hosted vault service + reputation API | Cross-venue identity layer (Polymarket + Hyperliquid + Kalshi attribution under one Forum identity) |

---

## 10 · Ask

We are shipping the substrate Circle just raised \$222M to build a market for.

**The hackathon is the proof.** With:
- A grand prize tier (\$10K / \$7.5K × 2 / \$5K × 3) for projects with clear-substrate wins
- Standout-team tier (\$650–\$750 × ~12) for the contrarian operator-plane angle
- Builder Fund + Circle Developer Grant follow-on for continued traction

…this gives us runway to land the first 5 external trading teams onto Covenant Accounts before mainnet. After that, we want to talk to anyone serious about the agent-economy substrate thesis.

**Contact:** nraheemst@gmail.com · github.com/Ridwannurudeen/forum

---

## Appendix · On-chain proofs (Arc testnet 5042002)

| What | Address / Tx |
|---|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` |
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` |
| `AgentPool` | `0x13855be80b6122187c0bcba007946f9fbaae3fae` |
| `CovenantVault` (v1) | `0xd126e11b3e79e9af23b021d793097a5902aae3ef` |
| `RiskKernelV2` | `0x0af356f280af1d8b7a43f0746c581614feec4055` |
| `SlashBondV1.1` (attestor = RiskKernelV2) | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` |
| `CovenantVaultV1.2` (live AgoraMind bond) | `0x80384963c0c93414ff16e018c6618a64bc94df6d` |
| Genesis builder code claim | tx `0x35b7c33...e519b6` |
| First TrackRecord publish | tx `0x095906f7...d5a5` |
| **First autonomous pause+slash** | tx `0x2c8e79a5...05d13` — 162,960 gas, vault flipped state AND 1.25 USDC moved out of bond, atomic, organic trigger |
| Live frontend | https://forum.gudman.xyz/ |
| Live receipt JSON example | https://forum.gudman.xyz/receipts/201c8909dca1/ |
