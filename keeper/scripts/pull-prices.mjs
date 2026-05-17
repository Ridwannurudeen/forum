#!/usr/bin/env node
// Pull historical price series for N Polymarket V2 markets and cache as
// JSONL files under data/historical/<conditionId>.prices.jsonl
//
// Usage:
//   node keeper/scripts/pull-prices.mjs --markets 5 --days 7 --fidelity 1
//
// Strategy:
//   1. Discover N active V2 markets with min liquidity
//   2. For each, call clob.getPricesHistory({market, startTs, endTs, fidelity})
//   3. Persist {t, p} tuples as JSONL — one record per line for streaming-friendly reads

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClobClient, Chain } from '@polymarket/clob-client-v2';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

const args = (() => {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    markets: Number(get('--markets', '5')),
    days: Number(get('--days', '7')),
    fidelity: Number(get('--fidelity', '1')), // minutes
    minLiquidity: Number(get('--min-liquidity', '5000')),
  };
})();

console.log(`Pulling price history`);
console.log(`  markets:       ${args.markets}`);
console.log(`  days:          ${args.days}`);
console.log(`  fidelity:      ${args.fidelity} min`);
console.log(`  min liquidity: $${args.minLiquidity}`);

// Discover markets.
const gammaUrl =
  `https://gamma-api.polymarket.com/markets?limit=${Math.min(args.markets * 20, 500)}` +
  `&active=true&closed=false&order=liquidity&ascending=false`;
const rows = await fetch(gammaUrl, {
  headers: { 'user-agent': 'forum-historical/0.0.1', accept: 'application/json' },
}).then((r) => r.json());

const chosen = [];
for (const m of rows) {
  if (!m.enableOrderBook) continue;
  if (Number(m.liquidity ?? 0) < args.minLiquidity) continue;
  let tids = m.clobTokenIds;
  if (typeof tids === 'string') {
    try {
      tids = JSON.parse(tids);
    } catch {
      continue;
    }
  }
  if (!Array.isArray(tids) || tids.length !== 2) continue;
  chosen.push({
    conditionId: m.conditionId,
    slug: m.slug,
    question: m.question,
    endDate: m.endDate,
    yesToken: tids[0],
    noToken: tids[1],
    liquidity: Number(m.liquidity),
  });
  if (chosen.length >= args.markets) break;
}
console.log(`\nDiscovered ${chosen.length} markets:`);
for (const m of chosen) console.log(`  ${m.slug}  liq=$${m.liquidity.toFixed(0)}  ends=${m.endDate}`);

// Pull histories.
const clob = new ClobClient({ host: 'https://clob.polymarket.com', chain: Chain.POLYGON });
mkdirSync('data/historical', { recursive: true });

const now = Math.floor(Date.now() / 1000);
const startTs = now - args.days * 86_400;

for (const m of chosen) {
  console.log(`\n[${m.slug}]  pulling YES-token price history...`);
  try {
    const resp = await clob.getPricesHistory({
      market: m.yesToken,
      startTs,
      endTs: now,
      fidelity: args.fidelity,
    });
    const hist = Array.isArray(resp?.history) ? resp.history : [];
    if (hist.length === 0) {
      console.log(`  no history returned`);
      continue;
    }
    const outPath = join('data/historical', `${m.conditionId}.prices.jsonl`);
    const lines = hist.map((h) => JSON.stringify({ t: h.t, p: h.p })).join('\n');
    writeFileSync(outPath, lines + '\n');
    const first = hist[0];
    const last = hist[hist.length - 1];
    console.log(`  rows=${hist.length}  ${new Date(first.t * 1000).toISOString()} → ${new Date(last.t * 1000).toISOString()}`);
    console.log(`  ${outPath}`);

    // Also persist a metadata sidecar.
    writeFileSync(
      join('data/historical', `${m.conditionId}.meta.json`),
      JSON.stringify({
        conditionId: m.conditionId,
        slug: m.slug,
        question: m.question,
        endDate: m.endDate,
        yesToken: m.yesToken,
        noToken: m.noToken,
        liquidity: m.liquidity,
        pullStartTs: startTs,
        pullEndTs: now,
        fidelityMin: args.fidelity,
        rows: hist.length,
      }, null, 2) + '\n',
    );
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
  }
}

console.log(`\nDone. Cached under data/historical/`);
