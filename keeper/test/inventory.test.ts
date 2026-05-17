import { describe, it, expect } from "vitest";
import { InventoryTracker, type Fill } from "../src/inventory.js";

function fill(side: "BUY" | "SELL", price: number, size: number, ts = 0): Fill {
  return { side, price, size, ts };
}

describe("InventoryTracker", () => {
  it("starts flat", () => {
    const i = new InventoryTracker();
    const s = i.snapshot();
    expect(s.net).toBe(0);
    expect(s.avgPx).toBe(0);
    expect(s.realizedUsdc).toBe(0);
    expect(s.fills).toBe(0);
  });

  it("records a single BUY as long position", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 5));
    const s = i.snapshot();
    expect(s.net).toBe(5);
    expect(s.avgPx).toBeCloseTo(0.4, 8);
    expect(s.fills).toBe(1);
  });

  it("weighted-average cost on additive buys", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 10));
    i.apply(fill("BUY", 0.5, 10));
    expect(i.snapshot().avgPx).toBeCloseTo(0.45, 8);
    expect(i.snapshot().net).toBe(20);
  });

  it("realizes PnL on a closing sell", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 10));
    i.apply(fill("SELL", 0.5, 10)); // closes the long for +1.0 USDC
    expect(i.snapshot().net).toBe(0);
    expect(i.snapshot().realizedUsdc).toBeCloseTo(1.0, 8);
    expect(i.snapshot().avgPx).toBe(0);
  });

  it("partial close leaves remainder at original avgPx", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 10));
    i.apply(fill("SELL", 0.5, 6)); // sells 6 of 10
    const s = i.snapshot();
    expect(s.net).toBeCloseTo(4, 8);
    expect(s.avgPx).toBeCloseTo(0.4, 8); // remainder retains entry price
    expect(s.realizedUsdc).toBeCloseTo(0.6, 8); // 6 shares * (0.5 - 0.4)
  });

  it("flips position with PnL on the closed portion", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 5));
    i.apply(fill("SELL", 0.5, 8)); // closes 5 long, opens 3 short at 0.5
    const s = i.snapshot();
    expect(s.net).toBeCloseTo(-3, 8);
    expect(s.avgPx).toBeCloseTo(0.5, 8);
    expect(s.realizedUsdc).toBeCloseTo(0.5, 8); // 5 shares * (0.5 - 0.4)
  });

  it("marks long position unrealized correctly", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 10));
    expect(i.unrealizedAt(0.45)).toBeCloseTo(0.5, 8);
    expect(i.unrealizedAt(0.35)).toBeCloseTo(-0.5, 8);
  });

  it("marks short position unrealized correctly", () => {
    const i = new InventoryTracker();
    i.apply(fill("SELL", 0.6, 10));
    expect(i.unrealizedAt(0.5)).toBeCloseTo(1.0, 8); // shorted at 0.6, mark 0.5 → +1
    expect(i.unrealizedAt(0.7)).toBeCloseTo(-1.0, 8);
  });

  it("totalPnl = realized + unrealized", () => {
    const i = new InventoryTracker();
    i.apply(fill("BUY", 0.4, 10));
    i.apply(fill("SELL", 0.5, 4)); // realize +0.4
    expect(i.totalPnlAt(0.55)).toBeCloseTo(0.4 + 6 * (0.55 - 0.4), 8);
  });
});
