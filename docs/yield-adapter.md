# Covenant Treasury Agent — venue-agnostic yield adapter

Closes the "the agent drew credit but never used it" gap. A `CovenantVault` gives
the operator a bounded USDC credit line; this adapter routes that drawn credit
through a real on-Arc capital venue and recovers it (± PnL), so the loop is **the
agent put the funds to work, settled on Arc** — with no dependency on an external
mainnet venue (Polymarket) and no cross-chain delay.

## Why this shape

Forum is the credit + risk layer; the *strategy venue* should be swappable. The
agent's job becomes a **treasury-yield agent**: deploy bounded credit into the
best available yield venue under the mandate, governed by the same
`pullCredit` / `RiskKernelV2` (pause + slash) / receipt machinery.

## Architecture

- `keeper/src/yield-venue.ts`
  - `CapitalVenue` — `preflight()` / `deploy()` / `withdraw()`. A venue is any
    place credit can be deployed and recovered.
  - `ChainOps` — the injected chain surface (`erc20Balance` / `simulate` /
    `write`). Venues are pure of viem generics, so they unit-test against a mock
    ledger; the keeper wires `ChainOps` to viem.
  - `UsycVenue` — **real Treasury yield**: USDC → Hashnote Teller `buy` → hold →
    `sell` → recover principal + yield. USYC is Circle's tokenized U.S. Treasury
    fund, native to Arc.
  - `IdleVenue` — operator parks the credit and returns it; zero yield, always
    available. The honest fallback that keeps the loop running on Arc today.
  - Pure helpers: `sizeDraw` (conviction-scaled, capped), `computeRealizedPnl`,
    `selectVenue` (first venue whose preflight passed, in priority order).
- `keeper/scripts/agent-yield-cycle.mjs` — the loop: read mandate → size draw →
  preflight + select venue → `pullCredit` → `venue.deploy` → `venue.withdraw` →
  `returnCapital` + `crystalliseFee` → publish a receipt with realized PnL.

## The USYC allowlist gate (verified)

USYC's Teller is behind Circle's **Entitlements allowlist**: until the operator
wallet is allowlisted, `Teller.buy` reverts. The `UsycVenue.preflight()` detects
this via a read-only `simulate` and the agent **degrades to idle** instead of
failing a draw. Confirmed live on Arc: `Teller.buy` simulated from the deployer
returns `reverted` (operator not yet allowlisted).

**To unblock the hero path:** request allowlisting for the operator wallet via a
Circle Support ticket (Arc testnet wallet address; ~24–48h). Then
`--venue usyc` deploys into real Treasury yield with no code change. Forum then
acts as a **permissionless USYC wrapper**: only the operator wallet needs the
allowlist; depositors/agents using the vault do not.

## Usage

```
# read-only: print preflight + plan, no writes
./keeper/node_modules/.bin/tsx keeper/scripts/agent-yield-cycle.mjs --dry-run

# live loop (auto venue), publish a receipt
./keeper/node_modules/.bin/tsx keeper/scripts/agent-yield-cycle.mjs --venue auto --pull-cap-usdc 1 --publish
```

Flags: `--vault 0x..` (default CovenantVaultV1_2), `--venue usyc|idle|auto`,
`--pull-cap-usdc N`, `--conviction 0..100`, `--dry-run`, `--publish`.

## Verification (this change)

- `tsc --noEmit` clean; keeper `vitest run` **125 passed** (13 new venue tests:
  sizing, PnL, idle round-trip, USYC preflight gate, USYC yield round-trip,
  venue selection/fallback).
- **Live on Arc testnet** (`auto` → USYC preflight detected as gated → idle):
  `pullCredit` `0x575474…481e`, `returnCapital` `0x6fa99a…0a29`,
  `crystalliseFee` `0xce6d30…4867`; receipt published seq 1, publish tx
  `0x3a2576…d53d`.
- Receipt integrity: `verify-receipt.mjs` → `pnl: valid`; on-chain
  `TrackRecordV2` `evidenceHash` **equals** the recomputed receipt hash
  (`0x15c42c…ab4a`). Loop is non-destructive (`operatorOutstanding` 1.0 → 2.0 →
  1.0 USDC).

## Arc + hackathon alignment

Capital, settlement, receipts, and risk enforcement stay on **Arc** (the
"settled on Arc" requirement). USYC is **Circle's own** Arc-native yield product,
so the hero path maximizes the Circle-tooling axis. Idle keeps the loop live on
Arc with zero external dependency.

## Roadmap

- Allowlist the operator → flip the hero venue to **USYC** for real yield.
- Add `AaveVenue` / `MorphoVenue` behind the same `CapitalVenue` interface once
  those protocols deploy on Arc mainnet (Arc's announced DeFi launch partners).
- v2 (trust-hardening): **SHIPPED** — see below.

## v2 (shipped): on-chain vault-custodied strategy

`src/CovenantVaultV2.sol` + `src/IStrategyAdapter.sol` + `src/IdleStrategyAdapter.sol`
+ `src/UsycStrategyAdapter.sol` close the custody gap **on-chain**: idle vault USDC
is deployed into a **governor-approved** `StrategyAdapter` via
`deployToStrategy(adapter, amount)` and recovered via
`recallFromStrategy(adapter, amount)`. Funds move **vault → adapter**; the operator
only triggers and never holds the capital.

- **Role separation:** `governor` curates the adapter allowlist (the trust
  boundary); `operator` deploys credit but only into pre-approved adapters;
  `riskKernel` pauses/slashes. `deployToStrategy` is `onlyActive`;
  `recallFromStrategy` works in any state (funds never stuck).
- **Accounting:** `assets() = idle + operatorOutstanding + strategyDeployed`
  (principal); realized yield lands in idle on recall and raises the per-share
  price; unrealized yield is not marked up (conservative).
- **Security:** CEI on `deployToStrategy`; `recallFromStrategy` is
  `nonReentrant` (its recovered amount is a return value, so it cannot be
  CEI-reordered — Slither flags it structurally, the guard closes it). Slither:
  0 arbitrary-send / reentrancy-no-eth on the adapters; only the guarded recall
  on the vault.

**Live on Arc testnet** (deployed + custody flow proven):
`CovenantVaultV2` `0x9e08cc6e3ba3026a61139fecd7ba98086a94abf5`,
`IdleStrategyAdapter` `0xa47f32dfdfc199a2df34d96029273ca0e2c7d343`.
Proof: `deployToStrategy(idle, 1 USDC)` put the USDC in the **adapter** (not the
operator); `strategyDeployed=1.0`, `assets=2.0` conserved; recall returned all to
idle; depositor withdraw non-destructive. The USYC adapter is the real-yield
variant (same interface) pending the adapter address's Entitlements allowlist.
