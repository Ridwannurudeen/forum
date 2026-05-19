// Pure helpers extracted from keeper/scripts/forum-indexer.mjs so they can
// be vitest-covered. The indexer itself is a long-running service script and
// doesn't compose into unit tests well, but the per-bot stats math is
// deterministic and worth pinning down.

/** Normalize a recordAt tuple's timestamp across V1 + V2 schemas.
 *  V1 stores a single `ts` per record. V2 stores periodStart/periodEnd and
 *  the cycle end is the meaningful "last receipt at" timestamp for streak +
 *  freshness scoring. */
export function recordTs(
  version: "v1" | "v2",
  r: { ts?: bigint | number; periodEnd?: bigint | number },
): number {
  if (version === "v2") {
    if (r.periodEnd === undefined) return 0;
    return Number(r.periodEnd);
  }
  if (r.ts === undefined) return 0;
  return Number(r.ts);
}

/** Longest sliding-window streak of consecutive cycle timestamps where each
 *  gap is strictly less than `gapSec`. Used to score "boring reliability"
 *  in AgentScore v1.
 *
 *  Empty input → 0. Single record → 1. Order of timestamps is taken as-is
 *  (the caller controls direction); a single out-of-order gap restarts the
 *  count, mirroring how refreshBotStats walks the recent window forward. */
export function longestStreak(timestamps: number[], gapSec: number): number {
  if (timestamps.length === 0) return 0;
  let longest = 1;
  let cur = 1;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i]! - timestamps[i - 1]!;
    if (gap < gapSec) {
      cur += 1;
      if (cur > longest) longest = cur;
    } else {
      cur = 1;
    }
  }
  return longest;
}

/** Parse and clamp public API `limit` query params.
 *  Invalid, non-integer, zero, and negative values fall back instead of
 *  bypassing caps through `NaN` or negative Array.slice semantics. */
export function clampedLimit(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  const n =
    raw === null || raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}
