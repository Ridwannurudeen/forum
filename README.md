# Forum

[![CI](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml/badge.svg)](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Arc-native operator and settlement plane for prediction-market bots.
> Built for the [Agora Agents Hackathon](https://agora.thecanteenapp.com/) (Canteen × Circle × Arc, May 11–25 2026).

## What this is

Polymarket V2 launched April 28 2026 with new contracts, new pUSD collateral, and a `bytes32` builder-attribution field on every signed order. A wave of new bots followed — directional pickers, market-makers, arbitrage agents. Every one of them needs the same operator infrastructure: a way to claim and prove ownership of a builder code, a way to tune the bot's live parameters, a way to publish a verifiable performance track record, and a way to receive and split USDC fees.

Nobody has built that layer. Forum does, on Arc.

## Validation — Canteen asked for this in writing

From the hackathon's own [Research section, Hack #02](https://agora.thecanteenapp.com/):

> *"a thin 'agent-as-builder' wrapper that registers any agent framework as a Polymarket V2 builder, exposes its structured outputs as a signed feed, and earns USDC builder fees per fill — Arc's ~$0.01 fees make per-pick economics work at retail size."*

Forum is the operator-plane primitive that wrapper sits on top of.

## Architecture

```
┌───────────────────────────── Arc Testnet (5042002) ─────────────────────────────┐
│                                                                                 │
│   BuilderCodeRegistry      KeeperConfig       TrackRecord       FeeDistributor  │
│   bytes32 → owner          (op, bot) → cfg    bot → signed PnL  code → splits   │
│         │                       │                   ▲                   ▲       │
│         └───────────────────────┼───────────────────┘                   │       │
│                                 │                                       │       │
└─────────────────────────────────┼───────────────────────────────────────┼───────┘
                                  │  forum-arc-sdk (TS) / forum-arc (Py)  │
                                  ▼                                       │
                ┌──────────────────────────────────┐         ┌────────────┴────────────┐
                │  reference keeper (paper mode)   │         │   Polygon mainnet       │
                │  poly-lp-bot adapter (Python)    │ ──────► │   Polymarket V2 (pUSD)  │
                │  polyforge adapter (TypeScript)  │  trade  │                         │
                │  ... any third-party bot         │ ◄────── │   fees (via CCTP V2)    │
                └──────────────────────────────────┘  fees   └─────────────────────────┘
```

## Live deployment (Arc testnet, chain 5042002)

| Contract | Address | Bytecode |
|---|---|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` | 3,436 bytes |
| `KeeperConfig` | `0xf37b1eb28d9af1b259cad3d71a14e76ca8ae0d26` | 4,020 bytes |
| `TrackRecord` | `0xaace70a50573cb077f65d601cd19103afc4aef9d` | 4,718 bytes |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` | 6,694 bytes |
| **`TrackRecordV2`** | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | strict seq + monotonic ts + prev-hash chain + replay rejection + evidence URI |
| **`AgentPool`** | `0x13855be80b6122187c0bcba007946f9fbaae3fae` | permissionless deposit + operator pull + 20%-above-HWM perf fee |
| **`SlashBond`** | `0x66040fd1aea2c09dde83252114532b6cb9941482` | operator collateral, attestor-slashable → AgentPool depositors |
| **`RiskKernel`** | `0x041a79c214e9daf876b5f2e76d7870ef4359630a` | permissionless mandate enforcer — `enforce(vault)` callable by anyone |
| **`CovenantVault`** | `0xd126e11b3e79e9af23b021d793097a5902aae3ef` | mandate-bounded USDC credit line — operator never owns funds, only execution rights |
| **`RiskKernelV2`** | `0x0af356f280af1d8b7a43f0746c581614feec4055` | v1.1 — same `enforce(vault)` interface, but ALSO calls `SlashBond.slash()` in the same tx on operator-fault violations |
| **`SlashBondV1.1`** | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | `attestor = RiskKernelV2`, so pause→slash is fully autonomous — no manual operator call |
| **`CovenantVaultV1.2`** | `0x80384963c0c93414ff16e018c6618a64bc94df6d` | v1.1 demo vault bound to live AgoraMind botId, new kernel + bond — proves the autonomous flow end-to-end |

Browse on the [Arc testnet explorer](https://testnet.arcscan.app/). Live frontend: **https://forum.gudman.xyz/**

**Verifiable on-chain proofs**:
- Genesis builder code claim — tx `0x35b7c33...e519b6`
- First TrackRecord published by reference keeper — tx `0x095906f7...d5a5`
- **First autonomous pause+slash (v1.1)** — tx `0x2c8e79a5...05d13` — `RiskKernelV2.enforce(CovenantVaultV1.2)` flipped state ACTIVE→PAUSED **and** transferred 1.25 USDC out of the bond to the recipient, both in a single 162,960-gas tx, triggered by a real stale-receipt violation (no choreography)

(Open `https://testnet.arcscan.app/tx/<full-hash>` for any of them.)

### Try the autonomous-slash demo yourself

```bash
node keeper/scripts/demo-violation.mjs
```

Reads the v1.2 vault, the bound AgoraMind bot's last receipt, and the current freshness window. If the vault is currently in violation, calls `RiskKernelV2.enforce(vault)` and prints the before/after state + slashed amount. If not, prints what would happen and how to wait it out.

## Components

- **`BuilderCodeRegistry`** — first-claim-wins binding from a `bytes32` code to an owner address
- **`KeeperConfig`** — per-bot, append-only config history operators write and bots read
- **`TrackRecord`** — append-only EIP-712-signed PnL records with bot-kind taxonomy (`MAKER` / `TAKER` / `ARB` / `OTHER`)
- **`FeeDistributor`** — pull-pattern USDC distribution per code's attribution table
- **`forum-arc-sdk`** (TypeScript, npm) and **`forum-arc`** (Python, PyPI) — symmetric one-line integrations
- **Reference keeper** at `keeper/` — V2-SDK-native, paper-mode, two-sided quoter consuming `@polymarket/clob-client-v2`
- **Frontend dashboard** at `frontend/index.html` — single-file viem+CDN, reads bots/records live from Arc
- **Adapters** — `adapter-poly-lp-bot` (Python) and `adapter-polyforge` (TypeScript) — third-party bot integrations

## 5-minute integration

```typescript
// TypeScript
import { ForumClient } from 'forum-arc-sdk';
import { ARC_TESTNET_DEPLOYMENT } from 'forum-arc-sdk/deployments';

const forum = new ForumClient({ publicClient, walletClient, addresses: ARC_TESTNET_DEPLOYMENT });
await forum.registry.claim(code);
await forum.trackRecord.registerBot(botId, 'MAKER', signerAddress);
await forum.trackRecord.publish(botId, record, signature);
```

```python
# Python
from forum_arc import ForumClient
from forum_arc.deployments import ARC_TESTNET_DEPLOYMENT

forum = ForumClient(w3, ARC_TESTNET_DEPLOYMENT, account)
forum.registry.claim(code)
forum.track_record.register_bot(bot_id, 'MAKER', signer_address)
forum.track_record.publish(bot_id, record, signature)
```

## Develop

Prerequisites: Node 22+, Python 3.10+. Optional: [Foundry](https://book.getfoundry.sh/) for contract tests.

```bash
git clone https://github.com/Ridwannurudeen/forum.git
cd forum
cd keeper && npm install && cd ..       # installs solc, viem, clob-client-v2, dotenv
```

Run the reference keeper (paper mode, no money at risk):
```bash
cd keeper
./node_modules/.bin/tsx src/index.ts --markets 1 --interval 30 --publish-every 10
```

Deploy your own copy of the contracts:
```bash
# 1. Put your testnet key at ~/.forum-keys/deployer.key (raw 0x-hex)
# 2. Fund via faucet.circle.com
# 3. Compile + deploy + propagate addresses:
node keeper/scripts/deploy.mjs && node keeper/scripts/update-after-deploy.mjs
```

Run contract tests (requires Foundry):
```bash
forge install foundry-rs/forge-std --no-git
forge build && forge test -vv
```
(Or just push to GitHub — CI runs `forge build + test` automatically.)

## Honest scope

- All contracts are **immutable** — no admin keys, no upgradability, no pauser
- **Paper-mode default** for the reference keeper — no real Polymarket orders submitted
- **Polymarket V2 only** (no HIP-3, no Pump.fun, no Kalshi in v1)
- **Arc testnet only** until mainnet beta (Summer 2026)
- Not financial advice. Use at your own risk.

## License

MIT
