import { describe, it, expect } from "vitest";
import { keccak256, toHex, type Hex } from "viem";
import {
  buildReceipt,
  verifyReceipt,
  strategyRealizedMicros,
  type BuildReceiptInput,
  type StrategyLeg,
} from "../src/receipt.js";
import { decodeRecalls } from "../src/strategy-onchain.js";

const ADAPTER = "0xa47f32dfdfc199a2df34d96029273ca0e2c7d343" as Hex;

function yieldReceipt(legs: StrategyLeg[], totalMicros: number) {
  const input: BuildReceiptInput = {
    botId: keccak256(toHex("yield-bot")),
    seq: 1,
    periodStart: 1000,
    periodEnd: 2000,
    markets: ["usyc-treasury"],
    bookSnapshots: [],
    fills: [],
    inventory: [],
    pnl: {
      realizedUsdc: 0,
      unrealizedUsdc: 0,
      makerRebatesUsdc: 0,
      totalUsdcMicros: totalMicros,
      formulaVersion: "v1",
    },
    strategy: { name: "yield-agent-v1", configHash: keccak256(toHex("cfg")) },
    strategyLegs: legs,
  };
  return buildReceipt(input);
}

describe("strategyRealizedMicros", () => {
  it("sums recovered minus deployed across legs", () => {
    expect(
      strategyRealizedMicros([
        {
          adapter: ADAPTER,
          deployedMicros: 1_000_000,
          recoveredMicros: 1_050_000,
        },
        { adapter: ADAPTER, deployedMicros: 500_000, recoveredMicros: 480_000 },
      ]),
    ).toBe(30_000); // +50k - 20k
  });
  it("is 0 for undefined legs", () => {
    expect(strategyRealizedMicros(undefined)).toBe(0);
  });
});

describe("verifyReceipt with strategy legs", () => {
  it("accepts a yield receipt whose total equals the realized yield", () => {
    const r = yieldReceipt(
      [
        {
          adapter: ADAPTER,
          deployedMicros: 1_000_000,
          recoveredMicros: 1_050_000,
        },
      ],
      50_000,
    );
    expect(verifyReceipt(r)).toBeNull();
  });
  it("rejects when total omits the strategy yield", () => {
    const r = yieldReceipt(
      [
        {
          adapter: ADAPTER,
          deployedMicros: 1_000_000,
          recoveredMicros: 1_050_000,
        },
      ],
      0, // should be 50_000
    );
    expect(verifyReceipt(r)).toMatch(/pnl mismatch/);
  });
  it("handles a realized loss (recovered < deployed)", () => {
    const r = yieldReceipt(
      [
        {
          adapter: ADAPTER,
          deployedMicros: 1_000_000,
          recoveredMicros: 990_000,
        },
      ],
      -10_000,
    );
    expect(verifyReceipt(r)).toBeNull();
  });
  it("rejects a malformed adapter", () => {
    const r = yieldReceipt(
      [
        {
          adapter: "0xnotanaddress" as Hex,
          deployedMicros: 1,
          recoveredMicros: 1,
        },
      ],
      0,
    );
    expect(verifyReceipt(r)).toMatch(/adapter malformed/);
  });
  it("rejects negative deployed", () => {
    const r = yieldReceipt(
      [{ adapter: ADAPTER, deployedMicros: -1, recoveredMicros: 0 }],
      1,
    );
    expect(verifyReceipt(r)).toMatch(/deployedMicros invalid/);
  });
  it("is backward-compatible: a receipt with no legs still verifies", () => {
    const input: BuildReceiptInput = {
      botId: keccak256(toHex("b")),
      seq: 1,
      periodStart: 1,
      periodEnd: 2,
      markets: [],
      bookSnapshots: [],
      fills: [],
      inventory: [],
      pnl: {
        realizedUsdc: 0,
        unrealizedUsdc: 0,
        makerRebatesUsdc: 0,
        totalUsdcMicros: 0,
        formulaVersion: "v1",
      },
      strategy: { name: "x", configHash: keccak256(toHex("c")) },
    };
    const r = buildReceipt(input);
    expect(r.strategyLegs).toBeUndefined();
    expect(verifyReceipt(r)).toBeNull();
  });
});

describe("decodeRecalls", () => {
  it("returns empty for logs without the event", () => {
    expect(
      decodeRecalls([{ topics: [keccak256(toHex("Other()"))], data: "0x" }]),
    ).toEqual([]);
  });
});
