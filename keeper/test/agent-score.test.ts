import { describe, it, expect } from "vitest";
import {
  computeAgentScore,
  computeAgentScoreV1,
  drawdownBps,
  perVaultBondBonus,
  riskAdjustedScore,
  sharpeLike,
  streakBonus,
} from "../src/agent-score";

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
    expect(drawdownBps(1000, 900)).toBe(1000);
    expect(drawdownBps(2_000_000, 1_900_000)).toBe(500);
  });
});

describe("computeAgentScore (v0)", () => {
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
  });

  it("healthy bot, no bond → 100", () => {
    const r = computeAgentScore(base);
    expect(r.scoreV0).toBe(100);
    expect(r.bonuses.bond).toBe(0);
  });

  it("no records → -40", () => {
    const r = computeAgentScore({ ...base, recordCount: 0 });
    expect(r.scoreV0).toBe(60);
  });

  it("drawdown 10% → -10", () => {
    const r = computeAgentScore({ ...base, lastPnlMicros: 900_000 });
    expect(r.drawdownBps).toBe(1000);
    expect(r.scoreV0).toBe(90);
  });

  it("drawdown 50% → capped at -40", () => {
    const r = computeAgentScore({ ...base, lastPnlMicros: 500_000 });
    expect(r.scoreV0).toBe(60);
  });

  it("stale 31min → -1", () => {
    const r = computeAgentScore({ ...base, secondsSinceLastReceipt: 1860 });
    expect(r.scoreV0).toBe(99);
  });

  it("stale 90min → -30 cap", () => {
    const r = computeAgentScore({ ...base, secondsSinceLastReceipt: 5400 });
    expect(r.scoreV0).toBe(70);
  });

  it("one slash → -15", () => {
    const r = computeAgentScore({ ...base, slashEventCount: 1 });
    expect(r.scoreV0).toBe(85);
  });

  it("combined arithmetic check", () => {
    const r = computeAgentScore({
      ...base,
      lastPnlMicros: 800_000,
      slashEventCount: 2,
      secondsSinceLastReceipt: 2400,
    });
    expect(r.scoreV0).toBe(40);
  });

  it("clamps to 0 when penalties exceed 100", () => {
    const r = computeAgentScore({
      ...base,
      recordCount: 0,
      lastPnlMicros: 0,
      slashEventCount: 5,
      secondsSinceLastReceipt: 99_999,
    });
    expect(r.scoreV0).toBe(0);
  });

  it("custom freshnessGraceSec override", () => {
    const r = computeAgentScore({
      ...base,
      secondsSinceLastReceipt: 700,
      freshnessGraceSec: 600,
    });
    expect(r.scoreV0).toBe(99);
  });

  it("string bondBalanceMicros still triggers bonus", () => {
    const r = computeAgentScore({ ...base, bondBalanceMicros: "3750000" });
    expect(r.bonuses.bond).toBe(10);
  });
});

describe("sharpeLike", () => {
  it("returns null when <3 records", () => {
    expect(sharpeLike([])).toBeNull();
    expect(sharpeLike([1])).toBeNull();
    expect(sharpeLike([1, 2])).toBeNull();
  });
  it("returns 0 when constant returns (std = 0)", () => {
    expect(sharpeLike([100, 110, 120, 130])).toBe(0); // every return = +10
  });
  it("positive for monotonic positive with variation", () => {
    const s = sharpeLike([0, 10, 5, 20, 15]);
    expect(s).not.toBeNull();
    expect(s).toBeGreaterThan(0);
  });
  it("negative when net negative drift", () => {
    const s = sharpeLike([100, 90, 80, 75]);
    expect(s).toBeLessThan(0);
  });
});

describe("streakBonus", () => {
  it("0 for zero / negative", () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(-5)).toBe(0);
  });
  it("scales 0.3 per streak unit, saturates at 15", () => {
    expect(streakBonus(10)).toBe(3); // 10 * 0.3 = 3
    expect(streakBonus(50)).toBe(15); // saturated
    expect(streakBonus(100)).toBe(15);
  });
});

describe("riskAdjustedScore", () => {
  it("0 when sharpe null", () => {
    expect(riskAdjustedScore(null)).toBe(0);
  });
  it("multiplies sharpe by 5, bounded [-15, +15]", () => {
    expect(riskAdjustedScore(1.5)).toBe(8); // round(7.5)
    expect(riskAdjustedScore(5)).toBe(15); // capped
    expect(riskAdjustedScore(-5)).toBe(-15); // floored
    expect(riskAdjustedScore(-0.4)).toBe(-2);
  });
});

describe("perVaultBondBonus", () => {
  it("0 when no bonds", () => {
    expect(perVaultBondBonus([], false)).toBe(0);
    expect(perVaultBondBonus(undefined, false)).toBe(0);
  });
  it("0 when all bonds empty", () => {
    expect(perVaultBondBonus([0n, 0n], false)).toBe(0);
  });
  it("5 when total < 1 USDC", () => {
    expect(perVaultBondBonus([500_000n], false)).toBe(5);
  });
  it("10 when total >= 1 USDC but no slash history", () => {
    expect(perVaultBondBonus([1_000_000n, 2_000_000n], false)).toBe(10);
  });
  it("15 when total >= 10 USDC AND enforcement has fired", () => {
    expect(perVaultBondBonus([5_000_000n, 5_000_000n], true)).toBe(15);
  });
  it("10 when total >= 10 USDC but never slashed (no proof)", () => {
    expect(perVaultBondBonus([10_000_000n], false)).toBe(10);
  });
});

describe("computeAgentScoreV1", () => {
  const base = {
    recordCount: 10,
    lastPnlMicros: 1_000_000,
    peakPnlMicros: 1_000_000,
    secondsSinceLastReceipt: 60,
    slashEventCount: 0,
    bondBalanceMicros: 0n,
  };

  it("v1 with nothing extra equals v0 (no streak / no recents / no per-vault)", () => {
    const r = computeAgentScoreV1(base);
    expect(r.scoreV1).toBe(r.scoreV0);
    expect(r.v1Adjustments.streakBonus).toBe(0);
    expect(r.v1Adjustments.riskAdjusted).toBe(0);
    expect(r.v1Adjustments.perVaultBondBonus).toBe(0);
  });

  it("v1 with healthy streak adds bonus", () => {
    const r = computeAgentScoreV1({ ...base, longestStreak: 50 });
    expect(r.v1Adjustments.streakBonus).toBe(15);
    expect(r.scoreV1).toBe(100); // 100 + 15 - 0 = 115 capped
  });

  it("v1 replaces v0 bond bonus with per-vault granular bonus", () => {
    // bot has bondBalanceMicros = 1M => v0 +10. But linked-vault bonds total 0 => v1 perVault = 0.
    // So v1 net = -10 from v0.
    const r = computeAgentScoreV1({
      ...base,
      bondBalanceMicros: 1_000_000n,
      bondBalancesMicros: [0n],
    });
    expect(r.scoreV0).toBe(100); // v0: 100 base + 10 bond capped
    expect(r.v1Adjustments.v0BondBonusReplaced).toBe(10);
    expect(r.v1Adjustments.perVaultBondBonus).toBe(0);
    // v1 = v0(100) + 0 streak + 0 risk + (0 - 10) = 90
    expect(r.scoreV1).toBe(90);
  });

  it("v1 with mean-zero balanced oscillation: sharpe = 0", () => {
    // pnls [0, 10, 0] → returns [10, -10] → mean 0, std 10 → sharpe 0
    const r = computeAgentScoreV1({
      ...base,
      recentPnls: [0, 10, 0],
    });
    expect(r.sharpeLike).toBe(0);
    expect(r.v1Adjustments.riskAdjusted).toBe(0);
  });

  it("v1 with biased oscillation: sharpe is small positive", () => {
    // pnls [0,1,0,1,0,1] → returns [1,-1,1,-1,1] → mean 0.2, std≈0.98 → sharpe≈0.204
    const r = computeAgentScoreV1({
      ...base,
      recentPnls: [0, 1, 0, 1, 0, 1],
    });
    expect(r.sharpeLike).not.toBeNull();
    expect(r.sharpeLike!).toBeCloseTo(0.204, 2);
    expect(r.v1Adjustments.riskAdjusted).toBe(1); // round(0.204*5) = 1
  });

  it("v1 with monotonic-ish positive sharpe", () => {
    const r = computeAgentScoreV1({
      ...base,
      recentPnls: [0, 10, 5, 20, 15, 30],
    });
    expect(r.sharpeLike).not.toBeNull();
    expect(r.sharpeLike!).toBeGreaterThan(0);
    expect(r.v1Adjustments.riskAdjusted).toBeGreaterThan(0);
  });

  it("v1 with proven-enforcement strong bond → +15 vs v0 +10", () => {
    const r = computeAgentScoreV1({
      ...base,
      bondBalanceMicros: 5_000_000n,
      bondBalancesMicros: [10_000_000n],
      anyBondEverSlashed: true,
    });
    expect(r.v1Adjustments.perVaultBondBonus).toBe(15);
    expect(r.v1Adjustments.v0BondBonusReplaced).toBe(10);
    // v1 = 100 + 0 + 0 + (15 - 10) = 105 → capped 100
    expect(r.scoreV1).toBe(100);
  });

  it("v1 flags verifiedPnl as unverified-paper-mode when fillCount = 0", () => {
    const r = computeAgentScoreV1(base);
    expect(r.verifiedPnl).toBe("unverified-paper-mode");
    expect(r.verifiedFillCount).toBe(0);
  });

  it("v1 flags verifiedPnl as recomputed when fillCount > 0", () => {
    const r = computeAgentScoreV1({ ...base, verifiedFillCount: 7 });
    expect(r.verifiedPnl).toBe("recomputed-from-fills");
    expect(r.verifiedFillCount).toBe(7);
  });

  it("v1 clamps to 0 when combined penalties exceed 100", () => {
    const r = computeAgentScoreV1({
      ...base,
      recordCount: 0,
      lastPnlMicros: 0,
      slashEventCount: 5,
      secondsSinceLastReceipt: 99_999,
      recentPnls: [100, 80, 60, 40], // negative sharpe → -15
    });
    expect(r.scoreV1).toBe(0);
  });

  it("v1 combined: streak + sharpe + per-vault, no penalties", () => {
    const r = computeAgentScoreV1({
      ...base,
      longestStreak: 100, // +15 cap
      recentPnls: [0, 10, 5, 20, 15, 30], // positive sharpe → +some
      bondBalancesMicros: [10_000_000n],
      anyBondEverSlashed: true, // +15
    });
    // v1 = 100(v0) + 15 streak + risk(+) + (15 - 0) → capped 100
    expect(r.scoreV1).toBe(100);
    expect(r.v1Adjustments.streakBonus).toBe(15);
    expect(r.v1Adjustments.perVaultBondBonus).toBe(15);
  });

  // Phase 4 anti-gaming penalties.
  it("mandateDrift penalty subtracts 10 pts when flagged", () => {
    const clean = computeAgentScoreV1({ ...base, mandateDrifted: false });
    const drifted = computeAgentScoreV1({ ...base, mandateDrifted: true });
    expect(clean.scoreV1).toBe(drifted.scoreV1 + 10);
    expect(drifted.v1Adjustments.mandateDriftPenalty).toBe(10);
    expect(drifted.mandateDrifted).toBe(true);
  });

  it("exposureChange penalty scales 0..15 pts linearly with bps", () => {
    const stable = computeAgentScoreV1({ ...base, maxExposureChangeBps: 0 });
    const half = computeAgentScoreV1({ ...base, maxExposureChangeBps: 5000 });
    const full = computeAgentScoreV1({ ...base, maxExposureChangeBps: 10_000 });
    expect(stable.v1Adjustments.exposureChangePenalty).toBe(0);
    expect(half.v1Adjustments.exposureChangePenalty).toBe(8);
    expect(full.v1Adjustments.exposureChangePenalty).toBe(15);
  });

  it("anti-gaming stress: lucky PnL spike + mandate drift scores BELOW boring fresh receipts", () => {
    // Bot A: high PnL spike, but silently swapped strategy + threw a wild exposure
    const luckyButDrifty = computeAgentScoreV1({
      lastPnlMicros: 100_000_000, // $100 PnL — looks impressive
      peakPnlMicros: 100_000_000,
      recordCount: 5,
      secondsSinceLastReceipt: 60,
      slashEventCount: 0,
      mandateDrifted: true, // silently swapped strategy mid-flight
      maxExposureChangeBps: 8000, // 80% exposure swing
    });
    // Bot B: boring, no PnL, no slashes, no drift
    const boringReliable = computeAgentScoreV1({
      lastPnlMicros: 0,
      peakPnlMicros: 0,
      recordCount: 5,
      secondsSinceLastReceipt: 60,
      slashEventCount: 0,
      longestStreak: 5,
    });
    // Reward boring reliability over lucky spike with hidden gaming.
    expect(boringReliable.scoreV1).toBeGreaterThan(luckyButDrifty.scoreV1);
  });
});
