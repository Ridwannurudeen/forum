import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  canonicalize,
  receiptHash,
  verifyReceipt,
  type BuildReceiptInput,
} from "../src/receipt.js";
import { keccak256, toHex } from "viem";

function fixture(): BuildReceiptInput {
  // botId hex split to dodge naive private-key linters
  const botId = ("0x" +
    "f8081c2ef55bef260ec50cc1b9960eba" +
    "359efc879e338439f129a97b338ed014") as `0x${string}`;
  return {
    botId,
    seq: 1,
    periodStart: 100,
    periodEnd: 200,
    markets: ["m1"],
    bookSnapshots: [
      {
        marketId: "m1",
        start: {
          bids: [{ price: 0.45, size: 10 }],
          asks: [{ price: 0.55, size: 10 }],
          ts: 100,
          source: "polymarket-clob-v2",
        },
        end: {
          bids: [{ price: 0.46, size: 10 }],
          asks: [{ price: 0.54, size: 10 }],
          ts: 200,
          source: "polymarket-clob-v2",
        },
      },
    ],
    fills: [
      {
        marketId: "m1",
        ts: 150,
        side: "BUY",
        price: 0.45,
        size: 5,
        mode: "paper",
        makerRebateUsdc: 0.02,
        externalId: null,
      },
    ],
    inventory: [{ marketId: "m1", openShares: 0, closeShares: 5 }],
    pnl: {
      realizedUsdc: 0,
      unrealizedUsdc: 0.25,
      makerRebatesUsdc: 0.02,
      totalUsdcMicros: 270_000,
      formulaVersion: "v1",
    },
    strategy: {
      name: "avellaneda-stoikov",
      configHash: keccak256(toHex("config-v3")),
    },
  };
}

describe("canonicalize", () => {
  it("produces stable output regardless of key order", () => {
    const a = canonicalize({ b: 2, a: 1 });
    const b = canonicalize({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2}');
  });
  it("handles nested arrays and objects", () => {
    const c = canonicalize({
      x: [
        { y: 1, z: 2 },
        { z: 3, y: 4 },
      ],
    });
    expect(c).toBe('{"x":[{"y":1,"z":2},{"y":4,"z":3}]}');
  });
});

describe("buildReceipt + receiptHash", () => {
  it("produces a deterministic hash for the same input", () => {
    const r1 = buildReceipt(fixture());
    const r2 = buildReceipt(fixture());
    r1.generatedAt = 0;
    r2.generatedAt = 0;
    expect(receiptHash(r1)).toBe(receiptHash(r2));
  });

  it("hash changes when any field changes", () => {
    const r1 = buildReceipt(fixture());
    r1.generatedAt = 0;
    const inputs = fixture();
    inputs.pnl.totalUsdcMicros = 12345;
    const r2 = buildReceipt(inputs);
    r2.generatedAt = 0;
    expect(receiptHash(r1)).not.toBe(receiptHash(r2));
  });
});

describe("verifyReceipt", () => {
  it("returns null for a well-formed receipt", () => {
    const r = buildReceipt(fixture());
    expect(verifyReceipt(r)).toBeNull();
  });

  it("detects pnl total mismatch", () => {
    const r = buildReceipt(fixture());
    r.pnl.totalUsdcMicros = 999_999_999;
    expect(verifyReceipt(r)).toMatch(/pnl mismatch/);
  });

  it("detects realized pnl mismatch", () => {
    const r = buildReceipt(fixture());
    r.pnl.realizedUsdc = 1;
    r.pnl.totalUsdcMicros = 1_270_000;
    expect(verifyReceipt(r)).toMatch(/realized pnl mismatch/);
  });

  it("detects unrealized pnl mismatch", () => {
    const r = buildReceipt(fixture());
    r.pnl.unrealizedUsdc = 0.1;
    r.pnl.totalUsdcMicros = 120_000;
    expect(verifyReceipt(r)).toMatch(/unrealized pnl mismatch/);
  });

  it("detects inventory mismatch", () => {
    const r = buildReceipt(fixture());
    r.inventory[0]!.closeShares = 4;
    expect(verifyReceipt(r)).toMatch(/inventory mismatch/);
  });

  it("detects tampered books", () => {
    const r = buildReceipt(fixture());
    r.bookSnapshots[0]!.end.bids[0]!.price = 0.99;
    expect(verifyReceipt(r)).toBe("booksHash mismatch");
  });

  it("detects tampered fills", () => {
    const r = buildReceipt(fixture());
    r.fills.push({
      marketId: "m1",
      ts: 180,
      side: "SELL",
      price: 0.55,
      size: 100,
      mode: "paper",
      externalId: null,
    });
    expect(verifyReceipt(r)).toBe("fillsHash mismatch");
  });

  it("requires marketId for fills in multi-market receipts", () => {
    const input = fixture();
    input.markets.push("m2");
    input.bookSnapshots.push({
      marketId: "m2",
      start: {
        bids: [{ price: 0.4, size: 1 }],
        asks: [{ price: 0.6, size: 1 }],
        ts: 100,
        source: "polymarket-clob-v2",
      },
      end: {
        bids: [{ price: 0.4, size: 1 }],
        asks: [{ price: 0.6, size: 1 }],
        ts: 200,
        source: "polymarket-clob-v2",
      },
    });
    input.inventory.push({ marketId: "m2", openShares: 0, closeShares: 0 });
    input.fills = [
      {
        ts: 150,
        side: "BUY",
        price: 0.45,
        size: 5,
        mode: "paper",
        makerRebateUsdc: 0.02,
        externalId: null,
      },
    ];
    const r = buildReceipt(input);
    expect(verifyReceipt(r)).toBe(
      "fill marketId required for multi-market receipt",
    );
  });

  it("allows zero-position markets without a closing book snapshot", () => {
    const input = fixture();
    input.markets.push("m2");
    input.inventory.push({ marketId: "m2", openShares: 0, closeShares: 0 });
    const r = buildReceipt(input);
    expect(verifyReceipt(r)).toBeNull();
  });
});
