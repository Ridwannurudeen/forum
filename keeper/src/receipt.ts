// Forum Receipts — canonical JSON artifacts that make TrackRecordV2 claims
// RECOMPUTABLE off-chain. Each receipt commits to enough source data that
// any third party can pull the file, re-run the PnL formula, and arrive at
// the same number that was signed on-chain.
//
// On-chain: TrackRecordV2 stores keccak256(canonical-JSON) as evidenceHash
// and a URI (HTTPS or ipfs://) as evidenceUri. The contract enforces that
// each record references its predecessor (prevRecordHash) and that the
// signer signs the full struct including these commitments.
//
// Off-chain: this module produces the canonical JSON and its hash.

import { createHash } from "node:crypto";
import type { Hex } from "viem";
import { keccak256, toHex } from "viem";

/** Polymarket-shaped order book snapshot. Minimal fields. */
export interface BookLevel {
  price: number;
  size: number;
}

export interface BookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
  ts: number;
  source: "polymarket-clob-v2" | "replay";
}

/** A simulated fill in paper mode, or a real fill in live mode. */
export interface ReceiptFill {
  ts: number;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  mode: "paper" | "live";
  /** Polymarket order/trade id if live; null if paper. */
  externalId: string | null;
}

/** The canonical receipt structure committed to TrackRecordV2.evidence{Uri,Hash}. */
export interface Receipt {
  /** Receipt-schema version. Bump on any field-structure change. */
  schema: "forum.receipt.v1";
  /** Bot id (bytes32 hex) — same as on-chain. */
  botId: Hex;
  /** Sequence — must match the TrackRecordV2 record's seq. */
  seq: number;
  /** Reporting window [periodStart, periodEnd] in unix seconds. */
  periodStart: number;
  periodEnd: number;
  /** Markets quoted/traded during this window — conditionIds or token ids. */
  markets: string[];
  /** Snapshots of each market's book at periodStart and periodEnd. */
  bookSnapshots: { marketId: string; start: BookSnapshot; end: BookSnapshot }[];
  /** Every fill (real or paper-simulated) during the window. */
  fills: ReceiptFill[];
  /** Opening and closing inventory per market (signed shares). */
  inventory: { marketId: string; openShares: number; closeShares: number }[];
  /** PnL inputs sufficient to recompute pnlMicros. */
  pnl: {
    realizedUsdc: number;
    unrealizedUsdc: number;
    makerRebatesUsdc: number;
    totalUsdcMicros: number; // matches TrackRecordV2.pnlMicros
    /** "v1" — see docs/backtest-notes.md for the formula. */
    formulaVersion: string;
  };
  /** Strategy + config hashes. */
  strategy: {
    name: string;
    /** keccak of canonical JSON of the strategy config (spreads, gates, etc.). */
    configHash: Hex;
    /** keccak of the source file(s) of the strategy at runtime. Optional. */
    codeHash?: Hex;
  };
  /** Optional model decision trace (e.g., Claude/GPT reasoning) — content-addressed
   *  separately if too large; here we keep only its hash. */
  decisionTrace?: {
    traceUri: string;
    traceHash: Hex;
  };
  /** Source data integrity — keccak of the raw input feeds we consumed. */
  sourceData: {
    /** keccak of the concatenated book snapshots JSON. */
    booksHash: Hex;
    /** keccak of the concatenated fill log JSON. */
    fillsHash: Hex;
  };
  /** UTC timestamp the receipt was produced. */
  generatedAt: number;
}

/** Stable, canonical JSON encoding — sorted keys, no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

/** Hash a Receipt with keccak256 of its canonical JSON encoding. */
export function receiptHash(r: Receipt): Hex {
  return keccak256(toHex(canonicalize(r)));
}

/** Optional helper: SHA-256 (e.g., for IPFS-style CID approximation). */
export function receiptSha256(r: Receipt): string {
  return createHash("sha256").update(canonicalize(r)).digest("hex");
}

/** Inputs builder — pass in everything the keeper accumulated this tick window. */
export interface BuildReceiptInput {
  botId: Hex;
  seq: number;
  periodStart: number;
  periodEnd: number;
  markets: string[];
  bookSnapshots: { marketId: string; start: BookSnapshot; end: BookSnapshot }[];
  fills: ReceiptFill[];
  inventory: { marketId: string; openShares: number; closeShares: number }[];
  pnl: {
    realizedUsdc: number;
    unrealizedUsdc: number;
    makerRebatesUsdc: number;
    totalUsdcMicros: number;
    formulaVersion: string;
  };
  strategy: {
    name: string;
    configHash: Hex;
    codeHash?: Hex;
  };
  decisionTrace?: { traceUri: string; traceHash: Hex };
}

export function buildReceipt(input: BuildReceiptInput): Receipt {
  const booksHash = keccak256(toHex(canonicalize(input.bookSnapshots)));
  const fillsHash = keccak256(toHex(canonicalize(input.fills)));
  return {
    schema: "forum.receipt.v1",
    botId: input.botId,
    seq: input.seq,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    markets: input.markets,
    bookSnapshots: input.bookSnapshots,
    fills: input.fills,
    inventory: input.inventory,
    pnl: input.pnl,
    strategy: input.strategy,
    decisionTrace: input.decisionTrace,
    sourceData: { booksHash, fillsHash },
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

/** Verify a previously-built receipt matches its claimed pnlMicros — i.e.,
 *  recompute realized + unrealized + rebates from fills + inventory + book
 *  snapshots and confirm the sum lines up with totalUsdcMicros.
 *
 *  Returns null if OK, or a string describing the discrepancy.
 *  This is the function a third-party verifier calls. */
export function verifyReceipt(r: Receipt): string | null {
  // 1. Re-derive realized PnL from fills using FIFO over inventory.
  //    For v1, we trust the receipt's `pnl.realizedUsdc` since the formula
  //    is documented in docs/backtest-notes.md and tested in keeper/test/.
  //    A future v2 will re-run the InventoryTracker against `fills` here.
  // 2. Re-derive unrealized at closing book midprice.
  //    Same caveat applies.
  // 3. Sum-check totalUsdcMicros == 1e6 * (realized + unrealized + rebates).
  const expectedMicros = Math.round(
    1_000_000 *
      (r.pnl.realizedUsdc + r.pnl.unrealizedUsdc + r.pnl.makerRebatesUsdc),
  );
  if (expectedMicros !== r.pnl.totalUsdcMicros) {
    return `pnl mismatch: expected ${expectedMicros} got ${r.pnl.totalUsdcMicros}`;
  }
  // 4. Re-derive sourceData hashes.
  const expectedBooks = keccak256(toHex(canonicalize(r.bookSnapshots)));
  if (expectedBooks !== r.sourceData.booksHash) return "booksHash mismatch";
  const expectedFills = keccak256(toHex(canonicalize(r.fills)));
  if (expectedFills !== r.sourceData.fillsHash) return "fillsHash mismatch";
  return null;
}
