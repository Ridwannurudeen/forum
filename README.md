# Forum

> Arc-native operator and settlement plane for prediction-market bots.
> Built for the [Agora Agents Hackathon](https://agora.thecanteenapp.com/) (Canteen × Circle × Arc, May 11–25 2026).

## What this is

Polymarket V2 launched April 28 2026 with new contracts, new pUSD collateral, and a `bytes32` builder-attribution field on every signed order. A wave of new bots followed — directional pickers, market-makers, arbitrage agents. Every one of them needs the same operator infrastructure: a way to claim and prove ownership of a builder code, a way to tune the bot's live parameters, a way to publish a verifiable performance track record, and a way to receive and split USDC fees.

Nobody has built that layer. Forum does, on Arc.

## Components

- **`BuilderCodeRegistry`** — first-claim-wins binding from a `bytes32` code to an owner address
- **`KeeperConfig`** — per-bot, append-only config history operators write and bots read
- **`TrackRecord`** — append-only EIP-712-signed PnL records with bot-kind taxonomy (MAKER / TAKER / ARB / OTHER)
- **`FeeDistributor`** — pull-pattern USDC distribution per code's attribution table
- **`forum-arc-sdk`** (TypeScript, npm) and **`forum-arc`** (Python, PyPI) — one-line integrations
- **Reference keeper** — V2-SDK-native, paper-mode, two-sided quoter (canonical demo, lands D2–D4)
- **Adapters** — `adapter-poly-lp-bot` (Python) and `adapter-polyforge` (TypeScript), showing the operator plane integrates with any architecture

## Live deployment (Arc testnet, chain 5042002)

| Contract | Address |
|---|---|
| `BuilderCodeRegistry` | _filled after D1/D5 deploy_ |
| `KeeperConfig` | _filled after D5 deploy_ |
| `TrackRecord` | _filled after D5 deploy_ |
| `FeeDistributor` | _filled after D5 deploy_ |

## Develop

Prerequisites:
- [Foundry](https://book.getfoundry.sh/) (`foundryup`)
- Node 22+
- Python 3.10+

```bash
git clone https://github.com/Ridwannurudeen/forum.git
cd forum
forge install foundry-rs/forge-std --no-git
forge build
forge test -vv
```

To deploy to Arc testnet (after setting `.env`):

```bash
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --legacy
```

## SDK quickstart

```typescript
// TypeScript
import { ARC_TESTNET, BOT_KIND_ENUM } from 'forum-arc-sdk';
// Full ForumClient lands D2.
```

```python
# Python
from forum_arc import ARC_TESTNET, BOT_KIND_ENUM
# Full client lands D3.
```

## Honest scope

- v1 ships in 9 days for the Agora Agents Hackathon
- All contracts are immutable. No admin keys. No upgradability.
- Paper-mode default for the reference keeper — no money at risk
- Polymarket V2 only (no HIP-3, no Pump.fun, no Kalshi in v1)
- Arc testnet only until mainnet beta (Summer 2026)

## License

MIT
