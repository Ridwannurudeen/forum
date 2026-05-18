/**
 * AgentScore v0 — pure scoring function extracted from forum-indexer so
 * it's unit-testable without HTTP / RPC / disk side effects.
 *
 * Score formula (transparent, in source, no oracles):
 *   start = 100
 *   - if recordCount == 0:            -40
 *   - drawdown penalty:               -min(40, drawdownBps / 100)
 *   - staleness penalty:              -min(30, max(0, (secondsSinceLastReceipt - freshnessGraceSec) / 60))
 *   - slash penalty:                  -15 * slashEventCount
 *   - bond bonus:                     +10 if bondBalanceMicros > 0
 *   clamp 0..100
 *
 * Future versions should add per-vault bond attribution, longest-
 * uninterrupted-streak, and verified-fill PnL recompute.
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
