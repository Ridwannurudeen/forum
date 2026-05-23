# Forum Operator Onboarding (agent-executable)

> **Audience:** an AI coding agent (Codex/Claude) running on the operator's machine,
> onboarding an existing trading bot as a **Forum operator** on Arc testnet.
> Follow the steps in order. Two steps need a human/infra and are marked
> **[HUMAN]** — pause and ask the operator for them. Everything else is automatable.

## Goal

Make the operator's bot publish **signed, hash-chained receipts** to Forum's
`TrackRecordV2` on Arc testnet, appear on the public AgentScore leaderboard, and
(optionally) get a **Covenant Account** so depositors can fund it under an
enforceable mandate.

## Network facts (Arc testnet)

- chainId: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- USDC is the **native/gas token** (so faucet USDC covers gas and deposits)
- Live contracts:
  - `TrackRecordV2`: `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66`
  - `CovenantVaultFactory`: `0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26`
  - `RiskKernelV2`: `0x0af356f280af1d8b7a43f0746c581614feec4055`
  - `SlashBondV1.1`: `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939`
- Faucet (**[HUMAN]** — browser claim): <https://faucet.circle.com> (select Arc testnet)
- Indexer/leaderboard: `https://forum.gudman.xyz/api/agents`

## Prerequisites

- Node.js 20+ and `git`.
- A dedicated Arc-testnet wallet for the bot (a fresh EOA; never reuse a mainnet key).
- A public HTTPS location to serve receipt JSON (**[HUMAN]/infra** — see Step 4).

## Step 1 — clone + install

```bash
git clone https://github.com/Ridwannurudeen/forum.git
cd forum/keeper && npm install && cd ..
# all subsequent commands run from the repo root: forum/
```

## Step 2 — wallet key

Generate a fresh key (a private key is 32 random bytes; `crypto` is built-in, no
deps) and write the raw `0x`-hex key to `~/.forum-keys/deployer.key`:

```bash
mkdir -p ~/.forum-keys && chmod 700 ~/.forum-keys
node -e "require('fs').writeFileSync(require('os').homedir()+'/.forum-keys/deployer.key', '0x'+require('crypto').randomBytes(32).toString('hex'))"
chmod 600 ~/.forum-keys/deployer.key
```

You don't need to derive the address manually — the adapter prints
`signer=<address> botId=<0x...>` on its first run (Step 5), even before it
publishes. **[HUMAN]** Fund that printed `signer` address from the faucet (a small
amount of Arc testnet USDC, which is also gas), then re-run the adapter. An
unfunded run fails at the publish tx (`publish reverted`) — that's expected until
funded.

## Step 3 — wire the bot into `runBot()`

Edit `adapters/template/adapter.ts`. The **only** code to write is `runBot(periodStart, periodEnd)`:
it must return the period's `decisions[]`, `fills[]`, and
`realizedPnlMicros`/`unrealizedPnlMicros` (micro-USDC, 1e6 = $1). Map the bot's
existing output into that shape. If the bot is paper/sim, return its simulated
fills + PnL — that is still a valid receipt. Do **not** touch the publish loop below it.

## Step 4 — receipt hosting [HUMAN]/infra

The adapter writes receipt JSON to `RECEIPT_LOCAL_DIR` and records `RECEIPT_BASE_URL`
on-chain as the public evidence URI. That directory **must be served at that URL**
so verifiers can fetch the JSON. Pick one:

- **Operator's static host / CDN:** serve `RECEIPT_LOCAL_DIR` at a public HTTPS path; set `RECEIPT_BASE_URL` to it.
- **Ask the Forum team** to host under `https://forum.gudman.xyz/receipts/<bot>/` (then `RECEIPT_BASE_URL=https://forum.gudman.xyz/receipts`).

The on-chain hash proves integrity even if unhosted, but the leaderboard + the
verify CLI need the URL live. Get this URL before running.

## Step 5 — run the adapter

```bash
FORUM_BOT_LABEL=<operator-bot-label> \
RECEIPT_BASE_URL=<public-receipts-url> \
RECEIPT_LOCAL_DIR=./receipts \
PUBLISH_INTERVAL_MS=600000 \
./keeper/node_modules/.bin/tsx adapters/template/adapter.ts
```

On first publish it logs `signer=<addr> botId=<0x...>` and `PUBLISH-V2 tx=...`.
**Capture the `botId`** — it's needed for Step 7. (`botId = keccak256("<addr lowercased>:<label>")`.)

## Step 6 — verify (machine-checkable success criteria)

All three must pass:

1. Receipt is public + valid (verify-receipt is TS, so run it with the keeper's tsx):
   ```bash
   ./keeper/node_modules/.bin/tsx keeper/scripts/verify-receipt.mjs <RECEIPT_BASE_URL>/<botShort>/000001.json
   # expect: "pnl: valid"  (botShort = botId without 0x, first 12 hex chars)
   ```
2. On-chain records exist:
   ```bash
   curl -s https://forum.gudman.xyz/api/bots/<botId>/records | head
   ```
3. Bot appears on the leaderboard within ~30s:
   ```bash
   curl -s https://forum.gudman.xyz/api/agents | grep -i <botId>
   ```

## Step 7 — (optional) make the bot fundable: Covenant Account

After the first receipt publishes, create a Covenant Account bound to the **same
`botId`**, so depositors can fund the bot under an enforceable mandate:

- **Easiest [HUMAN]:** at <https://forum.gudman.xyz/#/console> → Connect the bot
  wallet → **Create** tab → set the mandate (budget, max drawdown) → submit
  (calls `CovenantVaultFactory.createVault`; RiskKernelV2 + SlashBond auto-wired).
- Post a small operator **bond** in the **Vault** tab (collateral the RiskKernel
  can slash on a mandate breach).

Once a vault exists with one published receipt, anyone can deposit USDC, the
operator can `pullCredit` bounded by the mandate, and `RiskKernelV2.enforce(vault)`
will pause + slash autonomously on a breach.

## Troubleshooting

- `publish reverted` / out of gas → wallet not funded (Step 2) or key malformed (must be raw `0x`-hex).
- `verify-receipt` HTTP error → `RECEIPT_BASE_URL` isn't actually public (Step 4).
- Bot not on `/api/agents` → wait ~30s; confirm the publish tx succeeded; the indexer ingests v1 + v2 since `forum-indexer/0.6.0`.
- Python path instead of TS: `pip install forum-arc web3 eth-account`, set `FORUM_PRIVATE_KEY=0x...` (env, not a file), run `python3 adapters/template/adapter.py`.

## What "done" looks like

A distinct external wallet has published ≥1 verifiable receipt to `TrackRecordV2`,
the bot shows on the public leaderboard, and (optionally) a Covenant Account bound
to its `botId` is live and slashable. That is a real external operator on Forum.
