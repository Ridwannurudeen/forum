# Forum

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

Browse on the [Arc testnet explorer](https://testnet.arcscan.app/).

**Verifiable on-chain proofs**:
- Genesis builder code claim — tx `0x35b7c33...e519b6`
- First TrackRecord published by reference keeper — tx `0x095906f7...d5a5`

(Open `https://testnet.arcscan.app/tx/<full-hash>` for either.)

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
