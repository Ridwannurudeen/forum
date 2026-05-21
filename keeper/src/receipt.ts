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
  /** Market/token id this fill belongs to. Required for multi-market receipts. */
  marketId?: string;
  ts: number;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  mode: "paper" | "live";
  /** Maker reward credited by the venue for this fill, in USDC. */
  makerRebateUsdc?: number;
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
  inventory: {
    marketId: string;
    openShares: number;
    /** Weighted-average opening cost. Required when openShares is non-zero. */
    openAvgPx?: number;
    closeShares: number;
  }[];
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
  /** Optional cross-chain provenance — when the capital that funded this
   *  cycle's fills originated on another chain via CCTP V2 (Phase 7), the
   *  adapter can attach the bridging-tx coordinates here so the receipt
   *  graph remains auditable end-to-end across chains. All three fields are
   *  required when present so partial data can't claim a bridge happened.
   *  Backward-compatible: existing v1 receipts simply omit the field. */
  sourceChain?: {
    /** CCTP V2 domain id of the source chain (e.g. 0 ETH, 6 Base, 7 Polygon, 26 Arc). */
    domain: number;
    /** keccak256 of the CCTP V2 Message bytes that crossed the bridge. */
    messageHash: Hex;
    /** Source-chain tx hash of the depositForBurnWithHook call. */
    txHash: Hex;
  };
  /** Realized yield from vault-custodied strategy round trips (CovenantVaultV2
   *  deployToStrategy -> recallFromStrategy). Each leg's realized PnL is
   *  `recoveredMicros - deployedMicros`; the sum is added to totalUsdcMicros.
   *  Kept separate from `pnl.realizedUsdc` (trading) so the two sources don't
   *  conflate. Optional + backward-compatible. When `recallTx` is present the
   *  leg is independently recomputable on-chain from the RecalledFromStrategy
   *  event (see strategy-onchain.ts). */
  strategyLegs?: StrategyLeg[];
  /** UTC timestamp the receipt was produced. */
  generatedAt: number;
}

/** A vault-custodied strategy round trip, in micro-USDC. */
export interface StrategyLeg {
  /** The strategy adapter the vault deployed into. */
  adapter: Hex;
  deployedMicros: number;
  recoveredMicros: number;
  /** Optional on-chain references for independent recomputation. */
  deployTx?: Hex;
  recallTx?: Hex;
}

/** Sum of realized yield across strategy legs, in micro-USDC (can be negative). */
export function strategyRealizedMicros(
  legs: StrategyLeg[] | undefined,
): number {
  if (!legs) return 0;
  let sum = 0;
  for (const l of legs) sum += l.recoveredMicros - l.deployedMicros;
  return sum;
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
  inventory: {
    marketId: string;
    openShares: number;
    openAvgPx?: number;
    closeShares: number;
  }[];
  pnl: {
    realizedUsdc: number;
    unrealizedUsdc: number;
    makerRebatesUsdc: number;
    totalUsdcMicros: number;
    formulaVersion: string;
  };
  sourceChain?: {
    domain: number;
    messageHash: Hex;
    txHash: Hex;
  };
  strategy: {
    name: string;
    configHash: Hex;
    codeHash?: Hex;
  };
  decisionTrace?: { traceUri: string; traceHash: Hex };
  strategyLegs?: StrategyLeg[];
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
    ...(input.sourceChain ? { sourceChain: input.sourceChain } : {}),
    ...(input.strategyLegs ? { strategyLegs: input.strategyLegs } : {}),
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

interface PnlState {
  net: number;
  avgPx: number;
  realizedUsdc: number;
}

const EPSILON_USDC = 0.000001;

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON_USDC;
}

function toMicros(v: number): number {
  return Math.round(v * 1_000_000);
}

function closingMark(book: BookSnapshot): number | null {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (typeof bestBid === "number" && typeof bestAsk === "number") {
    return (bestBid + bestAsk) / 2;
  }
  if (typeof bestBid === "number") return bestBid;
  if (typeof bestAsk === "number") return bestAsk;
  return null;
}

function applyFill(state: PnlState, fill: ReceiptFill): void {
  const signed = fill.side === "BUY" ? fill.size : -fill.size;
  const prevNet = state.net;
  const newNet = prevNet + signed;

  if (prevNet === 0 || Math.sign(prevNet) === Math.sign(signed)) {
    const absPrev = Math.abs(prevNet);
    const absSigned = Math.abs(signed);
    state.avgPx =
      absPrev + absSigned > 0
        ? (state.avgPx * absPrev + fill.price * absSigned) /
          (absPrev + absSigned)
        : fill.price;
  } else {
    const closing = Math.min(Math.abs(signed), Math.abs(prevNet));
    const pnlPerShare =
      prevNet > 0 ? fill.price - state.avgPx : state.avgPx - fill.price;
    state.realizedUsdc += closing * pnlPerShare;
    if (Math.abs(signed) > Math.abs(prevNet)) state.avgPx = fill.price;
  }

  state.net = newNet;
  if (state.net === 0) state.avgPx = 0;
}

function fillMarketId(r: Receipt, fill: ReceiptFill): string | null {
  if (fill.marketId) return fill.marketId;
  if (r.inventory.length === 1) return r.inventory[0]!.marketId;
  if (r.bookSnapshots.length === 1) return r.bookSnapshots[0]!.marketId;
  return null;
}

/** Verify a previously-built receipt matches its claimed pnlMicros — i.e.,
 *  recompute realized + unrealized + rebates from fills + inventory + book
 *  snapshots and confirm the sum lines up with totalUsdcMicros.
 *
 *  Returns null if OK, or a string describing the discrepancy.
 *  This is the function a third-party verifier calls. */
export function verifyReceipt(r: Receipt): string | null {
  const expectedBooks = keccak256(toHex(canonicalize(r.bookSnapshots)));
  if (expectedBooks !== r.sourceData.booksHash) return "booksHash mismatch";
  const expectedFills = keccak256(toHex(canonicalize(r.fills)));
  if (expectedFills !== r.sourceData.fillsHash) return "fillsHash mismatch";

  // Phase 7 cross-chain linkage: if sourceChain is present, every required
  // sub-field must be present + well-formed. Don't validate the actual
  // bridging-tx provenance here (that requires a cross-chain RPC reader);
  // just refuse partial claims so a receipt can't allude to a CCTP bridge
  // it can't prove.
  if (r.sourceChain) {
    const sc = r.sourceChain;
    if (!Number.isInteger(sc.domain) || sc.domain < 0)
      return "sourceChain.domain invalid";
    if (!/^0x[0-9a-fA-F]{64}$/.test(sc.messageHash))
      return "sourceChain.messageHash malformed";
    if (!/^0x[0-9a-fA-F]{64}$/.test(sc.txHash))
      return "sourceChain.txHash malformed";
  }

  const states = new Map<string, PnlState>();
  for (const inv of r.inventory) {
    if (inv.openShares !== 0 && typeof inv.openAvgPx !== "number") {
      return `openAvgPx required for non-zero opening inventory: ${inv.marketId}`;
    }
    states.set(inv.marketId, {
      net: inv.openShares,
      avgPx: inv.openShares === 0 ? 0 : inv.openAvgPx!,
      realizedUsdc: 0,
    });
  }

  for (const fill of r.fills) {
    const marketId = fillMarketId(r, fill);
    if (!marketId) return "fill marketId required for multi-market receipt";
    let state = states.get(marketId);
    if (!state) {
      state = { net: 0, avgPx: 0, realizedUsdc: 0 };
      states.set(marketId, state);
    }
    applyFill(state, fill);
  }

  let realizedUsdc = 0;
  let unrealizedUsdc = 0;
  for (const inv of r.inventory) {
    const state = states.get(inv.marketId);
    if (!state) return `missing inventory state: ${inv.marketId}`;
    if (!closeEnough(state.net, inv.closeShares)) {
      return `inventory mismatch for ${inv.marketId}: expected ${state.net} got ${inv.closeShares}`;
    }
    realizedUsdc += state.realizedUsdc;

    if (state.net === 0) continue;
    const book = r.bookSnapshots.find((b) => b.marketId === inv.marketId);
    if (!book) return `bookSnapshot missing for ${inv.marketId}`;
    const mark = closingMark(book.end);
    if (mark === null) return `closing mark unavailable for ${inv.marketId}`;
    unrealizedUsdc += state.net * (mark - state.avgPx);
  }

  const makerRebatesUsdc = r.fills.reduce(
    (sum, f) => sum + (f.makerRebateUsdc ?? 0),
    0,
  );
  if (!closeEnough(realizedUsdc, r.pnl.realizedUsdc)) {
    return `realized pnl mismatch: expected ${realizedUsdc} got ${r.pnl.realizedUsdc}`;
  }
  if (!closeEnough(unrealizedUsdc, r.pnl.unrealizedUsdc)) {
    return `unrealized pnl mismatch: expected ${unrealizedUsdc} got ${r.pnl.unrealizedUsdc}`;
  }
  if (!closeEnough(makerRebatesUsdc, r.pnl.makerRebatesUsdc)) {
    return `maker rebate mismatch: expected ${makerRebatesUsdc} got ${r.pnl.makerRebatesUsdc}`;
  }

  // Strategy (yield) legs: validate shape, then fold realized yield
  // (recovered - deployed) into the total. Each leg is independently
  // recomputable on-chain from its recallTx (see strategy-onchain.ts).
  if (r.strategyLegs) {
    for (const leg of r.strategyLegs) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(leg.adapter))
        return "strategyLeg.adapter malformed";
      if (!Number.isFinite(leg.deployedMicros) || leg.deployedMicros < 0)
        return "strategyLeg.deployedMicros invalid";
      if (!Number.isFinite(leg.recoveredMicros) || leg.recoveredMicros < 0)
        return "strategyLeg.recoveredMicros invalid";
      if (
        leg.deployTx !== undefined &&
        !/^0x[0-9a-fA-F]{64}$/.test(leg.deployTx)
      )
        return "strategyLeg.deployTx malformed";
      if (
        leg.recallTx !== undefined &&
        !/^0x[0-9a-fA-F]{64}$/.test(leg.recallTx)
      )
        return "strategyLeg.recallTx malformed";
    }
  }

  const expectedMicros =
    toMicros(realizedUsdc + unrealizedUsdc + makerRebatesUsdc) +
    strategyRealizedMicros(r.strategyLegs);
  if (expectedMicros !== r.pnl.totalUsdcMicros) {
    return `pnl mismatch: expected ${expectedMicros} got ${r.pnl.totalUsdcMicros}`;
  }
  return null;
}
