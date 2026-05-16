# Forum — Architecture

## What this is

Arc-native operator and settlement plane for prediction-market bots. Polymarket V2 lives on Polygon; bots need a shared operator/settlement plane that doesn't live in the same place their inventory does. Arc provides sub-second finality + USDC-as-gas, which makes it the natural home.

## On-chain (Arc testnet, chain 5042002)

| Contract | Purpose |
|---|---|
| `BuilderCodeRegistry` | First-claim-wins binding from `bytes32` Polymarket builder codes to owner addresses. Owners can transfer, revoke, set metadata URI. |
| `KeeperConfig` | Per-`(operator, botId)` append-only config history. Operators write opaque `bytes`; bots poll the latest snapshot. |
| `TrackRecord` | Per-`botId` append-only PnL records. Each record is EIP-712-signed by the bot's registered signer. Bot kind (`MAKER`/`TAKER`/`ARB`/`OTHER`) fixed at registration. |
| `FeeDistributor` | Per-code attribution table (recipients + bps summing to 10_000). Pull-pattern USDC claim. |

## Off-chain SDKs

- `forum-arc-sdk` (TypeScript / npm) — viem-based, used by the reference keeper and the PolyForge adapter.
- `forum-arc` (Python / PyPI) — web3.py-based, used by the poly-lp-bot adapter.

## Reference integration (demo workload)

A V2-SDK-native, paper-mode, two-sided quoter that uses every Forum contract end-to-end. Lives in `keeper/`. Lands D2–D4.

## Third-party adapters (traction story)

- `adapter-poly-lp-bot` (Python) — wraps `Makabeez/poly-lp-bot` to publish its PnL to `TrackRecord`. Lands D3.
- `adapter-polyforge` (TypeScript) — wraps `MitemsHub/PolyForge` similarly. Lands D4.

## Why Arc specifically

- **USDC-as-gas** — operators don't need a separate gas token; everything is denominated in the same unit they earn fees in.
- **Sub-second finality** (Malachite BFT) — config updates take effect in the next block; the operator UI feels real-time.
- **CCTP V2** — fees earned on Polygon (in pUSD post-V2-launch) can be bridged to Arc USDC with verified contracts already live.

## Honest scope

- v1: 9-day hackathon build (Agora Agents Hackathon, May 11–25 2026)
- Contracts: immutable. No admin keys. No upgradability.
- Reference keeper: paper-mode default — no money at risk
- Polymarket V2 only. No HIP-3, no Pump.fun, no Kalshi in v1.
- Arc testnet only until mainnet beta (Summer 2026)
