# Forum Architecture

Forum is a Covenant Account system for autonomous market agents on Arc.

The core idea: depositors fund a USDC vault, the agent gets bounded execution credit, and a permissionless risk kernel can pause the vault and slash the operator bond when the mandate is breached.

## On-Chain Surface

| Contract | Purpose |
|---|---|
| `BuilderCodeRegistry` | First-claim-wins binding from a `bytes32` builder code to an owner address. |
| `KeeperConfig` | Per-bot append-only config snapshots. |
| `TrackRecord` | v1 signer-attributable PnL records. |
| `FeeDistributor` | Pull-pattern USDC attribution split. |
| `TrackRecordV2` | Strict sequence, monotonic time, hash-chain, replay protection, EIP-712 signer attribution, public evidence hash. |
| `AgentPool` | Simple USDC pool with operator pull/return and high-water-mark performance fee. |
| `CovenantVaultV1.2` | Live mandate-bounded USDC credit line for AgoraMind. |
| `RiskKernelV2` | Permissionless evaluator/enforcer for drawdown, budget, staleness, and expiry rules. |
| `SlashBondV1.1` | Operator USDC bond with `RiskKernelV2` as attestor. |

## Off-Chain Surface

- `forum-arc-sdk`: TypeScript SDK for identity, receipts, vault, risk, bond, pool, and fee-distribution calls.
- `forum-arc`: Python SDK with the same core surfaces.
- `keeper`: reference keeper and AgoraMind service.
- `frontend/index.html`: live static dashboard that reads Arc state and verifies the latest AgoraMind receipt hash in-browser.

## Receipt Flow

1. Keeper builds canonical receipt JSON.
2. Receipt JSON is written under `/receipts/<bot>/<seq>.json`.
3. Keeper computes `keccak256(canonical_json)`.
4. `TrackRecordV2.publish()` stores the receipt evidence hash and the signed record hash.
5. Anyone can fetch the JSON, recompute the hash, and compare it to `recordAt(bot, idx).evidenceHash`.

`keeper/scripts/verify-receipt.mjs` is the CLI verifier.

## Current Scope

- Arc testnet only.
- Reference trading is paper-mode by default.
- External adapters are planned but not shipped.
- CCTP, Gateway, USYC, and App Kit are roadmap integrations, not live dependencies.
- Venue restrictions are not enforced on-chain yet; the current vault bounds amount and state.
