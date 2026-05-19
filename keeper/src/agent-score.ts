/**
 * AgentScore v0 + v1 — pure scoring functions extracted from forum-indexer
 * so they're unit-testable without HTTP / RPC / disk side effects.
 *
 * v0 formula (kept stable for back-compat + regression):
 *   start = 100
 *   - if recordCount == 0:            -40
 *   - drawdown penalty:               -min(40, drawdownBps / 100)
 *   - staleness penalty:              -min(30, max(0, (secondsSinceLastReceipt - freshnessGraceSec) / 60))
 *   - slash penalty:                  -15 * slashEventCount
 *   - bond bonus:                     +10 if bondBalanceMicros > 0
 *   clamp 0..100
 *
 * v1 ADDITIVE hardenings (Phase 4 ship items):
 *   1. Longest uninterrupted streak — reward boring consistency
 *      input: longestStreak (number of consecutive publishes within an
 *      expected interval, counted by the indexer)
 *      bonus: +min(15, longestStreak * 0.3)  // saturates at 50 publishes
 *
 *   2. Risk-adjusted return (Sharpe-like) over recent PnL deltas
 *      input: recentPnls (last N pnlMicros values, in order)
 *      sharpeLike = mean(returns) / std(returns) where returns = pnl[i] - pnl[i-1]
 *      Mapped to a bounded score impact: +min(15, max(-15, sharpeLike * 5))
 *      Skipped (0) when recentPnls.length < 3 (insufficient data).
 *
 *   3. Real per-vault bond attribution
 *      input: bondBalancesMicros (array of bond balances of every bond
 *      linked to a vault this bot is bound to)
 *      bonus:
 *        +0  if total = 0
 *        +5  if total > 0 but < 1 USDC
 *        +10 if total >= 1 USDC
 *        +15 if total >= 10 USDC AND at least one of the linked bonds
 *             has been slashed before (proven enforcement)
 *
 *   4. (Deferred to Phase 3) verified-fill PnL recompute requires real fills
 *      in receipts. Currently every published receipt has fills = 0
 *      (paper mode), so v1 marks verifiedFillCount = 0 + notes
 *      verifiedPnl = 'unverified-paper-mode' in the breakdown for honesty.
 *
 *   scoreV1 = scoreV0 + streakBonus + riskAdjustedAdjustment +
 *             (perVaultBondBonus - v0BondBonus)   // replace, don't double-count
 *   clamp 0..100
 */

export interface AgentScoreInput {
  recordCount: number;
  lastPnlMicros: number;
  peakPnlMicros: number;
  /** unix seconds since the last published receipt; 0 if none */
  secondsSinceLastReceipt: number;
  slashEventCount: number;
  bondBalanceMicros: bigint | string | number;
  /** receipt-freshness grace window — seconds before staleness penalty kicks in. Default 1800 (30min). */
  freshnessGraceSec?: number;
}

export interface AgentScoreV1Input extends AgentScoreInput {
  /** Indexer-tracked count of consecutive receipts within expected interval. */
  longestStreak?: number;
  /** Last N pnlMicros values, oldest first. Need >=3 for Sharpe-like. */
  recentPnls?: number[];
  /** Balances (microUSDC) of every bond contract referenced by a vault bound to this bot. */
  bondBalancesMicros?: (bigint | string | number)[];
  /** True if at least one of the linked bonds has totalSlashed > 0 (proves enforcement actually fires). */
  anyBondEverSlashed?: boolean;
  /** Sum of fills with venue-attributed order IDs. Phase 3. Default 0. */
  verifiedFillCount?: number;
  /** Phase 4 anti-gaming: true if strategy.configHash changed between the
   *  latest and previous receipt (silent mandate swap). */
  mandateDrifted?: boolean;
  /** Phase 4 anti-gaming: largest closeShares delta across markets between
   *  the latest and previous receipt, in basis points of the prior position
   *  (5000 = 50% of prior position changed in one cycle). */
  maxExposureChangeBps?: number;
}

export interface AgentScoreBreakdown {
  scoreV0: number;
  drawdownBps: number;
  penalties: {
    noRecords: number;
    drawdown: number;
    staleness: number;
    slash: number;
  };
  bonuses: { bond: number };
}

/** Phase 4 anti-gaming penalty helpers. */
export function mandateDriftPenalty(drifted: boolean | undefined): number {
  return drifted ? 10 : 0;
}

export function exposureChangePenalty(bps: number | undefined): number {
  if (!bps || bps <= 0) return 0;
  // Linear ramp: 0 bps -> 0 penalty, 10000 bps (full position swing) -> 15 pts.
  // Capped so a single explosive cycle can't zero a bot's score.
  return Math.min(15, Math.round((bps / 10_000) * 15));
}

export interface AgentScoreV1Breakdown extends AgentScoreBreakdown {
  scoreV1: number;
  v1Adjustments: {
    streakBonus: number;
    riskAdjusted: number;
    perVaultBondBonus: number;
    v0BondBonusReplaced: number;
    /** Phase 4 anti-gaming penalty (subtracted). */
    mandateDriftPenalty: number;
    /** Phase 4 anti-gaming penalty (subtracted). */
    exposureChangePenalty: number;
  };
  sharpeLike: number | null;
  longestStreak: number;
  verifiedFillCount: number;
  verifiedPnl: "unverified-paper-mode" | "recomputed-from-fills";
  mandateDrifted: boolean;
  maxExposureChangeBps: number;
}

export function drawdownBps(
  peakPnlMicros: number,
  lastPnlMicros: number,
): number {
  if (peakPnlMicros <= 0) return 0;
  if (lastPnlMicros >= peakPnlMicros) return 0;
  return Math.floor(((peakPnlMicros - lastPnlMicros) * 10_000) / peakPnlMicros);
}

export function computeAgentScore(input: AgentScoreInput): AgentScoreBreakdown {
  const grace = input.freshnessGraceSec ?? 1800;
  const dd = drawdownBps(input.peakPnlMicros, input.lastPnlMicros);
  const ddPenalty = Math.min(40, Math.floor(dd / 100));
  const stalePenalty =
    input.secondsSinceLastReceipt > grace
      ? Math.min(30, Math.floor((input.secondsSinceLastReceipt - grace) / 60))
      : 0;
  const slashPenalty = 15 * Math.max(0, input.slashEventCount);
  const noRecordsPenalty = input.recordCount === 0 ? 40 : 0;
  const bondBonus = BigInt(input.bondBalanceMicros ?? 0n) > 0n ? 10 : 0;

  let score =
    100 -
    noRecordsPenalty -
    ddPenalty -
    stalePenalty -
    slashPenalty +
    bondBonus;
  score = Math.max(0, Math.min(100, score));

  return {
    scoreV0: score,
    drawdownBps: dd,
    penalties: {
      noRecords: noRecordsPenalty,
      drawdown: ddPenalty,
      staleness: stalePenalty,
      slash: slashPenalty,
    },
    bonuses: { bond: bondBonus },
  };
}

// ----------------------------------------------------------------------------
// v1 additions
// ----------------------------------------------------------------------------

/**
 * Sharpe-like ratio over per-period PnL deltas.
 *
 * Returns null if insufficient data (need >= 3 records => >= 2 returns).
 * Returns 0 when std is 0 (e.g. constant PnL — neither rewarded nor penalised).
 */
export function sharpeLike(recentPnls: number[]): number | null {
  if (!recentPnls || recentPnls.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < recentPnls.length; i++) {
    returns.push(recentPnls[i] - recentPnls[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return mean / std;
}

export function streakBonus(longestStreak: number): number {
  if (!longestStreak || longestStreak < 1) return 0;
  return Math.min(15, Math.floor(longestStreak * 0.3));
}

export function riskAdjustedScore(sharpe: number | null): number {
  if (sharpe === null) return 0;
  // bounded [-15, +15]
  return Math.max(-15, Math.min(15, Math.round(sharpe * 5)));
}

export function perVaultBondBonus(
  bondBalancesMicros: (bigint | string | number)[] | undefined,
  anyBondEverSlashed: boolean | undefined,
): number {
  if (!bondBalancesMicros || bondBalancesMicros.length === 0) return 0;
  const total = bondBalancesMicros.reduce((a: bigint, b) => a + BigInt(b), 0n);
  if (total === 0n) return 0;
  // 1 USDC = 1_000_000 micros
  if (total < 1_000_000n) return 5;
  if (total >= 10_000_000n && anyBondEverSlashed) return 15;
  return 10;
}

export function computeAgentScoreV1(
  input: AgentScoreV1Input,
): AgentScoreV1Breakdown {
  const v0 = computeAgentScore(input);

  const longest = Math.max(0, input.longestStreak ?? 0);
  const streak = streakBonus(longest);

  const sharpe = sharpeLike(input.recentPnls ?? []);
  const risk = riskAdjustedScore(sharpe);

  const perVault = perVaultBondBonus(
    input.bondBalancesMicros,
    input.anyBondEverSlashed,
  );

  // Replace the v0 bond bonus with the more granular v1 per-vault bonus.
  // Net delta = perVault - v0Bond.
  const v0Bond = v0.bonuses.bond;
  // Phase 4 anti-gaming penalties — subtracted from v1 score.
  const mdPenalty = mandateDriftPenalty(input.mandateDrifted);
  const ecPenalty = exposureChangePenalty(input.maxExposureChangeBps);
  const v1Delta = streak + risk + (perVault - v0Bond) - mdPenalty - ecPenalty;

  let scoreV1 = v0.scoreV0 + v1Delta;
  scoreV1 = Math.max(0, Math.min(100, scoreV1));

  return {
    ...v0,
    scoreV1,
    v1Adjustments: {
      streakBonus: streak,
      riskAdjusted: risk,
      perVaultBondBonus: perVault,
      v0BondBonusReplaced: v0Bond,
      mandateDriftPenalty: mdPenalty,
      exposureChangePenalty: ecPenalty,
    },
    sharpeLike: sharpe,
    longestStreak: longest,
    mandateDrifted: Boolean(input.mandateDrifted),
    maxExposureChangeBps: input.maxExposureChangeBps ?? 0,
    verifiedFillCount: input.verifiedFillCount ?? 0,
    verifiedPnl:
      (input.verifiedFillCount ?? 0) > 0
        ? "recomputed-from-fills"
        : "unverified-paper-mode",
  };
}
