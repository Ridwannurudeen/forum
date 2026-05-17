#!/usr/bin/env node
// AgoraMind keeper — continuous AI-driven quoter that:
//   1. Calls AgoraMind (LLM) for a structured BUY/SELL/HOLD + reasoning each tick
//   2. Hashes the reasoning trace
//   3. At each PUBLISH cycle, builds a Forum Receipt with:
//        market metadata, book snapshots, fills, inventory, PnL inputs,
//        strategy config hash, decisionTrace { traceUri, traceHash }
//      Writes JSON to /opt/forum/web/receipts/<bot>/<seq>.json
//   4. Publishes to TrackRecordV2 with evidenceUri pointing at the JSON
//      and evidenceHash = keccak256(canonical JSON)
//
// Designed to run as a systemd service alongside the v1 keeper.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { keccak256, toHex } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

const { pathToFileURL } = await import('node:url');
const fileUrl = (p) => pathToFileURL(resolve(p)).href;

const { PolymarketReader } = await import(fileUrl('keeper/src/polymarket.ts'));
const { ForumV2Bridge } = await import(fileUrl('keeper/src/forum-v2.ts'));
const { MockLlmProvider, AnthropicProvider, reasoningHash } = await import(
  fileUrl('keeper/src/agora-mind.ts')
);
const { buildReceipt } = await import(fileUrl('keeper/src/receipt.ts'));

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    markets: Number(get('--markets', '3')),
    intervalSec: Number(get('--interval', '60')),
    publishEvery: Number(get('--publish-every', '10')),
    label: get('--label', 'forum-agora-mind-v1'),
    maxTicks: process.argv.includes('--max-ticks') ? Number(get('--max-ticks', '0')) : undefined,
    provider: get('--provider', process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock'),
    receiptsDir: get('--receipts-dir', '/opt/forum/web/receipts'),
    receiptsBaseUrl: get('--receipts-base-url', 'https://forum.gudman.xyz/receipts'),
  };
}

async function main() {
  const args = parseArgs();
  console.log('AgoraMind keeper');
  console.log('  label:           ', args.label);
  console.log('  markets:         ', args.markets);
  console.log('  interval:        ', args.intervalSec, 's');
  console.log('  publishEvery:    ', args.publishEvery, 'ticks');
  console.log('  provider:        ', args.provider);
  console.log('  receiptsDir:     ', args.receiptsDir);
  console.log('  receiptsBaseUrl: ', args.receiptsBaseUrl);

  mkdirSync(args.receiptsDir, { recursive: true });

  const reader = new PolymarketReader();
  const markets = await reader.discoverMarkets(args.markets, 5_000);
  if (markets.length === 0) {
    console.error('no markets with sufficient liquidity');
    process.exit(1);
  }
  console.log(`booting on ${markets.length} markets:`);
  for (const m of markets) console.log(`  ${m.slug} liq=$${m.liquidity.toFixed(0)}`);

  const bridge = new ForumV2Bridge({
    deploymentPath: `${REPO_ROOT}/deployments/arc-testnet.json`,
    botLabel: args.label,
    receiptsDir: args.receiptsDir,
    receiptsBaseUrl: args.receiptsBaseUrl,
  });
  console.log('  signer:          ', bridge.account.address);
  console.log('  botId:           ', bridge.botId);

  const reg = await bridge.ensureRegistered(0);
  console.log(
    reg.alreadyRegistered ? `bot already registered` : `registered in tx ${reg.txHash}`,
  );

  const llm = args.provider === 'anthropic' ? new AnthropicProvider() : new MockLlmProvider();
  let seq = (await bridge.lastSeq()) + 1;
  let prevHash = await bridge.lastRecordHash();
  console.log(`  starting seq:    `, seq);
  console.log(`  prev record hash:`, prevHash);

  const strategyConfigHash = keccak256(toHex('agora-mind-v1-default-config'));

  let tick = 0;
  let cumulativeFills = 0;
  let cumulativePnlUsdc = 0;
  let periodStartTs = Math.floor(Date.now() / 1000);
  let cycleBookSnapshots = [];
  let cycleFills = [];
  let cycleDecisions = [];

  while (args.maxTicks === undefined || tick < args.maxTicks) {
    tick += 1;
    const ts = Math.floor(Date.now() / 1000);

    for (const m of markets) {
      try {
        const book = await reader.fetchBook(m.yesToken);
        const bid = PolymarketReader.bestBid(book);
        const ask = PolymarketReader.bestAsk(book);
        if (!bid || !ask) {
          console.log(`tick=${tick} ${m.slug} empty book`);
          continue;
        }
        const midprice = (bid.price + ask.price) / 2;
        const ctx = {
          marketSlug: m.slug,
          marketQuestion: m.question,
          book: {
            bestBid: bid.price,
            bestAsk: ask.price,
            midprice,
            bidDepth: bid.size,
            askDepth: ask.size,
          },
          recentMidprices: [midprice],
          inventory: 0,
          variance: 0,
          ts,
        };
        const decision = await llm.decide(ctx);
        const trHash = reasoningHash(decision);
        console.log(
          `tick=${tick} ${m.slug} mid=${midprice.toFixed(3)} -> ${decision.action} size=${decision.sizeUsdc} skew=${decision.spreadSkewBps}bps trace=${trHash.slice(0, 10)}`,
        );

        cycleBookSnapshots.push({
          marketId: m.yesToken,
          start: { bids: [{ price: bid.price, size: bid.size }], asks: [{ price: ask.price, size: ask.size }], ts, source: 'polymarket-clob-v2' },
          end: { bids: [{ price: bid.price, size: bid.size }], asks: [{ price: ask.price, size: ask.size }], ts, source: 'polymarket-clob-v2' },
        });
        cycleDecisions.push({ trHash, action: decision.action, model: decision.model, marketSlug: m.slug });
      } catch (e) {
        console.error(`tick=${tick} ${m.slug} ERROR`, e.message);
      }
    }

    if (tick % args.publishEvery === 0) {
      try {
        const periodEndTs = Math.floor(Date.now() / 1000);
        // Aggregate trace hashes into a single decisionTrace.traceHash by hashing
        // the concatenation. The receipt's `decisionTrace.traceUri` points to a
        // sidecar JSON listing each per-tick decision.
        const traceListJson = JSON.stringify(cycleDecisions);
        const traceJsonHash = keccak256(toHex(traceListJson));
        const traceFilename = `traces/${String(seq).padStart(6, '0')}.json`;
        const traceFullPath = `${args.receiptsDir}/${bridge.botId.slice(2, 14)}/${traceFilename}`;
        mkdirSync(dirname(traceFullPath), { recursive: true });
        writeFileSync(traceFullPath, traceListJson + '\n');
        const traceUri = `${args.receiptsBaseUrl}/${bridge.botId.slice(2, 14)}/${traceFilename}`;

        const receipt = buildReceipt({
          botId: bridge.botId,
          seq,
          periodStart: periodStartTs,
          periodEnd: periodEndTs,
          markets: markets.map((mm) => mm.slug),
          bookSnapshots: cycleBookSnapshots,
          fills: cycleFills,
          inventory: markets.map((mm) => ({ marketId: mm.yesToken, openShares: 0, closeShares: 0 })),
          pnl: {
            realizedUsdc: 0,
            unrealizedUsdc: 0,
            makerRebatesUsdc: 0,
            totalUsdcMicros: BigInt(Math.round(cumulativePnlUsdc * 1_000_000)),
            formulaVersion: 'v1',
          },
          strategy: {
            name: 'agora-mind-v1',
            configHash: strategyConfigHash,
          },
          decisionTrace: { traceUri, traceHash: traceJsonHash },
        });

        // pnl totalUsdcMicros is BigInt for bigger numbers but receipt schema is number; coerce.
        receipt.pnl.totalUsdcMicros = Number(receipt.pnl.totalUsdcMicros);

        const { uri, hash, localPath } = bridge.writeReceipt(seq, receipt);
        console.log(`RECEIPT seq=${seq} hash=${hash} ${localPath}`);

        const metaHash = keccak256(toHex(`seq=${seq};markets=${markets.map((mm) => mm.slug).join(',')}`));
        const txHash = await bridge.publishRecord({
          seq,
          periodStart: periodStartTs,
          periodEnd: periodEndTs,
          pnlMicros: BigInt(Math.round(cumulativePnlUsdc * 1_000_000)),
          fills: cumulativeFills,
          metaHash,
          evidenceUri: uri,
          evidenceHash: hash,
          prevRecordHash: prevHash,
        });
        console.log(`PUBLISH-V2 tx=${txHash} seq=${seq} evidenceUri=${uri}`);
        prevHash = await bridge.lastRecordHash();
        seq += 1;

        // reset cycle accumulators
        periodStartTs = periodEndTs + 1;
        cycleBookSnapshots = [];
        cycleFills = [];
        cycleDecisions = [];
      } catch (e) {
        console.error('PUBLISH-V2 failed:', e.message);
      }
    }

    await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
