# Forum Adapter Template

Minimal scaffold for wrapping any trading bot so it publishes Forum receipts. Fork this, swap the `runBot()` placeholder with your bot's actual decision/fill loop, point `RECEIPT_BASE_URL` at a public location, set `FORUM_PRIVATE_KEY` in your env, run it.

## Files

| File | Purpose |
|---|---|
| [`adapter.ts`](./adapter.ts) | TypeScript reference — viem + `ForumV2Bridge`. Run with `tsx`. |
| [`adapter.py`](./adapter.py) | Python reference — `forum_arc` SDK. Run with `python3`. |

## Quickstart (TypeScript)

```bash
# 1. clone Forum (gives you the SDK + the reference receipt schema)
git clone https://github.com/Ridwannurudeen/forum.git
cd forum/keeper && npm install && cd ..

# 2. drop your bot into the runBot() placeholder in adapters/template/adapter.ts
# 3. fund a wallet on Arc testnet (faucet.circle.com), write the raw 0x-hex private key to ~/.forum-keys/deployer.key
# 4. publish a public URL for receipts (any CDN, or scp to a webserver)
# 5. run

FORUM_BOT_LABEL=my-bot-v1 \
RECEIPT_BASE_URL=https://my-bot.example.com/receipts \
RECEIPT_LOCAL_DIR=./receipts \
./keeper/node_modules/.bin/tsx adapters/template/adapter.ts
```

Within 30 seconds of the first publish:

- Your receipt JSON is GETtable + `node keeper/scripts/verify-receipt.mjs <url>` returns `pnl: valid` (the AgentScore leaderboard at `/api/agents` is V1-only today; V2 indexer support is a separate follow-up)
- Your receipt is GETtable: `curl https://forum.gudman.xyz/api/bots/<botId>/records`
- Anyone can recompute your PnL: `npx tsx keeper/scripts/verify-receipt.mjs <receipt-url>`

## Quickstart (Python)

```bash
pip install forum-arc web3 eth-account

FORUM_BOT_LABEL=my-bot-v1 \
RECEIPT_BASE_URL=https://my-bot.example.com/receipts \
FORUM_PRIVATE_KEY=0x... \
python3 adapters/template/adapter.py
```

## The integration boundary

Your bot only has to fill in two things:

1. **`runBot()`** — produce a list of decisions + fills for the period (whatever shape your bot already uses)
2. **`computePeriodPnl()`** — turn those into `pnlMicros: int128` and `fills: uint64`

Everything else (botId derivation, receipt building, EIP-712 signing, hash chaining, on-chain publish, race-fix) is in the SDK.

## Optionally — make your bot fundable

If you want depositor capital, after the first receipt publishes, create a Covenant Account in the web UI: <https://forum.gudman.xyz/#/console?t=create>

Use the same `botId` you publish to. Anyone can then deposit USDC into your vault; you can pull credit bounded by the mandate; RiskKernelV2 enforces it automatically.

## Where to ask

Open an issue: <https://github.com/Ridwannurudeen/forum/issues>
