# Phase 3 — Real-fill execution PROVEN on Polymarket V2 mainnet

Status: **complete, 2026-05-19, post-D73.** Closes the longstanding
"no real Polymarket order execution / no real builder-fee capture"
gap from `forum-agora-hackathon-2026.md` memory.

## What was done

A fresh mainnet EOA was provisioned, bound to a Polymarket POLY_1271
proxy wallet, funded with 5 USDC → 5.030910 pUSD, and used to submit
a single $2 atomic FOK BUY order on Polymarket V2's CLOB. The fill
landed on-chain; the resulting receipt was published to Arc's
`TrackRecordV2` and verified end-to-end via the public verifier.

## The proof chain

| Layer | Artifact |
| --- | --- |
| Polymarket EOA signer | `0x4f9eFA49e092E3dbA6Da3E5b24ADAEe8cDA0Bac9` |
| Polymarket POLY_1271 proxy (funder) | `0xcD6c77F267aa1745b9B57986Ad1A9C749212D1d8` |
| Forum botId on Arc | `0x75d6577d49eff276e2ada42f9ebb04ab7f74cc3fdeef072aab6c2d5e3f8a0ef0` |
| Market | TX-04 House seat (Republican) |
| Side / Type | BUY · Fill-Or-Kill · `signatureType: POLY_1271` |
| Notional | $2 pUSD |
| Fill | 2.32558 YES shares @ ~$0.86 |
| Polymarket order ID | `0xf5fd3fff…f1b0` |
| Polymarket settlement tx | `polygonscan.com/tx/0x5207a52…b80c0` |
| Forum receipt URI | `https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json` |
| Forum receipt evidenceHash | `0x8f5a197c…b187` |
| Forum publish tx on Arc | `testnet.arcscan.app/tx/0x8fbbdb97…d931` |

(Full bytes32s in the receipt JSON itself; truncated here because the
pre-commit hook blocks 64-hex literals in source files.)

## How to reproduce

Once funded + onboarded (Polymarket UI deposit, which requires a
non-blocked-region IP — Germany, US, UK etc. are blocked), the
end-to-end flow is three commands:

```bash
# 1. Bootstrap the API creds (one-shot, idempotent)
node keeper/scripts/poly-create-api-key.mjs --confirm

# 2. Live test (dry-run by default; --broadcast posts the order)
node keeper/scripts/poly-live-test-local.mjs --broadcast

# 3. Publish the resulting fill as a Forum receipt
node keeper/scripts/poly-publish-real-fill-receipt.mjs
```

The dry-run path of step 2 was rehearsed three times before the
single `--broadcast` run; the `--broadcast` run is the only one that
moved real money.

## Discoveries that surprised us

1. **Polymarket V2 collateral isn't native USDC.** It's `pUSD` (Polymarket
   USD, `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`), bridge-controlled.
   Direct ERC-20 funding doesn't get you pUSD; you have to use Polymarket's
   own deposit UI which routes USDC into the aggregator
   `0x4cD00E387622C35bDDB9b4c962C136462338BC31` and mints pUSD onto a
   newly-provisioned per-user proxy wallet.

2. **The proxy is POLY_1271 (EIP-1271), not a standard Gnosis Safe.** The
   SDK's `signatureType: 2` (`POLY_GNOSIS_SAFE`) returns balance 0; only
   `signatureType: 3` (`POLY_1271`) returns the correct balance + the pre-set
   max-uint allowance.

3. **Polymarket's API geo-blocks order submission, not auth.** From a
   blocked-country IP, `createOrDeriveApiKey()` and `getBalanceAllowance()`
   succeed, but `createAndPostMarketOrder()` returns 403. The broadcast
   has to originate from a non-blocked IP. Canada (non-Ontario) works.

4. **Polymarket V2 fee was tiny but non-zero.** Memory said 0% taker/maker;
   the actual on-chain debit was ~0.011 pUSD over the order's makingAmount
   for a $2 trade. Negligible at this scale, worth flagging in the receipt
   schema for larger trades.

5. **The deposit and the pUSD mint live in different transactions.** The
   USDC.transfer to Polymarket's aggregator and the pUSD mint to the
   user's proxy are NOT atomic — they're two separate on-chain txs in
   adjacent blocks. A naive verifier that looks for both in the same tx
   would conclude the deposit failed.

## Remaining gaps (for honest record)

- **Builder code attribution — code path wired in D75, fee capture
  still user-blocked.** `poly-live-test-local.mjs` now accepts a
  `--builder-code` flag (or `POLY_BUILDER_CODE` env var). When provided
  + well-formed (bytes32), the SDK attaches the code to
  `UserMarketOrderV2.builderCode` on every order. Polymarket Builders
  Service onboarding is still a manual approval that hasn't been
  completed — until then, the attached code captures no fees (they
  route to Polymarket's default pool). Once approved, re-run with
  `--builder-code 0x…` for the same flow to ship verified builder-fee
  attribution.
- **The indexer's `verifiedPnl` label — closed in D75.**
  `forum-indexer/0.11.0` fetches each bot's latest receipt at the
  canonical URL and counts `fills[].mode === "live"`, cached per
  `(botId, seq)`. The phase-3 bot now correctly reports
  `verifiedPnl: "recomputed-from-fills"` + `verifiedFillCount: 1`.
- **One trade is not a strategy.** Phase 3 closes "real execution proven"
  but not "real strategy backtested + live-traded". That's Phase 4 work.
