# Forum

[![CI](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml/badge.svg)](https://github.com/Ridwannurudeen/forum/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Covenant Accounts — programmable USDC credit lines for AI trading agents.**
> Stripe Connect plus Numerai for autonomous market agents, settled on Arc.
> Built for the [Agora Agents Hackathon](https://agora.thecanteenapp.com/) (Canteen × Circle × Arc, May 11–25 2026).

## What this is

Today, capital can't trust an AI trading agent. Three options exist and none compose:

1. Hand over a private key — operator can run with the money.
2. Use a regulated managed account — KYC, multi-day onboarding, custody, monthly NAV statements. Incompatible with bots that act in milliseconds.
3. Build your own audit pipeline — every quant team rebuilds the same mandate enforcement, drawdown gates, perf-fee crystallisation, slashing-on-breach logic.

So capital sits out, and every "12% APY MM bot" pitch is unverifiable marketing.

A **Covenant Account** is one immutable contract on Arc that holds depositors' USDC. The operator gets *execution rights*, bounded by an on-chain mandate: max budget, max drawdown, receipt freshness, expiry, perf-fee cut, slash bond. They never custody the funds. Any third party can call `RiskKernelV2.enforce(vault)` — one tx flips the vault to PAUSED **and** moves slash funds out of the bond. Permissionless. No operator click required.

**Live proof on Arc testnet** (tx `0x2c8e79a5...05d13`): the first autonomous on-chain slash settled 1.25 USDC in 162,960 gas, triggered organically by a stale receipt.

## Validation — Canteen named the lane in writing

From the hackathon page's [Research section](https://agora.thecanteenapp.com/):

> **Hack #02** — *"a thin 'agent-as-builder' wrapper that registers any agent framework as a Polymarket V2 builder, exposes its structured outputs as a signed feed, and earns USDC builder fees per fill — Arc's ~$0.01 fees make per-pick economics work at retail size."*

Forum's `BuilderCodeRegistry` + `TrackRecord` + `FeeDistributor` + `KeeperConfig` are that infrastructure layer.

> **Hack #06** — *"a USDC performance bond on Arc for a given whale that users can stake alongside. A smart contract reads… via oracle; if the leader falls below a defined threshold, the bond slashes proportionally and the slash settles in under a second."*

Forum's `SlashBond` + `RiskKernelV2` + `CovenantVault` are that primitive — same shape (USDC bond on Arc, automatic proportional slash, sub-second settle), but the signal source is the agent's own published receipts (`TrackRecordV2`), not an external leaderboard oracle.

## Architecture

```
┌─────────────── Arc Testnet (5042002) — 13 immutable contracts ────────────────┐
│                                                                               │
│  Identity & attribution            Reputation & receipts                      │
│  ─────────────────────             ─────────────────────                      │
│  BuilderCodeRegistry               TrackRecord                                │
│  KeeperConfig                      TrackRecordV2                              │
│                                       │                                       │
│                                       ▼ (read by)                             │
│  Mandate & autonomous risk         Capital & distribution                     │
│  ─────────────────────────         ──────────────────────                     │
│  CovenantVault   ◄── enforce()     AgentPool                                  │
│  CovenantVaultV1.1                 FeeDistributor                             │
│  CovenantVaultV1.2 (live demo)                                                │
│                                                                               │
│  RiskKernel ──┐                                                               │
│  RiskKernelV2 ┤── attestor of ──► SlashBond                                   │
│  (one tx: pause AND slash)                       SlashBondV1.1                │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ forum-arc-sdk (TS) / forum-arc (Py)
            ┌──────────────────────────────────────────────────────┐
            │  AgoraMind keeper (LLM)  — live on VPS                │
            │  publishes recomputable receipts every ~10 min        │
            │  evidenceUri: forum.gudman.xyz/receipts/<bot>/<seq>   │
            │  nudges RiskKernelV2.enforce(CovenantVaultV1.2) each  │
            │  cycle → vault enforces itself                        │
            └──────────────────────────────────────────────────────┘
```

## Live deployment (Arc testnet, chain 5042002)

| Contract | Address | Role |
|---|---|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` | first-claim-wins `bytes32` → owner |
| `KeeperConfig` | `0xf37b1eb28d9af1b259cad3d71a14e76ca8ae0d26` | per-bot append-only config history |
| `TrackRecord` | `0xaace70a50573cb077f65d601cd19103afc4aef9d` | v1 signer-attributable PnL records |
| **`TrackRecordV2`** | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | strict seq + monotonic ts + prev-hash chain + replay rejection + evidence URI |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` | per-code attribution → pull-pattern USDC |
| **`AgentPool`** | `0x13855be80b6122187c0bcba007946f9fbaae3fae` | permissionless deposit, 20%/HWM perf fee |
| `SlashBond` (v1) | `0x66040fd1aea2c09dde83252114532b6cb9941482` | operator collateral, attestor = deployer |
| **`SlashBondV1.1`** | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | `attestor = RiskKernelV2` — fully autonomous |
| `RiskKernel` (v1) | `0x041a79c214e9daf876b5f2e76d7870ef4359630a` | permissionless mandate enforcer (pause-only) |
| **`RiskKernelV2`** | `0x0af356f280af1d8b7a43f0746c581614feec4055` | `enforce(vault)` flips state AND slashes 25% of bond in one tx |
| `CovenantVault` (v1) | `0xd126e11b3e79e9af23b021d793097a5902aae3ef` | mandate-bounded USDC credit line |
| `CovenantVaultV1.1` | `0x6d8914b844be1964563adb1e679e5a27e976d1f1` | initial v1.1 vault (orphan: stale botId binding) |
| **`CovenantVaultV1.2`** | `0x80384963c0c93414ff16e018c6618a64bc94df6d` | live demo vault, bound to AgoraMind bot — proves autonomous flow end-to-end |

Browse on the [Arc testnet explorer](https://testnet.arcscan.app/). Live frontend: **https://forum.gudman.xyz/**

**Verifiable on-chain proofs**:
- Genesis builder code claim — tx `0x35b7c33...e519b6`
- First TrackRecord publish — tx `0x095906f7...d5a5`
- **First autonomous pause+slash (v1.1)** — tx `0x2c8e79a5...05d13` — `RiskKernelV2.enforce()` flipped state ACTIVE→PAUSED **and** transferred 1.25 USDC out of the bond, atomic, 162,960 gas
- End-to-end fee flow — 5 USDC routed through `FeeDistributor` with 70/30 split

(Full tx hashes in `deployments/arc-testnet.json`. Open `https://testnet.arcscan.app/tx/<full-hash>` for any of them.)

### Try the autonomous-slash demo yourself

```bash
git clone https://github.com/Ridwannurudeen/forum.git && cd forum
node keeper/scripts/seed-tvl-and-bond.mjs       # one-time: deposit + operator bond
node keeper/scripts/demo-violation.mjs           # reads vault state; triggers if in violation
```

The demo script reads the live `CovenantVaultV1.2` state, the bound AgoraMind bot's last receipt, and the current freshness window. If the vault is in violation, it calls `RiskKernelV2.enforce(vault)` and prints the before/after state + slashed amount. If not, it prints what would happen and how to wait it out.

## Components

| Layer | Files |
|---|---|
| Contracts | `src/*.sol` (10 distinct Solidity contracts, 13 deployed instances incl. version bumps) |
| Foundry tests | `test/*.t.sol` (10 suites, 85 tests, green on CI) |
| SDKs | `forum-arc-sdk` (TypeScript, npm) and `forum-arc` (Python, PyPI) |
| Reference keeper | `keeper/src/*.ts` — V2-SDK-native, paper-mode, two-sided quoter |
| AI agent | `keeper/scripts/agora-mind-keeper.mjs` — LLM-driven keeper (Mock + Anthropic providers) publishing to `TrackRecordV2` with hash-pinned reasoning traces |
| Frontend | `frontend/index.html` — single-file `viem` + Tailwind CDN, reads live state from Arc |
| Ops scripts | `keeper/scripts/{deploy-v11,deploy-v12-vault,seed-tvl-and-bond,demo-violation,revive-and-seed-v12}.mjs` |
| Docs | `docs/{pitch-deck,multibillion-plan,demo-script,backtest-notes,x-post}.md`, `SUBMISSION.md` |

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

(Covenant Account client surfaces are not yet in the published SDKs — only the original four-contract surface. Use `viem` directly against the addresses above for now.)

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
forge build && forge test -vv      # 85 tests across 10 suites
```
(Or just push to GitHub — CI runs `forge build + test` automatically.)

## Honest scope

- All contracts are **immutable** — no admin keys, no upgradability, no pauser.
- `SlashBondV1.1.recipient = deployer` for the demo (operator self-slash). For real depositor protection, the recipient should be the vault itself or the `AgentPool`. One-line constructor change for redeploy.
- **Paper-mode default** for the reference keeper — no real Polymarket orders submitted. Real trading + fee capture not yet demonstrated.
- AgoraMind decisions are LLM-generated; quality of decisions is not the product — the **verifiability** of decisions is.
- **Polymarket V2 only** (no HIP-3, no Pump.fun, no Kalshi in v1).
- **Arc testnet only** until mainnet beta (Summer 2026).
- **No external audit.** Hackathon-scope security review only.
- `RiskKernelV2._trySlash` catches slash failures rather than reverting (intentional — don't block the pause) — means a silently-broken bond doesn't surface as a revert.
- Frontend is single-file HTML. Production-grade Next.js + indexer is roadmap.
- Not financial advice. Use at your own risk.

## License

MIT
