# Forum multibillion plan

Date: 2026-05-17

## Verdict

Recommended direction: make Forum the trust, routing, and settlement layer for autonomous market agents. Do not pitch it as "a Polymarket bot" or "a dashboard." Pitch it as the agent-market clearing layer: identity, live controls, verifiable receipts, capital allocation, and USDC fee routing for every agent that makes or routes markets.

The current repo is a strong hackathon base, but it is not yet investor-grade. It proves contracts, SDKs, a live Arc deployment, and continuous keeper activity. It does not yet prove external demand, real trading agency, or fully falsifiable performance. The plan below turns the build into something that can win Agora and credibly expand into a venture-scale company.

## Verified source anchors

- Agora judges weight agency and traction equally at 30% each, then Circle tooling and innovation at 20% each. The final delivery requires a public GitHub repo, requires a video demo, and strongly encourages a working live URL. Source: https://agora.thecanteenapp.com/
- Canteen's own research names an "agent-as-builder" wrapper around Polymarket V2 builder codes as a hackathon-shaped opportunity. Source: https://agora.thecanteenapp.com/
- Circle Q1 2026 results report USDC in circulation of $77.0B, Q1 onchain transaction volume of $21.5T, a $222M ARC token presale at a $3B fully diluted Arc network valuation, and new Agent Stack products including Circle CLI, Agent Wallets, and Agent Marketplace. Source: https://www.circle.com/pressroom/circle-reports-first-quarter-2026-results
- Arc docs position Arc for stablecoin finance and agentic economy workflows. App Kit supports Bridge, Swap, Send, and Unified Balance. Sources: https://docs.arc.io/ and https://docs.arc.io/app-kit
- Circle Gateway gives a unified USDC balance and can mint on a destination chain in under 500ms after balance is established. CCTP moves native USDC across chains by burn/mint. Sources: https://developers.circle.com/gateway and https://developers.circle.com/cctp
- Polymarket CLOB V2 is live as of April 28, 2026, uses pUSD collateral, and replaced old builder auth with a single `builderCode` order field. Sources: https://docs.polymarket.com/v2-migration and https://docs.polymarket.com/builders/api-keys
- Polymarket builder fees are flat percentages of notional, builder attribution is part of the signed V2 order struct, and payouts accrue to the builder profile wallet. Source: https://docs.polymarket.com/builders/fees
- KPMG reports Kalshi plus Polymarket exceeded $40B volume in 2025, up from roughly $9B in 2024, and notes some forecasts see annual prediction-market volume reaching $1T by decade end. Source: https://kpmg.com/us/en/articles/2026/prediction-markets-path-entry.html
- The current regulatory posture is still moving. CFTC Chair Michael Selig told Axios he will regulate prediction markets as financial markets, while state and gambling regulators continue to challenge the category. Source: https://www.axios.com/2026/05/12/prediction-markets-cftc-selig-regulation

## What Forum has today

- Four immutable Arc testnet contracts: `BuilderCodeRegistry`, `KeeperConfig`, `TrackRecord`, `FeeDistributor`.
- Live frontend: https://forum.gudman.xyz/
- Public repo: https://github.com/Ridwannurudeen/forum
- Continuous VPS keeper is active.
- Smoke-verified live state after the frontend fix: 5 registered bots, 534 TrackRecord publishes, latest publish seconds old.
- TypeScript SDK typecheck: pass.
- Keeper typecheck: pass.
- Keeper Vitest suite: 23 tests pass.
- Python SDK import smoke: pass in local venv.
- GitHub Actions latest `main` run: green, including Foundry build and tests.

## What is weak or overstated

1. TrackRecord is signed, but not yet fully falsifiable.
   `src/TrackRecord.sol` checks that a record was signed by the registered bot signer, then appends it. It does not enforce sequence, monotonic timestamps, replay protection, or raw evidence availability. A signer can replay a prior record or sign a backdated record. That is attribution, not full falsifiability.

2. The `metaHash` is not enough.
   The keeper currently hashes a short string like tick and market slugs. To make the claim investor-grade, Forum needs a retrievable cycle artifact: order-book snapshot roots, fill/event ids, position balances, PnL calculation inputs, model decision trace, and code version.

3. Fee flow is not yet Polymarket-native.
   Polymarket docs say builder fees accrue through their Builders Service to the builder profile wallet. Forum's `FeeDistributor` can split USDC on Arc, but a fee-router service still needs to bridge or transfer actual builder proceeds into Arc.

4. Traction is mostly self-generated.
   Five bots are registered, but they share the same local operator wallet. For Agora judging and investors, one external bot integration beats 500 internal publishes.

5. The reference keeper is paper mode.
   Paper mode is acceptable for a safe hackathon demo, but the agency score is capped unless the AI has a real decision boundary, a real risk policy, and either real orders or a clearly verified execution simulator.

6. The live frontend was broken and is now fixed.
   The previous dashboard queried `eth_getLogs` from block 0 and hit Arc RPC's 10,000 block range limit. `frontend/index.html` now chunks log reads from the TrackRecord deployment block.

7. Production polish is still thin.
   The single-file dashboard uses Tailwind CDN, has no backend indexer, and depends directly on public RPC from the browser. That is okay for the hackathon, not for a financing process.

## The investor thesis

Forum is the financial trust layer for autonomous agents that route capital.

Agents will not only recommend trades. They will run market-making bots, route prediction-market orders, rebalance portfolios, arbitrate cross-chain liquidity, and sell structured reasoning. Capital will not flow to black-box agents unless owners can answer four questions:

1. Who owns this agent and its fee attribution?
2. What exact strategy and config was running at the time?
3. Did the claimed performance happen, and can anyone recompute it?
4. Where do the fees go when the agent earns?

Forum's wedge is Polymarket V2 builder codes because the need exists now and the hackathon explicitly validates it. The long-term company is broader: the reputation and settlement network for agent-run markets across prediction markets, perps, FX, treasury, and event-risk hedging.

Best one-line investor framing:

> Forum is Stripe Connect plus Numerai for autonomous market agents, settled in USDC on Arc.

## Product architecture to build

### 1. Forum Identity

Purpose: bind venue-specific identifiers to one agent operator identity.

Build:
- `BuilderCodeRegistryV2`: claims `bytes32` builder codes with optional signed ownership challenge.
- Support identity records for Polymarket builder codes first.
- Add adapters later for Hyperliquid deployer ids, Kalshi/TSP routing ids, and Arc-native agent ids.
- Add metadata URI for verified profile, fee policy, risk policy, and supported venues.

Why it matters:
- Creates the first cross-venue identity graph for revenue-earning trading agents.
- Lets venues, allocators, and users distinguish proven operators from clones.

### 2. Forum Receipts

Purpose: convert "trust me" PnL into recomputable agent receipts.

Build:
- `TrackRecordV2` with:
  - `seq` enforced as `lastSeq + 1`.
  - `periodStart` and `periodEnd`.
  - monotonic timestamp checks.
  - `recordHash` replay protection.
  - `prevRecordHash` for hash-chain continuity.
  - `evidenceUri` and `evidenceHash`.
  - optional `venueFillRoot`.
- Off-chain receipt JSON:
  - bot id, signer, venue, market ids.
  - opening balances and closing balances.
  - observed order book or price snapshots.
  - fills/trades/order ids where available.
  - PnL formula version.
  - config hash.
  - strategy code hash.
  - model decision trace hash.

Near-term storage:
- Pin JSON to IPFS/Irys if available.
- Fallback: publish to the repo or static `/receipts/` path and hash on Arc.

Why it matters:
- This is the product judges and investors can verify without trusting the operator.
- It aligns with Agora's Trading-R1/reasoning-trace research angle.

### 3. Forum Fee Router

Purpose: move real agent revenue into transparent USDC splits.

Build:
- A watcher for Polymarket `getBuilderTrades()` and builder payout transactions.
- A reconciliation ledger: expected builder fee, received payout, bridged amount, distributed amount.
- CCTP/App Kit flow from Polygon/source chain to Arc USDC.
- `FeeDistributorV2` that supports:
  - attribution tables.
  - protocol fee optionality for hosted services.
  - claim receipts.
  - dust handling.
  - zero-recipient rejection.

Why it matters:
- This is how Forum becomes revenue infrastructure rather than a reputation-only toy.
- It cleanly uses Circle tooling: CCTP, Gateway/App Kit, USDC, and Arc contracts.

### 4. Forum Allocator

Purpose: make agency visible.

Build:
- An agent that scores registered bots using:
  - signed receipts.
  - drawdown.
  - hit rate.
  - strategy drift.
  - market regime.
  - source-data integrity.
- Output: "copy", "watch", "pause", or "slash-risk" recommendations.
- For hackathon, keep it non-custodial and paper/recommendation only.
- Post-hackathon, support opt-in copy-trading and capital allocation with clear jurisdictional controls.

Why it matters:
- Agora judges score agentic sophistication. A dashboard that displays records is automation. An allocator that decides which agent deserves capital is agency.

### 5. Forum Indexer and Dashboard

Purpose: stop relying on browser RPC scans.

Build:
- Tiny backend indexer that tails Arc events from deployment block.
- Store bot registry, record counts, latest records, fee events, and receipt URLs.
- Frontend reads `/api/state` and `/api/bots/:id` instead of scanning RPC.
- Keep Arc explorer links for verification.

Why it matters:
- The live link becomes reliable for judges and investors.
- It unlocks charts, leaderboards, and public proof pages.

## Agora-winning plan through May 25

Goal: win by showing real agency, real traction, Circle stack usage, and a live product reviewers can verify asynchronously.

### May 17

- Done: fix live frontend RPC range failure and redeploy to VPS.
- Freeze the honest narrative: "signed attribution today, fully falsifiable receipts next."
- Do not submit yet without explicit approval.

### May 18

- Implement `TrackRecordV2` or a minimal `ReceiptRegistry`.
- Add sequence/replay protection.
- Add receipt JSON generation in the keeper.
- Publish receipts to a public static path and hash them on Arc.
- Update live UI to link each latest record to its receipt artifact.

### May 19

- Add a small indexer API.
- Replace browser event scans with API reads.
- Add one "verify this receipt" page that recomputes the record hash in the browser.

### May 20

- Build one external adapter.
- Recommended first target: a public bot with structured logs, not the biggest brand. The fastest credible win is one adapter that runs and publishes one receipt from a non-Forum codebase.
- Do not claim external traction until the external owner has acknowledged or the integration is objectively public and working.

### May 21

- Build Fee Router demo:
  - Query attributed builder trades.
  - Simulate or use a small real payout if available.
  - Move USDC into Arc via a verified CCTP/App Kit path if supported in the current environment.
  - Split with `FeeDistributor`.

### May 22

- Add the Allocator agent:
  - Reads receipts.
  - Scores bots.
  - Emits a signed allocation/risk recommendation.
  - Publishes the recommendation hash on Arc.

### May 23

- Record the 3-minute demo:
  - 20 sec: Canteen research validates the exact wedge.
  - 40 sec: live product, 5+ bots, continuous records.
  - 50 sec: run keeper, produce receipt, verify hash.
  - 40 sec: show Allocator selecting or rejecting bots.
  - 30 sec: show USDC fee split.
  - 20 sec: close with Arc/Circle alignment and public repo.

### May 24

- Traction sprint:
  - Canteen Discord post.
  - Arc builder Discord post.
  - 10 direct DMs to bot builders.
  - 3 GitHub issues/PRs for adapters.
  - Ask for screenshots or replies from anyone who tests it.

### May 25

- Final submit only after explicit user approval.
- Include public repo, live link, video, traction summary, and exact Circle products used.

## Revenue model

Recommended starting model: monetize off-protocol services, not immutable contract taxes.

1. Hosted Forum Cloud
   - $99 to $499/month per operator for indexed receipts, dashboards, alerting, and public proof pages.

2. Fee Router take rate
   - 5 to 20 bps on builder fees routed through Forum, not on user notional.
   - This avoids looking like an exchange fee.

3. Hosted keeper operations
   - 10% to 20% of builder-fee revenue for operators who want Forum to run their bot infrastructure.

4. Enterprise API
   - $5k to $50k/month for venues, funds, and allocators that need agent reputation, historical receipts, and risk scores.

5. Allocator products
   - Post-hackathon only. Could become a fund, copy-trading product, or marketplace, but this creates regulatory complexity and should not be rushed.

## Regulatory stance

Recommended stance for 2026: non-custodial software and analytics, not broker, exchange, or fund.

Do:
- Provide identity, receipts, fee splitting, analytics, and hosted infrastructure.
- Let users own keys and route their own orders.
- Keep hackathon demo paper mode or tiny test capital.
- Add disclaimers and jurisdiction controls before any public copy-trading feature.

Do not:
- Take custody of user capital.
- Promise returns.
- Autonomously trade for users in the US without legal review.
- Call it a fund, broker, exchange, or investment adviser.
- Submit to the hackathon without explicit approval.

KPMG's entry-path analysis makes the tradeoff clear: full DCM/FCM paths have high capital and long timelines. Forum's fastest defensible path is tooling/TSP-style infrastructure first, regulated partnerships later.

## Investor milestones

### Hackathon proof

- 10+ bots registered.
- 1+ external bot integration.
- 1,000+ Arc records during the event window.
- 20+ receipt artifacts publicly verifiable.
- 1 complete USDC split flow.
- 1 agent allocator recommendation flow.

### 90 days

- 50 registered bots.
- 10 external operators.
- $1M+ attributed market volume tracked.
- $5k MRR from hosted dashboards/keepers.
- SOC-lite operational controls: audit logs, backups, key separation, incident runbook.

### 12 months

- 500 operators.
- $100M+ attributed volume tracked.
- $1M ARR run rate from SaaS, routing, and enterprise API.
- Cross-venue identity beyond Polymarket.
- Signed receipt standard adopted by at least one external protocol or agent framework.

### Multibillion path

Forum becomes venture-scale if it owns the reputation graph for revenue-earning agents before venues build their own closed versions.

The route:
1. Own the public receipt standard.
2. Own the public identity graph.
3. Own fee routing and settlement UX.
4. Become the default API for allocators deciding which agents deserve capital.
5. Expand from prediction markets into perps, FX, treasury, and event-risk hedging.

If prediction markets approach hundreds of billions to trillions in annual volume and autonomous agents become meaningful market participants, a neutral trust and settlement layer can capture a small but valuable slice through SaaS, API, and routing revenue.

## Before investor pitch

Fix or reframe these before sending the deck to serious investors:

1. Replace "cryptographically falsifiable" with "cryptographically attributable" unless receipts are public and recomputable.
2. Add anti-replay and monotonic sequence enforcement.
3. Add receipt artifacts behind every TrackRecord claim.
4. Add an indexer API.
5. Get one external bot or user.
6. Prove Fee Router with actual USDC movement, not only a standalone distributor demo.
7. Remove any unverified claims about external projects' returns, trades, or adoption.
8. Add a regulatory slide: software now, regulated partnerships later.
9. Add a security slide: immutable contracts, no custody, known limitations, next audit scope.
10. Keep the hackathon demo under 3 minutes and lead with live verification, not abstract TAM.

