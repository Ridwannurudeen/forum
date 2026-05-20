# Forum - Agora Agents Hackathon Submission Draft

> Do not submit this form without explicit approval.

## Project Name

Forum

## One-Line Description

Covenant Accounts for autonomous market agents: mandate-bounded USDC credit lines, receipt-backed performance, and permissionless pause plus slash enforcement on Arc.

## Live Demo

- Frontend: https://forum.gudman.xyz/
- Repository: https://github.com/Ridwannurudeen/forum
- Arc explorer example: https://testnet.arcscan.app/address/0x80384963c0c93414ff16e018c6618a64bc94df6d

## What Problem Are You Solving?

Capital wants exposure to autonomous trading agents, but today the choices are bad:

- give the agent or operator a wallet and hope they behave;
- use a slow managed-account structure that does not fit agentic markets;
- trust screenshots of PnL, Sharpe, or win rate.

Forum makes an agent fundable without requiring blind trust. A depositor funds a USDC vault. The agent gets bounded execution rights. A public risk kernel can pause the vault and slash the operator bond if the mandate is breached.

## Why This Fits Agora / Arc

Agora is about agents that trade, invest, create, and interface with markets, settled instantly on Arc with USDC. Forum is the capital-control layer underneath those agents.

RFB fit:

- RFB 02, Prediction Market Trader Intelligence: agents can publish signed, receipt-backed recommendations and performance.
- RFB 06, Social Trading Intelligence: allocators can copy or fund agents based on verifiable receipts instead of social claims.
- Adjacent to RFB 04, Adaptive Portfolio Manager: the Covenant Account is a mandate-controlled allocation vehicle.

Arc/Circle usage:

- Arc testnet stores the live mandate, vault, bond, risk, identity, and receipt commitments.
- USDC is used for vault capital, operator bond, slashing, and fee split demos.
- **Circle CCTP V2 is integrated two ways.** (1) An in-browser bridge in the console (`/#/console?t=bridge`) that builds and submits the real CCTP V2 flow with the user's wallet: `TokenMessengerV2.depositForBurn` on a source testnet (Ethereum Sepolia / Base Sepolia / Polygon Amoy / Avalanche Fuji) → Circle Iris attestation → `MessageTransmitterV2.receiveMessage` on Arc (Domain 26) → optional `CovenantVault.deposit`. Native USDC, burn-and-mint — not a wrapped-asset bridge. (2) A CLI helper, `keeper/scripts/cctp-bridge-and-deposit.mjs` (`--simulate` / `--build-source` / `--redeem`), with the same calldata. `CovenantInbox` (`0x670f68ff6b90c42f4b7be26a684812e1e5561b12`) is a deployed deposit wrapper: a caller already holding USDC can deposit into any `CovenantVault` on behalf of a designated recipient (who later claims) — it is a convenience landing spot, not an automatic CCTP hook target. Canonical Circle/Arc addresses pinned in `deployments/arc-testnet.json` under `circle.*` (CCTP V2 TokenMessenger / MessageTransmitter / TokenMinter / MessageV2, Gateway Wallet + Minter, USYC + Teller + Entitlements, EURC, FxEscrow — all verified against `docs.arc.io/arc/references/contract-addresses`).
- Circle Paymaster is **upstream-blocked on Arc**: the supported-chains list at `developers.circle.com/paymaster` covers Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain — Arc is not listed for either ERC-4337 v0.7 or v0.8.
- USYC: token + Teller + Entitlements all live on Arc testnet (addresses pinned), but the Teller's buy/sell ABI is undocumented and the Entitlements gate appears to be permissioned. Read-only `totalSupply` verified; deposit/redeem integration deferred.
- Circle Gateway (`GatewayWallet` + `GatewayMinter`) and App Kit are addressed but not wired in v1.

## What Is Live

Live contracts on Arc testnet:

| Contract | Address | Role |
|---|---:|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` | builder-code identity |
| `KeeperConfig` | `0xf37b1eb28d9af1b259cad3d71a14e76ca8ae0d26` | bot config history |
| `TrackRecord` | `0xaace70a50573cb077f65d601cd19103afc4aef9d` | v1 signed PnL ledger |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` | USDC attribution split |
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | strict receipt ledger |
| `AgentPool` | `0x13855be80b6122187c0bcba007946f9fbaae3fae` | simple USDC pool |
| `RiskKernelV2` | `0x0af356f280af1d8b7a43f0746c581614feec4055` | permissionless enforcement |
| `SlashBondV1.1` | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | slashable USDC bond |
| `CovenantVaultV1.2` | `0x80384963c0c93414ff16e018c6618a64bc94df6d` | live AgoraMind credit line |
| `CovenantInbox` | `0x670f68ff6b90c42f4b7be26a684812e1e5561b12` | CCTP-adjacent deposit wrapper: a caller holding USDC deposits into a vault for a designated recipient, who later claims (post-bridge landing spot, not an automatic CCTP hook) |
| `CovenantVaultFactory` | `0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26` | self-serve vault creation — anyone calls `createVault(mandate)` to launch a fresh Covenant Account; emits `VaultCreated` for indexer auto-discovery |
| `CapitalRouter` | `0x13617989cd443147b6f14ff98e492c6175bb0afc` | Phase 5 allocator product. Pools depositor USDC and routes across strategist-whitelisted `CovenantVault` instances per weight table. Permissionless `rebalance()` enforces targets. Initial strategy: 100% → CovenantVaultV1.2. |
| `SlashMarket` | `0xcc2d9101fc5851b6fab9b739a177f2a642a5ef76` | Phase 9 Risk Markets v0. Per-bond binary prediction market: "will this `SlashBond` have a slash event before expiry?" Oracle-free settlement: reads `SlashBond.totalSlashed` delta at expiry; winners get stake + pro-rata share of losers' pool. Initial 24h market live vs SlashBondV1.1. |
| `SlashInsurance` | `0x353e7fdfdae68967dedfd5ff9150e166d29ffd61` | Phase 9 continuous-premium insurance pool, complementary to the binary prediction market. Funders call `payPremium`; permissionless `notifySlash` reads bond's `totalSlashed` delta and transfers the delta out to the bond's `topUpRecipient`. Pro-rata burn-down on withdraw after partial payouts. |
| `FeeRouterV1` | `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59` | Phase 6 fee router. `createSplit(recipients, bps)` (immutable per split) → permissionless `pay(splitId, amount)` allocates per `bps` with rounding dust folded into the first recipient → recipient `claim()` aggregates across every split. Closes the operator/researcher/referrer revenue loop. Reconciler emits a JSON statement at `reports/fee-statement-<unix>.json`. |

Live services:

- `forum-keeper`: reference paper-mode keeper publishing v1 records.
- `forum-agora-mind`: AI-driven keeper publishing `TrackRecordV2` receipts and reasoning trace hashes.
- `forum-indexer`: polled Arc-state cache exposed at `https://forum.gudman.xyz/api/{health,bots,bots/:id/records,covenant/:address,slash-events,factory-vaults,vaults,agents,agents/:botId,fees,fee-statement,router/performance,router/activity,state}`. 30s poll interval, persists snapshot to disk, subscribes to `CovenantVaultFactory.VaultCreated` so every new vault auto-indexes. **AgentScore v0+v1** at `/api/agents` ranks bots by drawdown / slash history / freshness with a transparent in-source formula and ingests both `TrackRecord` v1 and v2 since indexer v0.6.0. Live: `curl https://forum.gudman.xyz/api/health`. Systemd unit + nginx config templates in `deploy/`.

Self-serve UI:

- <https://forum.gudman.xyz/#/console?t=create>: any visitor with a browser wallet (MetaMask / Backpack / Rabby) creates a Covenant Account in one tx via `CovenantVaultFactory.createVault(mandate)`. Auto-switches to Arc testnet. New vaults auto-appear in `/api/factory-vaults` within ~30s.
- <https://forum.gudman.xyz/#/console?t=bridge>: Circle CCTP V2 bridge — burn native USDC on a source testnet, wait for the Iris attestation, mint on Arc, optionally deposit into a vault. Handles chain-switching in-browser.
- <https://forum.gudman.xyz/#/console?t=manage>: operator bond (USDC approve → `SlashBond.bond`) + depositor withdraw (`CovenantVault.withdraw(shares)`) flows.
- <https://forum.gudman.xyz/#/console?t=agents>: live AgentScore leaderboard. Click any row → agent inspector with score tiles, linked vaults, and one-click `RiskKernelV2.enforce(vault)` button.

Adapter template:

- `adapters/template/{adapter.ts, adapter.py}`: fork-this scaffolds for wrapping any existing bot — minimal `runBot()` placeholder + the publish-loop boilerplate (registration, EIP-712 signing, hash chaining, on-chain publish).
- `adapters/poly-v2-reference/bot.ts`: **complete runnable reference Polymarket V2 bot**. Verified 2026-05-18 that no public V2 trading-bot repo exists to wrap (py-clob-client archived, no example bots in Polymarket org), so this is the canonical Phase 2 starter — discovers 3 markets, paper-trades a simple picker, publishes receipts via `ForumV2Bridge`. Third-party operators clone the repo and only customise `pickDirection()`.
- Reference real-world implementation: `keeper/scripts/agora-mind-keeper.mjs` (live on VPS, publishing every ~10 min since 2026-05-17).

## Verifiable Demo Proofs

Autonomous pause plus slash:

- Tx: `0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13`
- What happened: `RiskKernelV2.enforce(vault)` paused `CovenantVaultV1.2` and slashed `1.25 USDC` from `SlashBondV1.1` in the same transaction.
- Trigger: stale receipt window, not a manually edited UI state.

Receipt proof:

- Example receipt: https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
- Local verifier: `npx tsx keeper/scripts/verify-receipt.mjs <receipt-url>`
- The frontend now performs the same browser-side hash check against `TrackRecordV2`.

Real Polymarket V2 fill (anchored on Arc):

- Live proof API (full hashes + clickable links): https://forum.gudman.xyz/api/proof — also surfaced in the **Polymarket** console tab.
- Real-fill botId: `0x75d6577d…0ef0`
- Receipt: https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json — `verifiedPnl: recomputed-from-fills`, `verifiedFillCount: 1`.
- Polygon settlement tx `0x5207a52…b80c0`; Arc publish tx `0x8fbbdb97…d931`.
- Polygon settlement is on-chain; builder attribution is confirmed by Polymarket's attribution API. Builder fee rate is currently 0 bps on Forum's taker flow (a maker rate of 0.1% is configured, effective 2026-05-24; a capturing taker rate is gated by Polymarket's fee-update cooldown until 2026-05-27 — post-deadline). Write-up: `docs/phase-3-live-fill-proof.md`.

## Traction During The Event

- 8 indexed bot identities on Arc across `TrackRecord` v1 + v2 (live count at `/api/agents`).
- Continuous keeper activity during the event window.
- 1 live AgoraMind bot publishing public `TrackRecordV2` receipts.
- 1 live Covenant Account funded and bonded with USDC on Arc testnet.
- 1 autonomous pause plus slash transaction completed on-chain.

Honest note: these are self-operated demo users. External bot adapters and third-party user onboarding are not complete yet.

## What Is Novel?

Most hackathon entries will build an agent. Forum builds the account primitive that lets someone else safely fund an agent.

The new primitive is the Covenant Account:

- bounded USDC credit;
- signed public receipts;
- on-chain drawdown, staleness, budget, and expiry checks;
- operator bond;
- pause plus slash in one transaction.

That combination is the difference between "I built a bot" and "a third party can allocate capital to this bot under enforceable rules."

## Tests

Current CI covers:

- Foundry build and contract tests;
- keeper TypeScript typecheck;
- keeper Vitest suite;
- TypeScript SDK typecheck;
- Python SDK import smoke.

Local Windows does not currently have `forge`; Foundry verification is via GitHub Actions.

## Risks And Scope

- Arc testnet only (Forum's own contracts). The Polymarket fills are real Polygon mainnet trades.
- The reference keeper trades in paper mode (real market data, simulated fills).
- Real Polymarket V2 mainnet execution **is** proven: two live fills, on-chain Polygon settlements, builder attribution confirmed by Polymarket's attribution API, and receipts anchored on Arc with PnL recomputed by the verifier (see `/api/proof` and the **Polymarket** console tab). Builder fee capture is wired but currently **0 bps** on Forum's taker flow (maker rate 0.1% configured, effective 2026-05-24; a capturing taker rate is blocked by Polymarket's fee-update cooldown until 2026-05-27), and continuous user-facing execution is **operator-gated** (Polymarket geoblocking + operator keys), not self-serve.
- External adapters are not shipped yet.
- Contracts are immutable and unaudited.
- The current vault bounds operator credit by amount and state, but does not enforce allowed venues on-chain.
- The in-browser CCTP V2 bridge builds the correct, address-verified transactions, but a full end-to-end transfer has not been run on camera (needs source-chain testnet gas + USDC). Contract addresses are verified live on Base Sepolia and Arc; the calldata matches the CLI helper.

## Demo Video

To be recorded.

Recommended flow:

1. Show the live console evidence strip: Claude Sonnet 4.6 trace, real-fill vault, router targets, and the operator-gated caveat.
2. Open the Polymarket tab: show the two real Polygon fills, the verified Arc receipt, and the 0 bps builder-fee caveat.
3. Show the autonomous pause plus slash tx on Arc explorer.
4. Open Agents: click the real-fill bot and show its linked funded Covenant Account.
5. Open Router and Fees: show allocator routing and fee-split primitives.
6. Run `npx tsx keeper/scripts/verify-receipt.mjs <receipt-url>` on the real-fill receipt.

## Team

Ridwan Nurudeen

## Contact

nraheemst@gmail.com
