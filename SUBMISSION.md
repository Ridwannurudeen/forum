# Forum — Agora Agents Hackathon submission

> **DO NOT submit this without explicit user approval.**
> This file is a pre-fill for the Google Form at forms.gle/hFPM2t4Jt1zGfqzM7.

## Project name

Forum

## One-line description

**Covenant Accounts — programmable USDC credit lines for AI trading agents.** Mandate-bounded vaults on Arc with autonomous on-chain pause+slash. The operator never custodies depositor funds; permissionless `RiskKernelV2.enforce(vault)` flips state and slashes the operator's bond in one tx when the agent breaches its mandate.

## Project URL (live demo)

- Frontend dashboard: **https://forum.gudman.xyz/** — LIVE (HTTPS, certbot-issued cert, security headers, single-file HTML reading state from Arc testnet RPC every 30s)
- Repo: **https://github.com/Ridwannurudeen/forum** (public)
- Block explorer (anyone can verify): **https://testnet.arcscan.app/address/0x80384963c0c93414ff16e018c6618a64bc94df6d** (`CovenantVaultV1.2`)
- Live receipt example: **https://forum.gudman.xyz/receipts/201c8909dca1/000006.json**

## GitHub repository

https://github.com/Ridwannurudeen/forum

## Which RFB does this fit? (RFBs are framing, not required)

Per the hackathon page, *"these aren't tracks. If one excites you, treat it as extra validation."*

Forum touches three of the RFBs and Research hacks listed on the page:

- **Research Hack #02** (*"builder codes as every LLM agent's monetization layer"*) — fits the `BuilderCodeRegistry` / `FeeDistributor` / `TrackRecord` / `KeeperConfig` infrastructure layer, which is deployed.
- **Research Hack #06** (*"slash-bonded leaderboard copy-trading… a USDC performance bond on Arc… smart contract reads via oracle; if the leader falls below a defined threshold, the bond slashes proportionally and settles in under a second"*) — fits the `SlashBond` + `RiskKernelV2` + `CovenantVault` Covenant Accounts primitive. **Same shape — USDC bond on Arc, automatic proportional slashing, sub-second settlement — but the signal source is the operator's own published receipts (TrackRecordV2), not an external leaderboard oracle.**
- **RFB 02 / RFB 06** — Forum is the substrate either an RFB 02 (Prediction Market Trader Intelligence) bot or an RFB 06 (Social Trading Intelligence) bot would plug into to be capital-fundable.

The product is the primitive *one layer beneath* the RFBs.

## What user problem are you building for?

**Capital can't trust an AI trading agent today.** Three options exist and none compose:

1. **Hand the agent your private key** — operator can run with the money. No recourse.
2. **Use a regulated managed account** — KYC, multi-day onboarding, custody, monthly NAV statements. Incompatible with bots that act in milliseconds.
3. **Build your own audit pipeline** — every quant team rebuilds the same mandate enforcement, drawdown gates, perf-fee crystallisation, slashing logic. Doesn't compose across teams or venues.

So capital sits on the sidelines, and every *"12% APY MM bot"* pitch is unverifiable marketing.

Forum's Covenant Account is one immutable contract that holds depositors' USDC. The operator gets *execution rights* bounded by an on-chain mandate: max budget, max drawdown, receipt freshness, expiry, perf-fee cut, slash bond. They never custody the funds. Any third party can call `RiskKernelV2.enforce(vault)` — one tx flips the vault to PAUSED **and** moves slash funds out of the bond. Permissionless. No operator click required.

## How many users have you onboarded?

Verified on-chain state (read at submission-time):

- **5 bots registered** on TrackRecord v1 (kinds MAKER/TAKER/ARB/OTHER + continuous VPS keeper)
- **1 AI agent live** — `forum-agora-mind` keeper, LLM-driven decisions, publishing recomputable receipts every ~10 min to `TrackRecordV2` (latest seq 6+; receipts at `https://forum.gudman.xyz/receipts/201c8909dca1/`)
- **1 USDC depositor** on `CovenantVaultV1.2` (deployer-funded for the demo; depositor surface is permissionless)
- **5 USDC bonded** by the operator on `SlashBondV1.1`
- **1.25 USDC slashed autonomously** from the operator's bond by `RiskKernelV2.enforce()` after the AgoraMind keeper missed a 30-minute freshness window — tx `0x2c8e79a5...05d13`
- **1 builder code claimed** on `BuilderCodeRegistry` (`forum-genesis-code`)
- **5 USDC routed end-to-end** through `FeeDistributor.distribute()` with 70/30 attribution split

Honest scope: external trading teams have not yet deposited or run bonded. SDKs are published (npm `forum-arc-sdk`, PyPI `forum-arc`); outreach drafts exist but partner integrations have not been confirmed.

## Live on-chain activity during the event window (May 11–25 2026)

Verifiable on `testnet.arcscan.app`. Truncated hashes are shown; deployments JSON has full values.

| Action | Tx |
|---|---|
| Deploy `BuilderCodeRegistry` | `0xe9a1d783...8fe82d85` |
| Deploy `KeeperConfig` | `0x44bd05f8...8b4ab58b` |
| Deploy `TrackRecord` | `0xb02fa1c0...02a15a` |
| Deploy `FeeDistributor` | `0x4d8edd8c...88efb11` |
| Deploy `TrackRecordV2` | (full hash in deployments JSON) |
| Deploy `AgentPool` | (full hash in deployments JSON) |
| Deploy `SlashBond` v1 | (full hash in deployments JSON) |
| Deploy `RiskKernel` v1 | (full hash in deployments JSON) |
| Deploy `CovenantVault` v1 | (full hash in deployments JSON) |
| **Deploy `RiskKernelV2`** | `0x866dfa73...5ddc4a41` |
| **Deploy `SlashBondV1.1`** (`attestor = RiskKernelV2`) | `0x410bcd39...c5943747` |
| **Deploy `CovenantVaultV1.1`** | `0xa12c61a7...92a5ed98` |
| **Deploy `CovenantVaultV1.2`** (bound to live AgoraMind bot) | `0x08843812...bbd26742` |
| Seed v1 vault TVL (1 USDC) | `0xb3e6b061...e49fdf0` |
| Operator bond into SlashBondV1.1 (5 USDC) | `0xf37fed22...def87d3` |
| **First autonomous pause+slash** — `RiskKernelV2.enforce(v1.1)` flipped ACTIVE→PAUSED and moved 1.25 USDC out of the bond in **one 162,960-gas tx** | `0x2c8e79a5...305d13` |
| Revive v1.2 (`enforce()` when verdict=ALLOW, PAUSED→ACTIVE) | `0x7d94affe...c4f04ec1` |
| Seed v1.2 TVL (1 USDC) | `0xed381414...c9693857` |
| AgoraMind TrackRecordV2 publish seq=4 (post-fix) | `0x39e7211e...4a66170be8` |
| AgoraMind TrackRecordV2 publish seq=5 | `0x9fe69616...70dfb49` |
| AgoraMind TrackRecordV2 publish seq=6 | `0x8d60ddea...3081dd23b6` |

Continuous: VPS keeper publishes a fresh `TrackRecordV2` receipt every ~10 min, each with `evidenceUri` pointing at the matching JSON file and `evidenceHash = keccak256(canonical(json))`.

## Architecture — 13 immutable contracts live on Arc testnet (chain 5042002)

| Group | Contract | Address |
|---|---|---|
| Identity & attribution | `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` |
| Identity & attribution | `KeeperConfig` | `0xf37b1eb28d9af1b259cad3d71a14e76ca8ae0d26` |
| Reputation & receipts | `TrackRecord` (v1) | `0xaace70a50573cb077f65d601cd19103afc4aef9d` |
| Reputation & receipts | **`TrackRecordV2`** (strict seq + monotonic time + prev-hash chain + replay rejection + evidence URI commitment) | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` |
| Capital & distribution | `AgentPool` (deposit + 20%/HWM perf fee) | `0x13855be80b6122187c0bcba007946f9fbaae3fae` |
| Capital & distribution | `FeeDistributor` (per-code pull-pattern USDC) | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` |
| Mandate & autonomous risk | `CovenantVault` (v1) | `0xd126e11b3e79e9af23b021d793097a5902aae3ef` |
| Mandate & autonomous risk | `CovenantVaultV1.1` (bound to demo bot) | `0x6d8914b844be1964563adb1e679e5a27e976d1f1` |
| Mandate & autonomous risk | **`CovenantVaultV1.2`** (bound to live AgoraMind bot) | `0x80384963c0c93414ff16e018c6618a64bc94df6d` |
| Mandate & autonomous risk | `RiskKernel` (v1, pause-only) | `0x041a79c214e9daf876b5f2e76d7870ef4359630a` |
| Mandate & autonomous risk | **`RiskKernelV2`** (`enforce(vault)` flips state AND slashes 25% of bond in one tx) | `0x0af356f280af1d8b7a43f0746c581614feec4055` |
| Mandate & autonomous risk | `SlashBond` (v1, attestor = deployer) | `0x66040fd1aea2c09dde83252114532b6cb9941482` |
| Mandate & autonomous risk | **`SlashBondV1.1`** (`attestor = RiskKernelV2`, fully autonomous) | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` |

Services on VPS (both active under systemd):
- `forum-keeper.service` — v1 Avellaneda-Stoikov keeper publishing every ~10 min to TrackRecord v1
- `forum-agora-mind.service` — **AI-driven keeper** (AgoraMind LLM, Mock + Anthropic providers) publishing to `TrackRecordV2` with hash-pinned reasoning traces + receipt JSON pinned at `/opt/forum/web/receipts/<bot>/<seq>.json` + nudges `RiskKernelV2.enforce(CovenantVaultV1.2)` every publish cycle

Each receipt:
- canonical JSON is served at a public URL
- `keccak256(canonical(json)) === TrackRecordV2.recordAt(bot, idx).evidenceHash` (verified live; sample receipt at `https://forum.gudman.xyz/receipts/201c8909dca1/000014.json` hashes to `0x30bc2a76...0cab9952`)
- `keeper/src/receipt.ts` ships `verifyReceipt()`; 8 vitest tests pass

## What's novel?

Three pieces, ordered by independence-of-shipping:

1. **Mandate-bounded credit lines for autonomous agents.** A vault that gives an operator *execution rights* up to `budgetUsdc`, with `maxDrawdownBps` / `receiptFreshnessSec` / `expiry` / `perfFeeBps` / `bondContract` baked into the constructor and immutable. The operator never custodies funds. We have not found a public Arc / Polymarket comparable.
2. **Autonomous pause+slash in one tx.** `RiskKernelV2.enforce(vault)` reads vault state + the bot's signed receipts from `TrackRecordV2`, computes a verdict (`ALLOW` / `PAUSE_DRAWDOWN` / `PAUSE_OVERSUBSCRIBED` / `PAUSE_STALE` / `PAUSE_EXPIRED`), flips vault state, and — for operator-fault verdicts — calls `SlashBond.slash()` for 25% of bond balance, all atomic. Proven by tx `0x2c8e79a5...05d13` (162,960 gas).
3. **Recomputable performance graph.** `TrackRecordV2` enforces strict sequence + monotonic time + hash chain + replay rejection + EIP-712 signatures, and commits to an off-chain `evidenceUri / evidenceHash` pair. Any third party fetches the JSON, recomputes the hash, and verifies. This is the building block for an AgentScore reputation graph.

## How does this use the Circle developer platform?

| Tool | Status |
|---|---|
| **Arc (testnet, chain 5042002)** | ✅ Live. All 13 contracts deployed on Arc. USDC-as-gas — operators and depositors pay in the same unit they earn fees in. |
| **USDC** | ✅ Live. All vault accounting, bond accounting, perf-fee crystallisation, fee distribution denominated in USDC. |
| **CCTP V2** | ⚠️ Constructor parameter accepts the USDC token address so a Polygon → Arc CCTP V2 bridge would slot in without contract change. Not wired in v1. |
| **Gateway / Nanopayments** | ❌ Not used. Roadmap: per-signal nanopayments for the reputation API. |
| **Wallets (Programmable / Agent)** | ⚠️ Each bot is identified by an `address` registered as the EIP-712 signer of its receipts — compatible with Circle Agent Wallets, but we use plain `viem`-managed accounts today, not Circle's wallet service. |
| **Paymaster** | ❌ Not used. Investigating as a v1.1 add for the hackathon window. |
| **USYC** | ⚠️ Read-only verification done on Arc testnet (totalSupply readable). Vault has `depositTotalIdle` ready for a `parkIdle()` integration; the call site isn't built. |
| **App Kit** | ❌ Not used. Frontend is single-file `viem` + Tailwind CDN. |

Honest count: **2 of 8** Circle product categories actively used in v1. This is the biggest known scoring gap against the 20%-Circle-tools criterion.

## Tests + CI

- **Foundry: 85 tests passing across 10 suites** (`BuilderCodeRegistry`, `KeeperConfig`, `TrackRecord`, `TrackRecordV2`, `FeeDistributor`, `AgentPool`, `CovenantVault`, `RiskKernel`, `RiskKernelV2`, `SlashBond`).
- **TypeScript SDK** passes `tsc --noEmit` cleanly.
- **Keeper TypeScript** passes `tsc --noEmit` + vitest (strategy/inventory/receipt/agora-mind).
- **Python SDK** imports cleanly.
- **GitHub Actions CI green** on every push (Foundry, keeper tsc + vitest, TS SDK tsc, Python import).

## Risks + honest scope

- All contracts are **immutable**. No admin keys, no upgradability. Bug → redeploy.
- `SlashBondV1.1.recipient = deployer` for the demo (operator self-slash). For real depositor-protection, recipient should be `CovenantVault` or `AgentPool`. One-line constructor change for redeploy.
- Reference keeper is **paper-mode by default** — no real Polymarket orders submitted. Strategy proven against live book data only. Real trading + fee capture not yet demonstrated.
- AgoraMind decisions are LLM-generated; provider abstraction supports Mock + Anthropic. Quality of decisions is not the product — the **verifiability of decisions** is.
- Polymarket V2 only in v1 (no HIP-3, no Kalshi, no Pump.fun).
- Arc testnet only. Mainnet beta pending.
- No external audit. Hackathon-scope security review only.
- `RiskKernelV2._trySlash` catches slash failures rather than reverting — intentional (don't block pause), but means a silently-broken bond doesn't surface.
- Frontend is single-file HTML. Production-grade Next.js + indexer is roadmap.

## Team

Solo build — Ridwan Nurudeen (`Ridwannurudeen`).

## Contact

nraheemst@gmail.com

## Demo video

_(To be recorded — see `docs/demo-script.md`.)_

## License

MIT
