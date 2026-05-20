# Forum — Honest Status (what's real vs. operator-gated vs. needs third parties)

This document is deliberately self-critical. Forum is a **real, working
demonstration of the mechanics** of an agent capital-control layer on Arc. It is
**not** yet a complete, adopted, multi-party product. We'd rather call that out
ourselves than have a judge find it.

Verified on Arc testnet (chainId 5042002). Operator/deployer for all first-party
activity: `0x13585c…30770`. Live API: https://forum.gudman.xyz/api

## ✅ Genuinely real (verified on-chain)

- **Programmable credit line works end-to-end.** The operator credit surface was
  exercised on-chain: `pullCredit` → `returnCapital` → `crystalliseFee` on
  `CovenantVaultV1_2`. The vault now shows a live drawn balance
  (`operatorOutstanding = 1 USDC`; live idle/assets vary as router and risk
  events settle). See `keeper/scripts/demo-credit-cycle.mjs`.
- **Autonomous risk control.** `RiskKernelV2.enforce()` is permissionless and
  atomically pauses + slashes. One genuine historical slash (1.25 USDC; 4.33 USDC
  cumulative on-chain). `SlashBondV1_1` internal and real token balances agree.
- **Recomputable receipts.** `keeper/src/receipt.ts` `verifyReceipt` recomputes
  realized + unrealized PnL from fills/inventory/book marks (not just a hash).
  `keeper/scripts/verify-receipt.mjs` on the real-fill receipt returns `pnl: valid`.
- **Real Polymarket V2 mainnet fills.** Two real Polygon fills, builder
  attribution confirmed by Polymarket's API, one anchored as a verified Arc
  receipt. See `GET /api/proof` and the **Polymarket** console tab.
- **Real-fill bot is now a funded Covenant Account.** A funded (1 USDC),
  risk-enforced, slashable vault (`0x4B78fa94…E61d`) is bound to the real-fill
  bot `0x75d6577d…0ef0` (`linkedVaults` non-empty). See
  `keeper/scripts/bind-real-fill-vault.mjs`. **Caveat:** the historical $2 fill
  predated this vault and used the operator's own Polymarket pUSD — the vault did
  not fund that specific trade (see "operator-gated" below).
- **Live infra:** self-serve `CovenantVaultFactory.createVault()`, fresh indexer
  (`/api/health`), AgentScore, in-browser CCTP V2 bridge tx-builder, SDKs
  (TS clean, source-only — not published, stated honestly).
- **Live Claude agent.** The AgoraMind keeper publishes enriched decision traces
  (action / conviction / risk-posture / reasoning) and self-governs (can request
  pause). Live trace `000145` is stamped `claude-sonnet-4-6`; D95 throttles
  model calls to publish cycles for cost control.

## ⚠️ First-party demo (real mechanism, but self-operated)

These work on real contracts but every participant is the operator wallet. The
mechanism is proven; **adoption is not**.

- Vault deposits, the credit pull, the CapitalRouter (5 USDC, 1 depositor,
  routing across 2 vault targets today), the FeeRouter split, SlashMarket stake, and
  SlashInsurance premium are all the deployer transacting with itself. Total real
  capital deposited into contracts is single-digit USDC (the deployer wallet
  itself holds ~77 USDC that is simply not in the product).

## 🔒 Operator-gated (cannot be self-serve by design)

- **Live Polymarket trading.** Polymarket geoblocks order submission and requires
  the operator's keys, so it is exposed as the **operator-run flow** in the
  Polymarket tab (copyable commands), not a public trade button.
- **Vault-funded Polymarket trading (the deep gap).** Arc vault USDC is not
  Polymarket `pUSD`; truly funding a Polymarket trade from vault capital needs
  CCTP → Polymarket-deposit automation. Not built. This is why the credit-pull
  proof and the real-fill proof are connected at the *account/risk* layer but not
  at the *capital-flow* layer.
- **CCTP mainnet transfer.** The bridge builds correct, address-verified txs and
  polls Circle's Iris sandbox; a full mainnet end-to-end transfer needs
  source-chain gas + USDC and has not been run.
- **Builder fee revenue.** Wiring + attribution proven, but `builderFeeRateBps = 0`
  → $0 captured. Setting a rate on Polymarket is a settings-page knob.

## ❌ Needs real third parties (we will not fake these)

- External allocators / users with real capital.
- Real market price discovery (counterparties on SlashMarket/SlashInsurance).
- Real fee revenue split across distinct operator/researcher/referrer parties.
- Production security audit; on-chain allowed-venue restriction.

## The 10-point intended system — reality map

| # | Step | Status |
|---|---|---|
| 1 | Allocator funds CovenantVault | Real, **self-funded** |
| 2 | Operator posts slashable bond | **Real** |
| 3 | Agent draws bounded credit & trades | Credit pull now **real on-chain**; vault→real-trade capital flow is operator-gated (cross-chain) |
| 4 | Agent publishes receipts | **Real + live** |
| 5 | Forum verifies fills / PnL / freshness | **Real** |
| 6 | RiskKernel pauses / slashes | **Real** |
| 7 | AgentScore ranks agents | **Real** |
| 8 | Markets price agent failure | Mechanism real; no external liquidity |
| 9 | Router allocates across agents | Mechanism real; self-funded, few targets |
| 10 | Fees split revenue | Mechanism real; $0 real revenue |

## Use cases — honest status

| Use case | Status |
|---|---|
| Capital allocators fund agents with enforceable limits | Mechanism real (vault + credit pull + risk kernel); no external allocator |
| Agent operators prove performance & raise capital | Receipts + AgentScore real; performance is paper-mode |
| Strategy researchers paid via fee splits | Primitive real; $0 paid |
| Referrers/frontends get revenue shares | Primitive real; $0 paid |
| Risk monitors pause/slash bad agents permissionlessly | **Genuinely works** |
| Portfolio builders route across vaults | Router real; self-funded, expanding targets |
| Prediction-market agents publish verifiable receipts | **Proven** (real fill → recomputable Arc receipt) |
| Circle/Arc: move USDC into Arc vaults via CCTP | Bridge builds the real flow; mainnet end-to-end not run |

## Bottom line

The cryptographic core (mandate enforcement, atomic permissionless pause+slash,
recomputable PnL) is real and not vaporware, and as of this pass the credit-line
primitive is exercised and the real-fill bot is a funded Covenant Account. What
remains is **economic, not mechanical**: real third-party capital, real revenue,
and the cross-chain capital-flow automation that would let vault USDC fund a live
Polymarket trade. Those are the honest next milestones.
