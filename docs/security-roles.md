# Forum role separation

Forum's contracts already model distinct roles as separate addresses — no single
key is privileged across the whole system. For production, deploy each role to a
**distinct wallet** (the demo uses one deployer wallet for convenience; the code
does not require that).

| Role | Where | Power | Must NOT also be |
|---|---|---|---|
| **operator** | `mandate.operator` | draws credit, triggers strategy deploy/recall, claims perf fee | the risk attestor |
| **governor** | `CovenantVaultV2.governor` | curates the strategy adapter allowlist (the trust boundary for where credit can go) | the operator |
| **riskKernel** | `mandate.riskKernel` | pauses/slashes per the mandate (permissionless `enforce`) | the operator |
| **attestor** | `SlashBond.attestor` | authorizes slashes | the operator |
| **recipient** | `SlashBond.recipient` | receives slashed collateral | the operator |

## Why this matters

The keystone (CovenantVaultV2) deliberately split **governor** from **operator**:
the operator can deploy drawn credit only into adapters the governor pre-approved,
so a compromised or greedy operator cannot route capital into a malicious adapter.
Combined with the risk kernel (separate pause/slash authority) and a separate
attestor/recipient on the bond, each privileged action is checked by a different
party.

## Operational guidance (production)

- Generate distinct wallets for operator, governor, riskKernel attestor, and the
  slash recipient. Never reuse one key across two of these roles.
- The governor should be a multisig / DAO once external depositors are involved —
  it is the gate that decides where pooled capital may be deployed.
- The risk attestor should migrate from a trusted key to the permissionless
  on-chain rule (TrackRecordV2 + price/benchmark oracle) — see the roadmap.

The current testnet demo runs all roles from the deployer wallet
(`0x13585c…0770`); that is a deployment choice, not a code limitation.
