# Forum

[![CI](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml/badge.svg)](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Covenant Accounts: programmable USDC credit lines for autonomous market agents, settled on Arc.**

Built for the Agora Agents Hackathon by Canteen x Circle x Arc, May 11-25 2026.

Live demo: https://forum.gudman.xyz/

## What This Is

Forum is not another prediction-market bot. It is the control and settlement layer that lets capital fund market agents without handing the agent an unrestricted wallet.

A Forum Covenant Account has four parts:

- `CovenantVault`: depositors fund a USDC vault; the operator can pull bounded credit only while the mandate is active.
- `TrackRecordV2`: the agent publishes strict-sequence, EIP-712-signed receipts with public evidence URI/hash commitments.
- `RiskKernelV2`: anyone can evaluate and enforce the mandate.
- `SlashBond`: the operator posts USDC collateral; operator-fault violations can slash the bond in the same transaction that pauses the vault.

The product thesis is simple: agents can trade, but capital needs enforceable mandates, receipt-backed performance, and instant USDC settlement before it can trust them.

**Production hardening (v2/v3, live on Arc testnet):** `CovenantVaultV2` adds vault-custodied strategy deployment — the agent puts credit to work through governor-approved `StrategyAdapter`s and **never holds the funds itself** (vault→adapter), with realized yield recomputable on-chain from `RecalledFromStrategy` events (`docs/yield-adapter.md`). `RiskKernelV3` adds a persistent, un-spammable drawdown peak plus a receipt-independent on-chain NAV circuit breaker. Role separation (operator / governor / risk attestor as distinct addresses) is documented in `docs/security-roles.md`.

## Live Arc Testnet Deployment

Chain: Arc testnet `5042002`

| Contract | Address | Role |
|---|---:|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` | `bytes32` builder-code ownership |
| `KeeperConfig` | `0xf37b1eb28d9af1b259cad3d71a14e76ca8ae0d26` | append-only bot config snapshots |
| `TrackRecord` | `0xaace70a50573cb077f65d601cd19103afc4aef9d` | v1 signed PnL ledger |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` | pull-pattern USDC attribution split |
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | sequence, hash-chain, replay rejection, public evidence |
| `AgentPool` | `0x13855be80b6122187c0bcba007946f9fbaae3fae` | simple USDC capital pool |
| `RiskKernelV2` | `0x0af356f280af1d8b7a43f0746c581614feec4055` | permissionless pause plus slash enforcement |
| `SlashBondV1.1` | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | USDC operator bond, attestor is `RiskKernelV2` |
| `CovenantVaultV1.2` | `0x80384963c0c93414ff16e018c6618a64bc94df6d` | live AgoraMind Covenant Account |
| `CovenantInbox` | `0x670f68ff6b90c42f4b7be26a684812e1e5561b12` | CCTP V2 bridge-friendly deposit wrapper |
| `CovenantVaultFactory` | `0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26` | self-serve creation, anyone can call `createVault(mandate)` |
| `CapitalRouter` | `0x13617989cd443147b6f14ff98e492c6175bb0afc` | Phase 5 allocator. Pools USDC, routes across strategist-whitelisted vaults per weight table, permissionless `rebalance()` |
| `SlashMarket` | `0xcc2d9101fc5851b6fab9b739a177f2a642a5ef76` | Phase 9 Risk Markets v0. Binary YES/NO prediction market per `SlashBond` per time window. Oracle-free settle via `SlashBond.totalSlashed` delta. |
| `SlashInsurance` | `0x353e7fdfdae68967dedfd5ff9150e166d29ffd61` | Phase 9 continuous-premium insurance pool for `SlashBondV1.1`. `payPremium` funds the pool; permissionless `notifySlash` reads bond's `totalSlashed` delta and pays the delta out to the bond's `recipient`. |
| `FeeRouterV1` | `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59` | Phase 6 fee router. `createSplit(recipients, bps)` → permissionless `pay(splitId, amount)` allocates per-recipient → `claim()` pulls running total across every split. Closes the operator/researcher/referrer revenue loop. Off-chain reconciliation in `keeper/scripts/fee-reconcile.mjs`. |
| `CovenantVaultV2` | `0x9e08cc6e3ba3026a61139fecd7ba98086a94abf5` | Vault-custodied strategy deployment. `deployToStrategy`/`recallFromStrategy` route idle USDC into a **governor-approved** `StrategyAdapter` — funds move vault→adapter, the operator never holds them. Governor (allowlist) is separate from operator. |
| `IdleStrategyAdapter` | `0xa47f32dfdfc199a2df34d96029273ca0e2c7d343` | Allowlist-free `StrategyAdapter` (zero-yield) that proves the custody deploy/recall path on-chain. `UsycStrategyAdapter` is the real-yield variant on the same interface, pending the adapter address's USYC Entitlements allowlist. |
| `RiskKernelV3` | `0x554cdad3cac1f640b39816193310166afc2bde06` | Hardened risk engine: persistent monotonic drawdown peak (un-spammable, fixes V2's rolling-window reset; O(1)) + on-chain NAV circuit breaker (`PAUSE_NAV`, perSharePrice vs high-water mark — independent of published receipts). |

Deployment metadata is in `deployments/arc-testnet.json`.

## Verifiable Proofs

- First autonomous pause plus slash: tx `0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13`
- Result: `RiskKernelV2.enforce(CovenantVaultV1.2)` flipped the vault from `ACTIVE` to `PAUSED` and slashed `1.25 USDC` from the bond in one transaction.
- Public receipt sample: `https://forum.gudman.xyz/receipts/201c8909dca1/000014.json`
- Verified evidence hash: the canonical JSON hash matches the `TrackRecordV2.recordAt(bot, 13).evidenceHash` value.

Verify a receipt locally:

```bash
cd forum
cd keeper
npx tsx scripts/verify-receipt.mjs https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
```

The receipt schema (`keeper/src/receipt.ts`) is `forum.receipt.v1`: botId, seq, periodStart/End, markets, bookSnapshots, fills, inventory, pnl inputs, strategy/configHash, decisionTrace, and a `sourceData { booksHash, fillsHash }` integrity block. An optional `sourceChain { domain, messageHash, txHash }` field carries CCTP V2 bridging coordinates when this cycle's capital was bridged in from another chain — verifier rejects partial/malformed claims. See `adapters/template/adapter.ts` for the commented usage example.

## SDKs

Not yet published to npm / PyPI — install from source in this repo (`sdk-ts/`, `sdk-py/`). The package names below (`forum-arc-sdk`, `forum_arc`) resolve once you build/link the local packages; see **Develop** below.

TypeScript:

```typescript
import { ForumClient } from "forum-arc-sdk";
import { ARC_TESTNET_DEPLOYMENT } from "forum-arc-sdk/deployments";

const forum = new ForumClient({
  publicClient,
  walletClient,
  addresses: ARC_TESTNET_DEPLOYMENT,
});

const vault = await forum.covenantVault.snapshot();
const verdict = await forum.riskKernel.evaluate();
const bond = await forum.slashBond.bondBalance();
```

Python:

```python
from forum_arc import ForumClient
from forum_arc.deployments import ARC_TESTNET_DEPLOYMENT

forum = ForumClient(w3, ARC_TESTNET_DEPLOYMENT, account)
vault = forum.covenant_vault.snapshot()
verdict = forum.risk_kernel.evaluate(ARC_TESTNET_DEPLOYMENT.covenant_vault)
bond = forum.slash_bond.bond_balance()
```

## Reference Services

- `forum-keeper.service`: v1 paper-mode market-making keeper publishing to `TrackRecord`.
- `forum-agora-mind.service`: AgoraMind keeper publishing `TrackRecordV2` receipts and reasoning traces to the public receipt directory.

The keepers run in paper mode by default (real market data, simulated fills). Separately, **real Polymarket V2 mainnet orders have been executed and anchored on Arc** — see the **Verify** tab on the live site, `GET /api/proof`, and `docs/phase-3-live-fill-proof.md`. The Polygon settlements are on-chain; builder attribution is confirmed through Polymarket's attribution API. The Arc receipt currently verifies fill #1 and recomputes its PnL; fill #2 proves builder attribution through Polymarket's attribution API. Builder fee capture is wired but currently **0 bps** on Forum's flow: a maker rate (0.1%) is configured (effective 2026-05-24), but Forum trades takers, and Polymarket's fee-update cooldown blocks setting a capturing taker rate until 2026-05-27 — so live capture is a post-hackathon step. Continuous, user-facing execution is **operator-gated** — Polymarket geoblocks order submission and it requires the operator's keys — so it is exposed as an operator flow with verifiable proof, not a public trade button.

## Indexer API

Polled Arc-state cache live at `https://forum.gudman.xyz/api/*`:

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, version, lastPollAt, lastBlock, freshnessSec, stale }` |
| `GET /api/state` | Full snapshot — bots + vaults + bonds + recent slash events |
| `GET /api/bots` | Array of indexed bots with kind/signer/recordCount/lastSeq/lastPnlMicros |
| `GET /api/bots/:botId/records?limit=50` | Record history for a bot (live RPC read, not cached) |
| `GET /api/covenant/:address` | Vault snapshot (state, assets, idle, outstanding, mandate) |
| `GET /api/slash-events?limit=20` | `RiskKernelV2.Enforced` event log (autonomous slash + revive history) |

Source: `keeper/scripts/forum-indexer.mjs`. Systemd + nginx templates in `deploy/`.

Also live: `GET /api/factory-vaults`, `GET /api/vaults`, `GET /api/agents` (AgentScore v0+v1 leaderboard, ingests both `TrackRecord` v1 and v2 since indexer v0.6.0), `GET /api/agents/:botId` (single agent with linked vaults, slash history, and `recentPnls` + `recentTs` sparkline series), `GET /api/fees` (FeeRouterV1 splits + per-recipient claimable), `GET /api/fee-statement` (per-vault accruals + router splits — programmatic equivalent of `keeper/scripts/fee-reconcile.mjs`), `GET /api/router/performance` (CapitalRouter TVL + strategy + lifetime event counters), `GET /api/router/activity` (newest-first reallocation receipts feed). Indexer subscribes to `CovenantVaultFactory.VaultCreated` so every new vault auto-indexes.

Operator-side scripts (read-only by default):
- `keeper/scripts/fee-reconcile.mjs` — daily/weekly fee statement JSON writer.
- `keeper/scripts/router-stale-enforcer.mjs` — detects stale CapitalRouter target vaults and (with `--execute`) triggers `RiskKernelV2.enforce` + `CapitalRouter.rebalance`.
- `keeper/scripts/idle-capital-policy.mjs` — measures `depositTotalIdle / assets` against a `--threshold` ceiling and writes a JSON report; `--halt-on-violation` for cron pagers.

The reference agora-mind keeper supports opt-in risk controls: `--max-loss-day-usdc`, `--min-receipt-interval-sec`, `--auto-pause-on-verifier-failure`. All default off — production behavior unchanged until enabled per deployment.

## Self-Serve UI

- <https://forum.gudman.xyz/#/console?t=create>: browser wallet + mandate form → factory.createVault in one tx.
- <https://forum.gudman.xyz/#/console?t=bridge>: Circle CCTP V2 bridge — burn native USDC on a source testnet → Iris attestation → mint on Arc → optional vault deposit, with in-browser chain switching.
- <https://forum.gudman.xyz/#/console?t=manage>: operator bond + depositor withdraw flows.
- <https://forum.gudman.xyz/#/console?t=agents>: AgentScore leaderboard with row-click inspector + one-click `RiskKernelV2.enforce(vault)` per linked vault.
- <https://forum.gudman.xyz/#/console?t=markets>: SlashMarket YES/NO staking UI per market.
- <https://forum.gudman.xyz/#/console?t=router>: CapitalRouter pool — deposit/withdraw + permissionless `rebalance()` against the strategist weight table.
- <https://forum.gudman.xyz/#/console?t=fees>: FeeRouterV1 — list active splits, pay any split, claim per-recipient accruals.

## Adapter Template

`adapters/template/{adapter.ts, adapter.py}` — fork-this scaffolds for wrapping any existing bot to publish Forum receipts in <30 lines of integration code. See `adapters/README.md` for the 5-step pattern. Reference real-world implementation: `keeper/scripts/agora-mind-keeper.mjs`.

## Why Arc

Forum uses Arc as the USDC-native control plane:

- all mandate state lives on Arc;
- vault deposits, bond balances, slashes, and fee splits are denominated in USDC;
- enforcement is a single low-cost transaction;
- receipt publication is cheap enough to happen continuously.

A standalone bridge helper script ships in `keeper/scripts/cctp-bridge-and-deposit.mjs`. Three modes:
- `--simulate` — prints source-chain calldata against pinned CCTP V2 addresses without broadcasting (no source-chain key needed).
- `--build-source` — same calldata plus instructions for a funded source-chain wallet to sign + broadcast, then poll Iris.
- `--redeem --message --attestation` — uses the Arc deployer key to call `MessageTransmitterV2.receiveMessage` on Arc, completing the bridge.

Circle tools used directly: Arc, USDC, and **CCTP V2**. CCTP is integrated two ways:

1. **In-browser bridge** at `/#/console?t=bridge` — runs the real CCTP V2 flow with the connected wallet: `TokenMessengerV2.depositForBurn` on a source testnet → Circle Iris attestation → `MessageTransmitterV2.receiveMessage` on Arc (Domain 26) → optional `CovenantVault.deposit`. Native USDC, burn-and-mint, with chain-switching handled in-page.
2. **CLI helper** `keeper/scripts/cctp-bridge-and-deposit.mjs` with the same calldata (`--simulate` / `--build-source` / `--redeem`).

`CovenantInbox` (`0x670f68ff6b90c42f4b7be26a684812e1e5561b12`) is a deployed deposit wrapper: a caller already holding USDC deposits into a `CovenantVault` for a designated recipient (who later claims). It is a convenience landing spot, **not** an automatic CCTP hook target — bridged USDC mints to the recipient's own wallet, then is deposited. Source-domain addresses for Ethereum Sepolia (Domain 0), Avalanche Fuji (1), Base Sepolia (6), and Polygon Amoy (7) are pinned in `deployments/arc-testnet.json` under `circle.cctp`. Gateway addresses (`GatewayWallet` + `GatewayMinter`) are pinned but not yet wired. USYC token + Teller + Entitlements are pinned. The Teller's `ITeller` ABI is documented (`buy(uint256)` / `sell(uint256)`); `UsycStrategyAdapter` integrates it, gated by the adapter address's USYC Entitlements allowlist (a Circle Support request) — verified on-chain that `buy` reverts until allowlisted. App Kit and Paymaster are not used — Paymaster does not support Arc upstream.

## Develop

Prerequisites: Node 22+, Python 3.10+. Foundry is required for local Solidity tests.

```bash
cd keeper && npm install && cd ..
cd sdk-ts && npm install && cd ..
```

Run checks:

```bash
cd keeper && npx tsc --noEmit && npx vitest run --reporter=default
cd ../sdk-ts && npx tsc --noEmit
cd ../sdk-py && python -c "from src.forum_arc import ForumClient, ForumAddresses, ARC_TESTNET; print('ok')"
```

Run Foundry tests if `forge` is installed:

```bash
forge install foundry-rs/forge-std --no-git
forge build && forge test -vv
```

## Honest Scope

- Arc testnet only.
- Reference keeper is paper-mode by default. Real Polymarket V2 fills are proven separately (`/api/proof`, `docs/phase-3-live-fill-proof.md`) with on-chain Polygon settlements and builder attribution confirmed by Polymarket's attribution API; live execution is operator-gated, not continuous or self-serve, and builder fee capture is 0 bps on Forum's taker flow (a maker rate of 0.1% is configured, effective 2026-05-24; a capturing taker rate is blocked by Polymarket's fee-update cooldown until 2026-05-27, post-deadline).
- External bot adapters are not shipped yet.
- Full receipt verification now recomputes PnL where fills are market-attributed; historical receipts with no fills verify by hash and zero-PnL accounting.
- The current vault transfers pulled credit to the operator wallet. The mandate bounds amount and state, but venue restrictions are not enforced on-chain yet.
- The in-browser CCTP V2 bridge builds correct, address-verified transactions (Base Sepolia + Arc contracts confirmed live), but a full end-to-end transfer has not been run on camera — it needs source-chain testnet gas + USDC.
- Contracts are immutable and unaudited hackathon code.

## License

MIT
