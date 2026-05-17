#!/usr/bin/env node
// Run the Avellaneda-Stoikov backtest over cached Polymarket V2 price histories.
//
// Usage:
//   node keeper/scripts/run-backtest.mjs
//
// Reads data/historical/*.prices.jsonl + *.meta.json
// Writes backtest results JSON + a one-line summary per market to stdout.
// Aggregates portfolio-wide Sharpe / DD / hit rate.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

// Run with: ./node_modules/.bin/tsx scripts/run-backtest.mjs (from keeper/)
// tsx as runtime auto-handles .ts imports; Windows needs file:// URLs.
const { runBacktest, formatSummary } = await import(
  pathToFileURL(resolve('keeper/src/backtest.ts')).href,
);
const { DEFAULT_AS_CONFIG } = await import(
  pathToFileURL(resolve('keeper/src/strategy.ts')).href,
);

const DATA_DIR = 'data/historical';
const OUT_DIR = 'data/backtests';
mkdirSync(OUT_DIR, { recursive: true });

const priceFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith('.prices.jsonl'));
if (priceFiles.length === 0) {
  console.error(`No price files in ${DATA_DIR}. Run pull-prices.mjs first.`);
  process.exit(1);
}

console.log(`Avellaneda-Stoikov backtest`);
console.log(`  config:`, JSON.stringify(DEFAULT_AS_CONFIG));
console.log(`  markets: ${priceFiles.length}`);
console.log('');

const results = [];

for (const pf of priceFiles) {
  const conditionId = basename(pf, '.prices.jsonl');
  const ticks = readFileSync(join(DATA_DIR, pf), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(DATA_DIR, `${conditionId}.meta.json`), 'utf8'));
  } catch {
    /* no meta */
  }
  if (ticks.length < 10) {
    console.log(`[${meta.slug ?? conditionId}]  SKIP (only ${ticks.length} ticks)`);
    continue;
  }
  const resolutionTs = meta.endDate
    ? Math.floor(new Date(meta.endDate).getTime() / 1000)
    : ticks[ticks.length - 1].t + 86_400;
  const { summary, log } = runBacktest({
    ticks,
    resolutionTs,
    cfg: DEFAULT_AS_CONFIG,
    varianceHalfLife: 30,
  });
  results.push({ conditionId, slug: meta.slug, summary });

  console.log(`[${meta.slug ?? conditionId}]`);
  console.log(formatSummary(summary));
  console.log('');

  // Persist log + summary (drop the full log for compactness; keep summary).
  writeFileSync(
    join(OUT_DIR, `${conditionId}.summary.json`),
    JSON.stringify({ conditionId, slug: meta.slug, summary: { ...summary, pnlSeriesUsdc: undefined } }, null, 2) + '\n',
  );
}

// Portfolio aggregate (equal-weight).
if (results.length > 0) {
  const totalPnl = results.reduce((a, r) => a + r.summary.finalPnlUsdc, 0);
  const totalFills = results.reduce((a, r) => a + r.summary.fills, 0);
  const totalTicks = results.reduce((a, r) => a + r.summary.ticks, 0);
  const meanSharpe =
    results.reduce((a, r) => a + r.summary.sharpe, 0) / results.length;
  const meanHitRate =
    results.reduce((a, r) => a + r.summary.hitRate, 0) / results.length;
  const totalDD = results.reduce((a, r) => a + r.summary.maxDrawdown, 0);

  console.log('=== PORTFOLIO (equal-weight across markets) ===');
  console.log(`  markets:           ${results.length}`);
  console.log(`  total ticks:       ${totalTicks}`);
  console.log(`  total fills:       ${totalFills}`);
  console.log(`  mean hit rate:     ${(meanHitRate * 100).toFixed(2)}%`);
  console.log(`  mean Sharpe:       ${meanSharpe.toFixed(3)}`);
  console.log(`  total final PnL:   $${totalPnl.toFixed(4)}`);
  console.log(`  sum max DD:        $${totalDD.toFixed(4)}`);

  writeFileSync(
    join(OUT_DIR, 'portfolio.summary.json'),
    JSON.stringify(
      {
        markets: results.length,
        totalTicks,
        totalFills,
        meanHitRate,
        meanSharpe,
        totalFinalPnl: totalPnl,
        sumMaxDrawdown: totalDD,
        perMarket: results.map((r) => ({ slug: r.slug, ...r.summary, pnlSeriesUsdc: undefined })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nWritten: ${OUT_DIR}/portfolio.summary.json`);
}
