# Forum — Circle Developer Grant Proposal

> **Program:** Circle Developer Grants (Arc) · **Submitted:** June 2026
> **Project:** Forum — credit and accountability rails for the agentic economy on Arc
> **Live:** https://forum.gudman.xyz · **Repo:** https://github.com/Ridwannurudeen/forum
> **Companion OSS:** https://github.com/Ridwannurudeen/arc-agent-console (live: https://arc-console.gudman.xyz)
> **Builder:** Ridwan Nurudeen · GitHub [@Ridwannurudeen](https://github.com/Ridwannurudeen) · Discord `ggudman#8862` · Telegram `@ggudman`

---

## One paragraph

Capital cannot trust an AI agent with a wallet, so the agentic economy on Arc has a missing layer: enforceable mandates between money and the agents that spend it. Forum ships that layer as **Covenant Accounts** — USDC vaults where an agent pulls *bounded* credit under an on-chain mandate, publishes recomputable signed receipts every cycle, and gets paused **and** slashed by anyone, permissionlessly, in a single transaction the moment the mandate breaks. Nineteen contracts are live on Arc testnet today with an autonomous keeper, a real Polymarket V2 mainnet fill anchored on Arc, CCTP V2 wired in two ways, and TS/Python SDKs. This grant funds the path from audited testnet protocol to **day-one Arc mainnet infrastructure**.

## The problem

Every team building agents that spend money rebuilds the same plumbing: spend caps, drawdown gates, performance attestation, kill switches. Today the options are (a) hand the agent a key and hope, (b) a slow custodial managed account, or (c) trust screenshots of PnL. None scale to an economy of autonomous agents settling continuously in USDC.

## What Forum is

One primitive, three layers:

| Layer | What it is | Status |
|---|---|---|
| **Capital** | Covenant Accounts: `CovenantVaultV3` (bond-gated credit), `TrackRecordV2` (signed receipt chain), `RiskKernelV3` (permissionless pause + slash + NAV circuit breaker), `SlashBond` (operator collateral) — plus `CapitalRouter`, `SlashMarket`, `SlashInsurance`, `FeeRouterV1` on top | 19 contracts live on Arc testnet `5042002`, addresses pinned in [`deployments/arc-testnet.json`](deployments/arc-testnet.json) |
| **Spend** | x402 pay-per-call + ERC-4337 session keys for agent payments | Reference implementation live ([arc-agent-console](https://github.com/Ridwannurudeen/arc-agent-console)), wired to Forum's primitives |
| **Developer** | TypeScript (`forum-arc-sdk`) + Python (`forum-arc`) SDKs, fork-ready adapter templates, 10+ endpoint indexer API, OSS starter kit | Shipped; SDK registry publication in progress |

**Trading agents are the wedge, not the market.** The same rails — mandate-bounded credit, recomputable receipts, autonomous slash — apply to any agent that spends USDC on someone else's behalf: procurement agents buying API calls and compute via x402, DAO treasury executors, agent-to-agent escrow, automated rebalancers. We ship trading first because the feedback loop is fastest; the primitive is built generic so the next verticals slot in without redesign.

This maps directly onto three of the program's priority use cases: **agentic economic activity**, **prediction markets**, and **lending/borrowing** (a bond-gated credit line is underwriting for agents — receipts + collateral are the credit score).

## Platform alignment — Circle products in the architecture

Arc is not a deployment target for Forum; it is the control plane. Every balance — vault, bond, slash, fee split — is USDC. Enforcement and receipt publication only work as a *continuous* live system because Arc makes them cheap.

- **Arc** — all mandate state, vault/bond/receipt commitments, enforcement; 19 contracts live.
- **USDC** — vault capital, operator bonds, slashing, fee splits, insurance premiums.
- **CCTP V2** — integrated two ways: an in-browser bridge ([`/#/console?t=bridge`](https://forum.gudman.xyz/#/console?t=bridge)) building the real `depositForBurn` → Iris attestation → `receiveMessage` flow into Arc Domain 26 from four source testnets, and a CLI helper (`keeper/scripts/cctp-bridge-and-deposit.mjs`). `CovenantInbox` is a deployed bridge-friendly deposit wrapper.
- **USYC** — `UsycStrategyAdapter` is code-complete against the Hashnote Teller (`buy`/`sell`) for vault-custodied Treasury yield, verified on-chain to revert pending the **Circle Entitlements allowlist** — i.e., real Treasury yield on idle vault USDC is one allowlist approval away (a concrete ask of this grant relationship).
- **Gateway / Agent stack** — addressed in deployments metadata, targeted in M4 below.

Circle's Agent Wallets enforce spend policy at the wallet layer; Forum is the **on-chain, permissionlessly-enforced** complement — policy that depositors and counterparties can verify and enforce themselves, with slashable collateral behind it.

## Traction — what's shipped (all verifiable)

- **19 contracts live** on Arc testnet, deployed and exercised May 11–26, 2026; CI green ([badge](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml)) across keeper vitest + 22 forge test suites.
- **Autonomous enforcement proven organically**: tx `0x2c8e79a5…305d13` — a single permissionless `enforce()` call paused the live vault and slashed 1.25 USDC from the bond after the keeper missed its receipt window. Not a demo script; the keeper actually went stale. [Proof page](https://forum.gudman.xyz/#/proof).
- **Real Polymarket V2 mainnet fill** settled on Polygon and anchored to `TrackRecordV2` on Arc, with builder attribution confirmed by Polymarket's API — [`/api/proof`](https://forum.gudman.xyz/api/proof), [`docs/phase-3-live-fill-proof.md`](docs/phase-3-live-fill-proof.md).
- **18+ bots indexed across 3 external operators** on the AgentScore leaderboard; receipts recomputable by anyone (`keeper/scripts/verify-receipt.mjs`).
- **Live since May**: frontend, 10+ endpoint indexer API, self-serve vault factory, in-browser CCTP bridge — all running continuously at forum.gudman.xyz.
- **Ecosystem contribution already shipped**: the [arc-agent-console](https://github.com/Ridwannurudeen/arc-agent-console) starter kit (x402 + session keys on Arc, Arc-focused docs, copy-paste examples) is maintained as standalone OSS so any Arc team can fork it.

## Honest gaps → funded milestones

We document our limitations publicly ([README → Honest scope](README.md#honest-scope)). Each gap below is a milestone with an objective acceptance test.

### M1 — Production hardening
- **On-chain venue restrictions**: today the mandate bounds amount and state, but pulled credit transfers to the operator wallet. Ship vault→adapter-only credit (extending the `CovenantVaultV2` strategy-adapter path) so funds never touch an agent-controlled key, for trading venues as well as yield.
- **External security audit** of the Covenant core (`CovenantVaultV3`, `RiskKernelV3`, `SlashBondV1.1`, `TrackRecordV2`) + remediation.
- *Acceptance:* audit report published; venue-restricted vault live on testnet with funds provably never custodied by the operator.

### M2 — Full Circle-stack activation
- **USYC live yield**: Entitlements allowlisting of `UsycStrategyAdapter` → idle vault USDC earning real Treasury yield, recomputable on-chain.
- **CCTP V2 end-to-end on record**: complete and document a full source-chain → Arc → vault-deposit transfer through the in-browser bridge.
- *Acceptance:* a vault position showing USYC yield; a published CCTP transfer proof with tx hashes on both chains.

### M3 — Arc mainnet launch
- Deploy the audited Covenant stack to **Arc mainnet at or near day one**; migrate keeper, indexer, and frontend; mainnet deployment manifest published like `deployments/arc-testnet.json`.
- *Acceptance:* mainnet addresses live, first mainnet Covenant Account funded and enforced.

### M4 — Agentic-commerce expansion + ecosystem growth
- **Spend-side integration**: x402 pay-per-call where the *payer* is a Covenant Account — an agent buying services under an enforceable mandate; evaluate Circle Gateway/Nanopayments for the sub-cent path.
- **Operator growth**: publish SDKs to npm/PyPI (in progress), onboard external operators onto mainnet using the adapter templates, maintain the starter kit against mainnet.
- *Acceptance:* a third-party agent paying for a service from a Covenant Account on mainnet; N external mainnet operators (target set with the grants team).

Funding amounts and timelines: proposed per-milestone through the portal's milestone-design step; we prefer disbursement strictly on acceptance criteria above.

## Why this strengthens the Arc ecosystem

Forum is a primitive other Arc projects compose with, not a closed app: any agent team gets fundability (Covenant Accounts), any allocator gets verifiable performance (TrackRecord + AgentScore), any service gets a trustworthy agentic customer (mandate-backed x402 payments). Every unit of activity it enables is denominated and settled in USDC on Arc — vault deposits, bonds, slashes, fees, premiums, and yield all expand USDC utility. The starter kit and SDKs lower the barrier for the next hundred Arc agent teams.

## Team

Solo builder with proven shipping velocity: 202 commits / 50 merged PRs in 15 days for the Agora Agents hackathon (Canteen × Circle × Arc), spanning Solidity (Foundry), TypeScript keeper + indexer, Python SDK, and a production frontend — all live and continuously running since May 2026. AI-assisted development disclosed transparently in [`AI_USAGE.md`](AI_USAGE.md).

## Links

| | |
|---|---|
| Live product | https://forum.gudman.xyz |
| Repo | https://github.com/Ridwannurudeen/forum |
| Deployment manifest | [`deployments/arc-testnet.json`](deployments/arc-testnet.json) |
| Proofs | [`/#/proof`](https://forum.gudman.xyz/#/proof) · [`/api/proof`](https://forum.gudman.xyz/api/proof) |
| Arc explorer (live vault) | https://testnet.arcscan.app/address/0x80384963c0c93414ff16e018c6618a64bc94df6d |
| Starter kit (OSS) | https://github.com/Ridwannurudeen/arc-agent-console · https://arc-console.gudman.xyz |
| Architecture / security | [`docs/architecture.md`](docs/architecture.md) · [`docs/security-roles.md`](docs/security-roles.md) |
