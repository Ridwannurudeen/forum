import { describe, it, expect } from "vitest";
import { longestStreak, recordTs } from "../src/indexer-pure.js";

describe("recordTs", () => {
  it("returns ts for V1 records", () => {
    expect(recordTs("v1", { ts: 1000n })).toBe(1000);
  });

  it("returns periodEnd for V2 records, not periodStart", () => {
    expect(recordTs("v2", { periodEnd: 2000n })).toBe(2000);
  });

  it("accepts plain numbers as well as bigints (defensive)", () => {
    expect(recordTs("v1", { ts: 1500 })).toBe(1500);
    expect(recordTs("v2", { periodEnd: 2500 })).toBe(2500);
  });

  it("returns 0 when the relevant field is missing instead of throwing", () => {
    expect(recordTs("v1", {})).toBe(0);
    expect(recordTs("v2", {})).toBe(0);
  });
});

describe("longestStreak", () => {
  const GAP = 1800; // matches STREAK_GAP_SEC in the indexer

  it("returns 0 for empty input", () => {
    expect(longestStreak([], GAP)).toBe(0);
  });

  it("returns 1 for a single record", () => {
    expect(longestStreak([100], GAP)).toBe(1);
  });

  it("counts consecutive tight gaps", () => {
    // 5 records at 600s apart — all < 1800s, all part of one streak.
    expect(longestStreak([0, 600, 1200, 1800, 2400], GAP)).toBe(5);
  });

  it("breaks the streak on a single oversized gap", () => {
    // gap 5 → 10000 is 9400s, far over 1800s.
    expect(longestStreak([0, 600, 1200, 1800, 10000], GAP)).toBe(4);
  });

  it("finds the longest run when there are multiple streaks", () => {
    //   t0..t3 = run of 4 (gaps 600,600,600 < 1800)
    //   then big gap → restart
    //   then t4..t6 = run of 3
    expect(longestStreak([0, 600, 1200, 1800, 10000, 10500, 11000], GAP)).toBe(
      4,
    );
  });

  it("treats exactly-gapSec as a streak break (strict < )", () => {
    // gap == GAP must restart, otherwise the freshness threshold and the
    // streak rule disagree on the edge.
    expect(longestStreak([0, GAP, 2 * GAP], GAP)).toBe(1);
  });
});
