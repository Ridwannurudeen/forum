# Forum Adapters

Reference adapter templates that wrap any existing trading bot — Polymarket V2, Hyperliquid HIP-3, perps bots, copy-traders, anything that emits structured trade output — and publish receipts to Forum's `TrackRecordV2` on Arc.

**Why adapters matter.** Forum's value isn't the bot. It's the trust layer that makes someone else's bot fundable. An adapter is the 30-line shim that turns "my bot prints PnL to a log" into "my bot has a signer-attributed, hash-chained, evidence-pinned receipt graph on Arc — anyone can underwrite me without trusting my screenshot."

## What's here

| Directory | What |
|---|---|
| [`template/`](./template/) | Minimal adapter showing the publish loop in both TypeScript and Python. Fork this. |

## The integration pattern (5 steps)

Whatever your bot is, the adapter does the same five things every N ticks (e.g. every 10 minutes):

1. **Snapshot.** Collect the trade decisions / fills / inventory / PnL inputs for the period.
2. **Build a Receipt JSON.** Canonical schema (`keeper/src/receipt.ts`): market metadata, book snapshots, fills, inventory, PnL formula version, optional `decisionTrace { traceUri, traceHash }`.
3. **Pin the receipt.** Serve the JSON at a public URL (`/opt/forum/web/receipts/<bot>/<seq>.json` or any CDN). Compute `evidenceHash = keccak256(canonical(json))`.
4. **Publish on-chain.** Sign an EIP-712 `RecordV2` referencing the previous record's hash + the new `evidenceUri` + `evidenceHash`. Call `TrackRecordV2.publish(botId, record, signature)`.
5. **(Optional) bind a Covenant Account.** If you want depositor capital, create a `CovenantVault` via `CovenantVaultFactory.createVault(mandate)` with your `botId`. Capital becomes underwritable the moment one receipt is published.

Once your first receipt lands you can verify it end-to-end: the receipt JSON's keccak hash matches the on-chain `evidenceHash` in `TrackRecordV2`, and `node keeper/scripts/verify-receipt.mjs <url>` returns `pnl: valid`. Note that the AgentScore leaderboard at `/api/agents` is currently V1-only — the indexer (`keeper/scripts/forum-indexer.mjs`) doesn't yet ingest `TrackRecordV2` registrations, so V2-only bots (including the live AgoraMind keeper itself) don't surface there. Tracked as a separate follow-up.

## Live primitives the adapter calls

All on Arc testnet, chain `5042002`:

| Contract | Address | Purpose |
|---|---|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` | first-claim-wins `bytes32 → owner` |
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | strict-sequence receipt ledger |
| `CovenantVaultFactory` | `0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26` | optional: create a Covenant Account in one tx |
| `RiskKernelV2` | `0x0af356f280af1d8b7a43f0746c581614feec4055` | optional: anyone can enforce your mandate |
| `SlashBondV1.1` | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | optional: operator collateral, autonomously slashable |

## SDKs

- **TypeScript**: `npm i forum-arc-sdk` — see `sdk-ts/src/client.ts` for the wrapper, `sdk-ts/src/abi.ts` for raw ABIs.
- **Python**: `pip install forum-arc` — see `sdk-py/src/forum_arc/client.py` and `sdk-py/src/forum_arc/abi.py`.

Both ship the canonical address set in `deployments.ts` / `deployments.py` so adapters don't hardcode anything.

## Live reference adapter

The most complete real-world adapter is the AgoraMind keeper itself:
- `keeper/scripts/agora-mind-keeper.mjs` — full publish loop (LLM decide → receipt build → keccak → publish)
- `keeper/src/forum-v2.ts` — `ForumV2Bridge` that handles registration, signing, and the publish race-fix
- `keeper/src/receipt.ts` — canonical receipt schema + `verifyReceipt()`

It's been publishing receipts every ~10 minutes on the live VPS since 2026-05-17. Copy the structure; swap your bot's decision/fill data into `cycleDecisions` and `cycleFills`.
