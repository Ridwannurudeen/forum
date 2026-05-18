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

## SDKs

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

The keepers are paper-mode by default. No real Polymarket order execution is claimed in this repository.

## Why Arc

Forum uses Arc as the USDC-native control plane:

- all mandate state lives on Arc;
- vault deposits, bond balances, slashes, and fee splits are denominated in USDC;
- enforcement is a single low-cost transaction;
- receipt publication is cheap enough to happen continuously.

Circle tools currently used directly: Arc, USDC, and **CCTP V2** via `CovenantInbox` (`0x670f68ff6b90c42f4b7be26a684812e1e5561b12`) — a deployed Arc-side wrapper that receives USDC bridged in via CCTP V2 (Arc = Domain 26) and atomically deposits into a `CovenantVault` for a designated recipient. Source-domain TokenMessenger / MessageTransmitter addresses for Ethereum Sepolia (Domain 0), Avalanche Fuji (1), Base Sepolia (6), and Polygon Amoy (7) are all pinned in `deployments/arc-testnet.json` under `circle.cctp`. Gateway addresses (`GatewayWallet` + `GatewayMinter`) are pinned but not yet wired. USYC token + Teller + Entitlements are pinned (read-only verified, deposit/redeem ABI undocumented). App Kit and Paymaster are not used — Paymaster does not support Arc upstream.

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
- Reference keeper is paper-mode by default.
- External bot adapters are not shipped yet.
- Full receipt verification now recomputes PnL where fills are market-attributed; historical receipts with no fills verify by hash and zero-PnL accounting.
- The current vault transfers pulled credit to the operator wallet. The mandate bounds amount and state, but venue restrictions are not enforced on-chain yet.
- Contracts are immutable and unaudited hackathon code.

## License

MIT
