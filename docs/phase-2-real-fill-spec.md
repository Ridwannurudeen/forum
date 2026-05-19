# Phase 2 — Real-fill wiring spec for `adapters/poly-v2-reference`

Status: **Implemented + proven live on Polymarket V2 mainnet, 2026-05-19, post-D73.** Original spec drafted 2026-05-19 post-D57. See `docs/phase-3-live-fill-proof.md` for the actual fill data + reproducibility notes.

The current reference adapter (`adapters/poly-v2-reference/bot.ts`, 274
lines) discovers Polymarket V2 markets, reads books, picks a directional
bias each tick, and publishes a Forum receipt every N ticks. **It never
submits an order.** Line 219 hard-codes `fills: []`; line 226 hard-codes
`pnl.realizedUsdc: 0`.

This document specifies the smallest correct upgrade path that takes
those two zeros and replaces them with verifiable, on-chain-attributable
real values. The goal is to make the reference bot publish a receipt
whose `verifiedPnl` field flips from `"unverified-paper-mode"` to a
recomputable real number, and whose `verifiedFillCount` is non-zero.

Scope is deliberately narrow: one bot, one market, smallest possible
order, mainnet. No multi-market, no order-book strategy, no inventory
hedging. Those follow.

---

## Why this isn't in the hackathon submission

Polymarket has no testnet for CLOB orders — real-fill testing is mainnet
USDC. The PolyScope memory thread `polyscope-clob-poly1271-sdk-2026-05-15`
records a multi-hour debug session caused by `@polymarket/clob-client-v2`
locking the signer-vs-API-key relationship incorrectly (the
`POLY_1271 — the order signer address has to be the address of the API
KEY` error). The fix shipped in `^1.0.6`, but the failure mode is silent
until an order actually broadcasts.

Shipping real-fill wiring six days before submission, on mainnet, with
that class of trap door in the dependency, is the kind of half-baked
critical-path code that costs more points than the missing feature.
Document the plan now; execute post-hackathon with proper time to handle
the inevitable signer/builder-code edge cases.

---

## Acceptance criteria

The implementation is done when **one** receipt published by the
reference bot has all of the following, simultaneously, verifiable from
the public chain:

1. `verifiedFillCount >= 1` in `/api/agents/<botId>`
2. `verifiedPnl` is a number (positive or negative), not the literal
   string `"unverified-paper-mode"`
3. The receipt JSON's `fills[]` array contains at least one entry whose
   `txHash` resolves on `https://polygonscan.com/tx/<hash>` and whose
   `marketId` matches a real Polymarket V2 token ID
4. The fill's `builderCode` field is your Forum builder code (the same
   one configured on the Polymarket Builders Service for fee routing)
5. `keeper/scripts/verify-receipt.mjs <receipt-url>` exits 0 with the
   message `pnl: valid (recomputed)`

Anything less is not done.

---

## Concrete diff to `bot.ts`

The integration boundary is two new functions plus three new env vars.
The existing `pickDirection()` stays untouched — its output is now used
as both intent (for the receipt) and as input to a new `submitOrder()`
call.

### New env vars

| Var                          | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `POLY_API_KEY`               | CLOB API key (from `clob-client-v2` derive-API-key flow)      |
| `POLY_API_SECRET`            | CLOB API secret (paired with above)                           |
| `POLY_API_PASSPHRASE`        | CLOB API passphrase                                           |
| `POLY_BUILDER_CODE`          | `bytes32` builder code registered on Builders Service         |
| `POLY_LIVE`                  | `"true"` opt-in; default false stays paper-mode (safety)      |
| `POLY_MAX_NOTIONAL_USDC`     | Hard cap per order, e.g. `2.0` for $2 max (safety)            |

### New CLI flags

- `--live` mirrors `POLY_LIVE=true` — explicit, hard to enable by accident.
- `--max-notional` mirrors `POLY_MAX_NOTIONAL_USDC` per-invocation override.

### New code, sketched in TypeScript

```ts
import { ClobClient, Side, OrderType } from "@polymarket/clob-client-v2";

// Module-scope, created in main() after creds load.
let clob: ClobClient | undefined;

async function maybeSubmitOrder(
  decision: Decision,
  m: MarketView,
  args: ParsedArgs,
): Promise<Fill[]> {
  if (!args.live || decision.action === "HOLD" || decision.sizeUsdc === 0)
    return [];
  if (decision.sizeUsdc > args.maxNotional)
    throw new Error(
      `safety: notional ${decision.sizeUsdc} exceeds cap ${args.maxNotional}`,
    );

  // Size = USDC / midprice, in YES shares
  const sizeShares = decision.sizeUsdc / m.midprice;

  const order = await clob!.createOrder({
    tokenId: m.marketId,
    side: decision.action === "BUY" ? Side.BUY : Side.SELL,
    price: decision.action === "BUY" ? m.askPrice : m.bidPrice, // taker
    size: sizeShares,
    feeRateBps: 0,
    nonce: Date.now(),
    expiration: 0,
    taker: "0x0000000000000000000000000000000000000000",
  });

  // Attach builder code (per Polymarket Builders Service spec).
  // The exact API depends on whether builder-code lives on order metadata
  // (header) or order body (signed field). Verify against clob-client-v2
  // ^1.0.6 source at submission time — the docs lag the code.
  const submitted = await clob!.postOrder(
    order,
    OrderType.GTC,
    /* extraHeaders */ { "X-Builder-Code": args.builderCode },
  );

  // postOrder returns immediately with an orderId; fills are async.
  // Poll fill events for this order for up to 30s, then give up and
  // record the unfilled order.
  const fills = await pollFills(submitted.orderId, 30_000);
  return fills.map((f) => ({
    marketId: m.marketId,
    side: decision.action,
    sharePrice: f.price,
    shareSize: f.size,
    feeUsdc: f.fee,
    txHash: f.txHash,
    builderCode: args.builderCode,
    ts: f.ts,
  }));
}

async function pollFills(orderId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const trades = await clob!.getTrades({ orderId });
    if (trades.length > 0) return trades;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return [];
}
```

### Changes to the receipt build (current lines 212–237)

Replace:

```ts
fills: [],                                     // line 219
inventory: markets.map(...openShares: 0...),   // line 220
pnl: { realizedUsdc: 0, ... },                 // line 225
```

With the cycle-accumulated real values:

```ts
fills: cycleFills,                              // accumulated across ticks
inventory: computeInventory(markets, cycleFills, prevInventory),
pnl: computePnl(cycleFills, prevInventory, currentMidprices),
```

`computeInventory` and `computePnl` are already in `keeper/src/inventory.ts`
and `keeper/src/receipt.ts` respectively (the verifier uses them) — the
adapter just needs to feed them real inputs instead of zeros.

### Loop changes

In the main loop body (around line 165–207), call `maybeSubmitOrder()`
right after `pickDirection()`, accumulate returned fills into a
cycle-scoped `cycleFills: Fill[]` array (declared alongside the existing
`cycleBookSnapshots`), and pass it into `buildReceipt()` at publish time.

---

## Builder code attribution

The PolyScope reference (`builder_code=0x6bf23860…` in memory) shows the
working pattern: a `bytes32` builder code registered on the Polymarket
Builders Service. The bytes32 itself is public (and attaches to every
order via `X-Builder-Code` header or order body field, exact mechanism
to be confirmed against `clob-client-v2 ^1.0.6` source); the API
key/secret/passphrase that derives signing capability is private.

For the reference bot:

1. Register a fresh builder code with Builders Service (one-time).
2. Store the bytes32 in `POLY_BUILDER_CODE` env var (safe to commit
   to a public `deployments/builder-code.json` if desired — it's public
   on-chain).
3. Store API creds in `~/.forum-keys/poly-creds.json` (chmod 600, never
   committed). Bridge loads them via the same pattern as `deployer.key`.

Fee receipts then accrue to the builder-code wallet on Polymarket's side
and can be claimed periodically with a `FeeDistributor.claim()`-style
call (out of scope for the adapter — that's a separate fee-router job).

---

## Risk and cost estimate

| Item                                       | Detail                          |
| ------------------------------------------ | ------------------------------- |
| Per-test order size cap                    | $2 USDC                         |
| Expected test runs to reach acceptance     | 10–20                           |
| Worst-case loss across all tests           | ~$40 USDC                       |
| Polymarket trading fees                    | 0% taker, 0% maker (V2)         |
| Arc testnet gas for receipt publish        | ~0.0002 OG per receipt          |
| Implementation time (engineering only)     | 4–8 hours                       |
| Debug overhead (POLY_1271-class issues)    | + 2–6 hours, historically       |
| **Total elapsed time**                     | **1–2 working days**            |

Worth doing post-hackathon; not worth gambling on pre-deadline.

---

## What's deliberately out of scope

- Multi-market simultaneous orders. One market, one order, one fill at a
  time until the verified pipeline works end-to-end.
- Order book depth strategy. Keep `pickDirection()` toy until real fills
  flow.
- Inventory hedging or risk limits beyond `--max-notional`.
- Automatic fee claiming. That's a separate keeper/cron job.
- Real-fill mode for the bare `adapters/template/` scaffolds — those
  stay paper-only; if a third party wants real fills, they read this
  spec.

---

## Verification protocol when the wiring lands

Before opening a PR:

1. Run the bot with `--live --max-notional 2 --max-ticks 4` on a fresh
   `--label` so it produces a brand-new `botId`.
2. Capture the order tx hash from Polymarket's response.
3. Capture the receipt URI and its on-chain publish tx on Arc.
4. Verify on-chain: `verifyReceipt(<receipt-url>)` returns `pnl: valid`
   AND non-zero `fills`.
5. Verify Polymarket attribution: query Builders Service API and confirm
   the fee accrual line item matches the order's notional × your
   builder rate.
6. Capture all four hashes + URLs in the PR description as the
   acceptance proof.

If steps 1–6 all pass, the gap in `forum-agora-hackathon-2026.md` line
67 ("No real Polymarket order execution or real builder-fee capture is
proven") is closed.

---

## Follow-ups this unblocks

- `agora-mind-keeper.mjs` (the live keeper) can copy this pattern to
  upgrade from paper to real fills with the same env-var protocol.
- `CovenantVaultV1.2` becomes meaningfully underwritable: a real-fill
  bot's slash bond becomes a real exposure for depositors, not a
  thought experiment.
- One real adapter run is the hook for outreach to outside operators
  ("here's a $2 mainnet receipt with verified attribution — fork this
  in an afternoon").
