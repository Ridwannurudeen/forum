# Forum Multibillion Plan

Date: 2026-05-18

## Recommended Direction

Build Forum into the Covenant Account network for autonomous market agents.

The category is not "a prediction-market bot." The category is "accounts that let capital safely fund agents." The first vertical is prediction-market agents because their decisions, receipts, and outcomes are public enough to bootstrap trust.

## One-Line Thesis

Forum is Stripe Connect plus Numerai for autonomous market agents, settled in USDC on Arc.

Use that line as positioning, not as a claim of equivalent scale today.

## What Is Proven Today

- Live Arc testnet contracts for identity, config, fee distribution, receipts, vaults, risk enforcement, bond slashing, and pooling.
- Live `CovenantVaultV1.2` bound to the AgoraMind bot.
- Live `RiskKernelV2` permissionless enforcement.
- Live `SlashBondV1.1` with `RiskKernelV2` as attestor.
- Live `TrackRecordV2` receipts with public evidence URI/hash.
- First autonomous pause plus slash transaction completed on Arc.
- Browser-side and CLI receipt hash verification.
- TypeScript and Python SDKs now expose the Covenant Account surface.
- CI covers contracts, keeper, SDK typechecks, and Python import smoke.

## What Is Not Proven Yet

- External bot adoption.
- Real capital from third-party depositors.
- Real Polymarket order execution.
- Real builder-fee routing into Arc.
- CCTP/Gateway/USYC/App Kit integration.
- Security audit.

Do not hide these gaps. They are the post-hackathon execution plan.

## Why This Can Become Large

The agent economy needs a capital account primitive. Any agent that moves money needs:

1. identity;
2. bounded authority;
3. public receipts;
4. risk controls;
5. fee routing;
6. capital allocation;
7. reputation.

Forum starts with prediction-market agents, but the same structure applies to perps bots, treasury agents, market makers, cross-chain arbitrage agents, and managed AI portfolios.

## Product Roadmap

### Phase 1: Hackathon Win

Goal: prove the primitive.

- live site;
- live vault;
- live receipt hash verification;
- live pause plus slash proof;
- clean README/SUBMISSION/deck;
- demo video;
- no overclaims.

### Phase 2: First External Bot

Goal: make traction real.

- choose one public bot with structured logs;
- build a real adapter;
- publish at least one `TrackRecordV2` receipt from that adapter;
- get public acknowledgement from the bot maintainer or show reproducible setup instructions.

This matters more than more internal bot records.

### Phase 3: Real Execution Pilot

Goal: prove capital can safely fund execution.

- run small-size paper-to-live transition;
- log every fill with market attribution;
- compute realized/unrealized PnL from fills and inventory;
- route any earned USDC through the FeeDistributor or a documented reconciliation step.

### Phase 4: AgentScore Indexer

Goal: make the receipt graph useful.

- index `TrackRecordV2` events;
- fetch and verify receipts;
- compute freshness, drawdown, slashes, and verified PnL;
- expose API for allocators and UIs.

### Phase 5: Circle Stack Expansion

Goal: deepen Circle alignment without pretending it is live today.

- CCTP/Gateway for cross-chain USDC movement when supported in the target environment;
- USYC parking for idle vault capital;
- App Kit flows for deposit, send, bridge, and unified balance;
- Paymaster if Arc support is available.

## Business Model

- Hosted Covenant Account operations.
- AgentScore reputation API.
- Mandate template marketplace.
- Optional performance-fee routing.
- Enterprise integrations for trading firms and venues.
- Security/risk monitoring for agent portfolios.

Keep base contracts permissionless; monetize the operational and data layer.

## Investor-Grade Milestones

Before a serious investor pitch, ship:

- one external adapter;
- one third-party acknowledgement or reproducible external integration;
- full PnL recomputation for live fills;
- indexer-backed dashboard;
- one real fee routing/reconciliation event;
- security review notes;
- clean data room with deployment addresses, tests, demo video, and risks.

## Hackathon Submission Stance

Submit as:

> Forum is the Covenant Account primitive for market agents on Arc: bounded USDC credit, public receipts, and permissionless risk enforcement.

Do not submit as:

> A profitable AI trading bot.

That claim is not proven and would weaken the project.
