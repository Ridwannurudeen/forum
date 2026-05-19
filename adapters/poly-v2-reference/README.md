# Forum × Polymarket V2 reference adapter

A **runnable** reference Polymarket V2 bot that publishes Forum receipts. The simplest concrete answer to "I have a bot — how do I make it fundable through a Covenant Account?"

## Honest scope

This is NOT a wrapper over a third-party bot. Verified 2026-05-18:

- `polymarket/py-clob-client` (Python) is **archived and explicitly non-functional** as of 2026-05-11.
- The Polymarket GitHub org ships only client libraries (`clob-client-v2` TS / Py / Rust), the CLI, and infrastructure repos — **no public trading-bot example exists** for V2.
- The closest community precedent (`poly-lp-bot`) doesn't exist on GitHub.

So instead of wrapping a fictional bot, this adapter **is the reference bot**. It's the answer a third-party operator can fork, run, and customise in one afternoon.

## What it does

- Uses `@polymarket/clob-client-v2@^1.0.6` (the actively-maintained TS V2 client) to:
  - discover the 3 most liquid Polymarket V2 markets
  - read each market's best bid / ask / midprice every ~60s
- Picks a directional bias each tick (this reference picks `BUY` at midprice — swap for your strategy)
- **Paper-mode** by default — no orders submitted. Real-execution wiring is left for the integrator.
- Every `--publish-every` ticks (default 10), builds a Forum receipt and publishes to `TrackRecordV2` on Arc via `ForumV2Bridge`.

## Run it

```bash
# From the repo root
cd keeper   && npm install && cd ..   # tsx + viem + Forum bridge for the keeper
cd adapters && npm install && cd ..   # viem inside adapters/ (top-level dynamic imports)

# Put your raw 0x-hex testnet private key at ~/.forum-keys/deployer.key
# Fund the wallet from faucet.circle.com

# Run
./keeper/node_modules/.bin/tsx adapters/poly-v2-reference/bot.ts \
  --label my-v2-bot-v1 \
  --markets 3 \
  --interval 60 \
  --publish-every 10 \
  --receipts-dir /tmp/forum-receipts \
  --receipts-base-url https://example.com/receipts
```

Within seconds of the first publish:

- The receipt JSON is GETtable at your `--receipts-base-url`
- The verifier confirms hash + chain integrity: `node keeper/scripts/verify-receipt.mjs <receipt-url>` → `pnl: valid`
- Your bot is live in `TrackRecordV2`: queryable directly via `bridge.lastSeq()` / `bridge.lastRecordHash()`
- Within ~30 seconds the AgentScore leaderboard picks it up: `curl https://forum.gudman.xyz/api/agents` (the indexer ingests both `TrackRecord` v1 and v2 since `forum-indexer/0.6.0`).

## Runnable proof (2026-05-19)

Verified end-to-end on Arc testnet with `--label phase2-paper-demo-2026-05-19 --markets 3 --interval 15 --publish-every 2 --max-ticks 4`. Total: 60 seconds wall-clock, 3 on-chain transactions (1 register + 2 publish), exit 0.

| Field | Value (truncated — full bytes32s in `proof.json`) |
| --- | --- |
| `botId` | `0xba2a1b86…88c7` |
| Signer | `0x13585c6004fbA9D7D49219a6435B68348fD30770` |
| Kind | `MAKER` |
| Markets | will-sam-couvillon-…, us-x-iran-permanent-peace-deal-…, joseph-aoun-out-as-president-… |
| `registerBot` tx | `0x91dc97d7…2eeef` |
| Receipt 1 | seq=1, URI <https://forum.gudman.xyz/receipts/ba2a1b86c1ed/000001.json>, publish tx `0x5e73ca03…093c` |
| Receipt 2 | seq=2, URI <https://forum.gudman.xyz/receipts/ba2a1b86c1ed/000002.json>, publish tx `0xac849a81…5ded9` |
| Verifier | `node keeper/scripts/verify-receipt.mjs https://forum.gudman.xyz/receipts/ba2a1b86c1ed/000001.json` → `pnl: valid` (on-chain hash matches receipt JSON) |

The receipt's `fills: []` and `pnl: 0` reflect paper-mode honestly; [`docs/phase-2-real-fill-spec.md`](../../docs/phase-2-real-fill-spec.md) covers what changes when real CLOB orders are wired in.

## Make it fundable

After the first receipt lands, create a Covenant Account at <https://forum.gudman.xyz/#/console?t=create> using the same bot label. Depositors can now back you under enforceable mandate bounds.

## What to customise

The integration boundary is tiny. Look for the `pickDirection()` function in `bot.ts`. Replace its body with your strategy. Everything else — the V2 SDK setup, the receipt schema, the on-chain publish, the hash chain — stays.

## Reference real-world implementation

For a more sophisticated version with an LLM-driven decision engine, see `keeper/scripts/agora-mind-keeper.mjs` — it's been running on the VPS publishing receipts every ~10 minutes since 2026-05-17.
