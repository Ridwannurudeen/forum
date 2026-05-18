import { describe, it, expect } from "vitest";
import { computeAgentScore, drawdownBps } from "../src/agent-score";

describe("drawdownBps", () => {
  it("returns 0 when no peak", () => {
    expect(drawdownBps(0, 0)).toBe(0);
    expect(drawdownBps(0, 100)).toBe(0);
  });
  it("returns 0 when current >= peak", () => {
    expect(drawdownBps(1000, 1000)).toBe(0);
    expect(drawdownBps(1000, 1500)).toBe(0);
  });
  it("computes proportional bps to peak", () => {
    // peak 1000, current 900 -> 10% drawdown -> 1000 bps
    expect(drawdownBps(1000, 900)).toBe(1000);
    // peak 2_000_000, current 1_900_000 -> 5%
    expect(drawdownBps(2_000_000, 1_900_000)).toBe(500);
  });
});

describe("computeAgentScore", () => {
  const base = {
    recordCount: 10,
    lastPnlMicros: 1_000_000,
    peakPnlMicros: 1_000_000,
    secondsSinceLastReceipt: 60,
    slashEventCount: 0,
    bondBalanceMicros: 0n,
  };

  it("healthy bot with bond → 110 capped to 100", () => {
    const r = computeAgentScore({ ...base, bondBalanceMicros: 1_000_000n });
    expect(r.scoreV0).toBe(100);
    expect(r.bonuses.bond).toBe(10);
    expect(r.penalties.drawdown).toBe(0);
  });

  it("healthy bot, no bond → 100", () => {
    const r = computeAgentScore(base);
    expect(r.scoreV0).toBe(100);
    expect(r.bonuses.bond).toBe(0);
  });

  it("no records → -40", () => {
    const r = computeAgentScore({ ...base, recordCount: 0 });
    expect(r.penalties.noRecords).toBe(40);
    expect(r.scoreV0).toBe(60);
  });

  it("drawdown 10% → -10 score", () => {
    const r = computeAgentScore({ ...base, lastPnlMicros: 900_000 });
    expect(r.drawdownBps).toBe(1000);
    expect(r.penalties.drawdown).toBe(10);
    expect(r.scoreV0).toBe(90);
  });

  it("drawdown 50% → capped at -40", () => {
    const r = computeAgentScore({ ...base, lastPnlMicros: 500_000 });
    expect(r.drawdownBps).toBe(5000);
    expect(r.penalties.drawdown).toBe(40);
    expect(r.scoreV0).toBe(60);
  });

  it("stale 31min → -1 (grace 30min, 60s past)", () => {
    const r = computeAgentScore({ ...base, secondsSinceLastReceipt: 1860 });
    expect(r.penalties.staleness).toBe(1);
    expect(r.scoreV0).toBe(99);
  });

  it("stale 90min → -30 cap", () => {
    const r = computeAgentScore({ ...base, secondsSinceLastReceipt: 5400 });
    expect(r.penalties.staleness).toBe(30);
    expect(r.scoreV0).toBe(70);
  });

  it("one slash event → -15", () => {
    const r = computeAgentScore({ ...base, slashEventCount: 1 });
    expect(r.penalties.slash).toBe(15);
    expect(r.scoreV0).toBe(85);
  });

  it("combined: drawdown + slash + stale + no bond → arithmetic check", () => {
    const r = computeAgentScore({
      ...base,
      lastPnlMicros: 800_000, // 20% drawdown
      slashEventCount: 2, // -30
      secondsSinceLastReceipt: 2400, // (2400-1800)/60 = 10 stale
    });
    expect(r.drawdownBps).toBe(2000);
    expect(r.penalties.drawdown).toBe(20);
    expect(r.penalties.slash).toBe(30);
    expect(r.penalties.staleness).toBe(10);
    // 100 - 0 - 20 - 30 - 10 + 0 = 40
    expect(r.scoreV0).toBe(40);
  });

  it("clamps to 0 when penalties exceed 100", () => {
    const r = computeAgentScore({
      ...base,
      recordCount: 0, // -40
      lastPnlMicros: 0, // 100% drawdown -> -40 capped
      slashEventCount: 5, // -75
      secondsSinceLastReceipt: 99_999, // -30 cap
    });
    expect(r.scoreV0).toBe(0);
  });

  it("custom freshnessGraceSec override", () => {
    const r = computeAgentScore({
      ...base,
      secondsSinceLastReceipt: 700,
      freshnessGraceSec: 600,
    });
    // (700 - 600) / 60 = 1
    expect(r.penalties.staleness).toBe(1);
  });

  it("string bondBalanceMicros (JSON-decoded BigInt round-trip) still triggers bonus", () => {
    const r = computeAgentScore({ ...base, bondBalanceMicros: "3750000" });
    expect(r.bonuses.bond).toBe(10);
  });
});
