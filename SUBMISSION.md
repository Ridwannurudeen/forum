# Forum — Agora Agents Hackathon submission

> **DO NOT submit this without explicit user approval.**
> This file is a pre-fill for the Google Form at forms.gle/hFPM2t4Jt1zGfqzM7.

## Project name

Forum

## One-line description

Arc-native operator and settlement plane for prediction-market bots — registry, live config, on-chain track record, USDC fee distribution. Built on the lane Canteen explicitly named as missing in writing.

## Project URL (live demo)

- Frontend dashboard: **https://forum.gudman.xyz/** _(deploys once user adds DNS A record for `forum` → 75.119.153.252 and runs `/opt/forum/enable-nginx.sh`)_
- Repo: **https://github.com/Ridwannurudeen/forum** (public)
- Block explorer (anyone can verify): **https://testnet.arcscan.app/address/0x730825299821d411146c503915553e37ebdc750c**

## GitHub repository

https://github.com/Ridwannurudeen/forum

## Which RFB does this fit? (RFBs are validation, not required)

Closest fit: **RFB 02 — Prediction Market Trader Intelligence** and **RFB 06 — Social Trading Intelligence**, but the project sits one layer beneath both: Forum is the operator/settlement primitive that any RFB-style bot plugs into.

The strongest validation isn't an RFB at all — it's the hackathon page's own **Research section, Hack #02**:

> *"a thin 'agent-as-builder' wrapper that registers any agent framework as a Polymarket V2 builder, exposes its structured outputs as a signed feed, and earns USDC builder fees per fill — Arc's ~$0.01 fees make per-pick economics work at retail size."*

Forum is the operator-plane primitive that "wrapper" sits on top of.

## What user problem are you building for?

When Polymarket V2 launched April 28 2026, it broke every public market-making and attribution tool. New V2-aware bots have shipped since (oracle-arc, PolyForge, poly-lp-bot, Polystrat, and ~15 SEO-bait clones in the last 14 days). Every one of them faces the same four operator problems:

1. **Claim and prove ownership of a `bytes32` builder code** — Polymarket V2 attributes fees via a signed `bytes32` field, but there's no on-chain registry of who owns which code. Without one, anyone can squat on your code, and you have no way to prove ownership cryptographically.
2. **Tune live params without redeploying** — every MM tweaks spread, size, inventory caps daily. Today that means SSHing and editing config files. With Forum, operators write to `KeeperConfig` on Arc; bots poll the latest snapshot.
3. **Publish a verifiable performance track record** — every trading agent claims great returns. There's no way to verify them. Forum's `TrackRecord` accepts EIP-712-signed PnL records that can't be backdated or fabricated.
4. **Receive and split USDC fees** — Polymarket V2 builder fees arrive on Polygon as pUSD. Cross-chain split logic for builder-code owners (who often co-build with researchers, infra providers, etc.) doesn't exist anywhere. Forum's `FeeDistributor` takes a per-code recipient table and pull-pattern-pays everyone.

Forum is the substrate every prediction-market bot needs. We built it on Arc because Polymarket lives on Polygon, so the operator state has to live somewhere else — and Arc's USDC-native gas + sub-second finality is the natural home.

## How many users have you onboarded?

- **4 bots registered on-chain (all 4 kinds active: MAKER/TAKER/ARB/OTHER):** MAKER + TAKER (with ARB + OTHER ready to use).
  - `forum-ref-keeper-smoke` (MAKER) — live publishing TrackRecord from real Polymarket V2 book reader.
  - `demo-arb-v1` (ARB) — registered + published, demonstrates the ARB kind.
  - `demo-other-v1` (OTHER) — registered + published, demonstrates the OTHER kind.
  - `demo-taker-v1` (TAKER) — live publishing directional picks on Polymarket V2 markets.
- **1 builder code claimed** on-chain (`forum-genesis-code`).
- Outreach pending in Canteen + Arc Builder Discords post-deployment.

## Live on-chain activity during the event window (May 11–25 2026)

Verifiable on the Arc testnet block explorer (`testnet.arcscan.app`):

| Action | Tx |
|---|---|
| Deploy `BuilderCodeRegistry` | `0xe9a1d783...8fe82d85` |
| Deploy `KeeperConfig` | `0x44bd05f8...8b4ab58b` |
| Deploy `TrackRecord` | `0xb02fa1c0...02a15a` |
| Deploy `FeeDistributor` | `0x4d8edd8c...88efb11` |
| Genesis builder code claim | `0x35b7c33...e519b6` |
| MAKER first TrackRecord publish | `0x095906f7...d5a5` |
| TAKER bot register | `0x31bf492b...c1c60dc` |
| TAKER pick publish | `0xa7ff3c2d...20f93716` |
| ARB bot register | `0x0f74c177...12fe73c5` |
| ARB pick publish | `0x27a01b28...aecd6661` |
| OTHER bot register | `0xfbd5c4c4...1326876b` |
| OTHER pick publish | `0x8b953fe4...0532f286` |

13 verifiable on-chain transactions across 4 immutable contracts and 4 bots within the event window. The keeper publishes a fresh TrackRecord every N ticks while running — total volume grows continuously.

## Architecture (high level)

```
On-chain (Arc testnet):
  BuilderCodeRegistry  — bytes32 code → owner
  KeeperConfig         — (operator, botId) → config bytes (history)
  TrackRecord          — bot → append-only signed PnL records, taxonomy MAKER/TAKER/ARB/OTHER
  FeeDistributor       — code → recipient table → pull-claim USDC

Off-chain SDKs (symmetric API):
  forum-arc-sdk  (TypeScript, viem-based)
  forum-arc      (Python, web3.py-based)

Reference integration:
  V2-SDK-native paper-mode market-maker keeper.
  Consumes @polymarket/clob-client-v2.
  Publishes TrackRecord every N ticks.

Frontend:
  Single-file HTML dashboard reading live state from Arc.
  Hosted at forum.gudman.xyz (DNS pending).
```

## How does this use the Circle developer platform?

| Tool | Use |
|---|---|
| **Arc** | All operator/settlement state on Arc testnet (chain 5042002). 4 immutable Solidity contracts. USDC-as-gas — operators pay in the same unit they earn fees in. |
| **USDC** | All fee distribution denominated in USDC via `FeeDistributor.distribute()`. Pull-pattern claim avoids reentrancy. |
| **Wallets (Programmable / Agent)** | Each bot is identified by an `address` registered as the EIP-712 signer of its TrackRecord entries. Compatible with Circle Agent Wallets out of the box. |
| **CCTP V2** | Roadmap (v1.1): Polymarket V2 fees arrive on Polygon as pUSD; CCTP V2 bridges to Arc USDC for distribution via `FeeDistributor`. Arc-testnet ↔ Polygon-Amoy CCTP V2 verified live (Forum constructor accepts the USDC token address as a parameter). |
| **Gateway / Nanopayments** | Future: agent operators paying for hosted RPC, signal subscriptions, or analytics via x402 nanopayments. `@circle-fin/x402-batching@3.0.4` peer-dep installs cleanly. |

## What's novel?

Most teams in this hackathon will build trading bots. We built the operator substrate every bot needs.

Three "known-empty lanes" were named in Canteen's own May 1 2026 essay (*Unbundling the Prediction Market Stack*). Forum hits two of them directly:

1. **V2-aware reference market-making keeper** — `keeper/` ships one.
2. **Cross-venue agent identity registry on a settlement-grade chain** — `BuilderCodeRegistry` is that, ERC-8021-compatible.

The third lane (markets on operator behavior) is a v2 roadmap item, naturally enabled once enough bots are publishing TrackRecord.

## Risks + honest scope

- All contracts are immutable (no admin keys, no upgradability) — by design, but means a bug = redeploy.
- Reference keeper is paper-mode by default — no real Polymarket orders submitted. Strategy proven against live book data only.
- Polymarket V2 only in v1 (no HIP-3, no Kalshi, no Pump.fun).
- Arc testnet only until mainnet beta (Summer 2026).
- Frontend is single-file HTML in v1; Next.js + shadcn upgrade pending faster network.

## Tests + CI

- Foundry tests for all 4 contracts (happy paths + key reverts + EIP-712 sig verification + MockUsdc helper for FeeDistributor).
- TypeScript SDK passes `tsc --noEmit` cleanly.
- Python SDK imports cleanly.
- GitHub Actions CI green on every push: `forge build + test`, `forum-arc-sdk typecheck`, `forum-arc Python import check`.

## Team

Solo build — Ridwan Nurudeen (`Ridwannurudeen`).

## Contact

nraheemst@gmail.com

## Demo video

_(to be recorded and linked here — see `docs/demo-script.md`)_

## License

MIT
