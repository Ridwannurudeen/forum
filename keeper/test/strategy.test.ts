import { describe, it, expect } from "vitest";
import {
  asQuotes,
  VarianceEstimator,
  imbalanceFairValue,
  DEFAULT_AS_CONFIG,
} from "../src/strategy.js";

describe("asQuotes (Avellaneda-Stoikov)", () => {
  it("produces bid<ask both inside (0,1) for a sane midprice", () => {
    const q = asQuotes(0.5, 0, 0.0001, 60, DEFAULT_AS_CONFIG);
    expect(q.bid).not.toBeNull();
    expect(q.ask).not.toBeNull();
    expect(q.bid!.price).toBeGreaterThan(0);
    expect(q.ask!.price).toBeLessThan(1);
    expect(q.bid!.price).toBeLessThan(q.ask!.price);
  });

  it("clamps half-spread to [minHalfSpread, maxHalfSpread]", () => {
    // Zero variance + zero time-to-resolution → adverse-selection component only.
    const q = asQuotes(0.5, 0, 0, 1, DEFAULT_AS_CONFIG);
    expect(q.halfSpread).toBeGreaterThanOrEqual(
      DEFAULT_AS_CONFIG.minHalfSpread,
    );
    expect(q.halfSpread).toBeLessThanOrEqual(DEFAULT_AS_CONFIG.maxHalfSpread);
  });

  it("skews reservation price downward when long inventory", () => {
    const flat = asQuotes(0.5, 0, 0.0001, 60, DEFAULT_AS_CONFIG);
    const long = asQuotes(0.5, +10, 0.0001, 60, DEFAULT_AS_CONFIG);
    expect(long.reservationPrice).toBeLessThan(flat.reservationPrice);
  });

  it("skews reservation price upward when short inventory", () => {
    const flat = asQuotes(0.5, 0, 0.0001, 60, DEFAULT_AS_CONFIG);
    const short = asQuotes(0.5, -10, 0.0001, 60, DEFAULT_AS_CONFIG);
    expect(short.reservationPrice).toBeGreaterThan(flat.reservationPrice);
  });

  it("goes one-sided (no bid) at +maxInventory", () => {
    const q = asQuotes(
      0.5,
      DEFAULT_AS_CONFIG.maxInventory,
      0.0001,
      60,
      DEFAULT_AS_CONFIG,
    );
    expect(q.bid).toBeNull();
    expect(q.ask).not.toBeNull();
  });

  it("goes one-sided (no ask) at -maxInventory", () => {
    const q = asQuotes(
      0.5,
      -DEFAULT_AS_CONFIG.maxInventory,
      0.0001,
      60,
      DEFAULT_AS_CONFIG,
    );
    expect(q.bid).not.toBeNull();
    expect(q.ask).toBeNull();
  });

  it("returns no quotes for out-of-domain midprice", () => {
    const q = asQuotes(0, 0, 0.0001, 60, DEFAULT_AS_CONFIG);
    expect(q.bid).toBeNull();
    expect(q.ask).toBeNull();
  });
});

describe("VarianceEstimator", () => {
  it("converges to ~0 variance on a stationary series", () => {
    const v = new VarianceEstimator(20);
    for (let i = 0; i < 300; i++) v.update(0.5);
    expect(v.value).toBeLessThan(1e-6);
  });

  it("rises on a volatile series", () => {
    const v = new VarianceEstimator(20);
    for (let i = 0; i < 300; i++) v.update(0.5 + (Math.random() - 0.5) * 0.1);
    expect(v.value).toBeGreaterThan(0);
  });

  it("reset() clears state", () => {
    const v = new VarianceEstimator(10);
    for (let i = 0; i < 20; i++) v.update(0.3 + i * 0.005);
    expect(v.value).toBeGreaterThan(0);
    v.reset();
    expect(v.value).toBe(0);
  });
});

describe("imbalanceFairValue", () => {
  it("shifts midprice up when bid depth > ask depth", () => {
    const fv = imbalanceFairValue(0.5, 100, 50, 0.01, 0.3);
    expect(fv).toBeGreaterThan(0.5);
  });

  it("shifts midprice down when ask depth > bid depth", () => {
    const fv = imbalanceFairValue(0.5, 50, 100, 0.01, 0.3);
    expect(fv).toBeLessThan(0.5);
  });

  it("returns midprice when both sides equal", () => {
    const fv = imbalanceFairValue(0.5, 100, 100, 0.01, 0.3);
    expect(fv).toBeCloseTo(0.5, 8);
  });

  it("returns midprice when total depth is zero", () => {
    const fv = imbalanceFairValue(0.5, 0, 0, 0.01, 0.3);
    expect(fv).toBe(0.5);
  });
});
