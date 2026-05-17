// Forum reference keeper — paper-mode V2 market-maker that publishes
// its track record to Arc.
//
// Usage:
//   node --import tsx src/index.ts --markets 1 --interval 30
//
// Or once built:
//   npm run build && node dist/index.js --markets 1 --interval 30
//
// All trading is PAPER ONLY. No orders are submitted to Polymarket.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PolymarketReader } from "./polymarket.js";
import { DEFAULT_QUOTER_CONFIG } from "./quoter.js";
import { ForumBridge } from "./forum.js";
import { runLoop } from "./loop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

interface Args {
  markets: number;
  intervalSec: number;
  publishEvery: number;
  label: string;
  maxTicks: number | undefined;
}

function parseArgs(): Args {
  const out: Args = {
    markets: 1,
    intervalSec: 30,
    publishEvery: 10,
    label: "forum-ref-keeper",
    maxTicks: undefined,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--markets" && argv[i + 1]) out.markets = Number(argv[++i]);
    else if (a === "--interval" && argv[i + 1])
      out.intervalSec = Number(argv[++i]);
    else if (a === "--publish-every" && argv[i + 1])
      out.publishEvery = Number(argv[++i]);
    else if (a === "--label" && argv[i + 1]) out.label = argv[++i]!;
    else if (a === "--max-ticks" && argv[i + 1])
      out.maxTicks = Number(argv[++i]);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`Forum reference keeper`);
  console.log(`  markets:      ${args.markets}`);
  console.log(`  interval:     ${args.intervalSec}s`);
  console.log(`  publishEvery: ${args.publishEvery} ticks`);
  console.log(`  label:        ${args.label}`);

  const reader = new PolymarketReader();
  const markets = await reader.discoverMarkets(args.markets, 5_000);
  if (markets.length === 0) {
    console.error(
      "No markets found with sufficient liquidity. Lower min-liquidity or try again.",
    );
    process.exit(1);
  }

  const bridge = new ForumBridge({
    deploymentPath: `${REPO_ROOT}/deployments/arc-testnet.json`,
    botLabel: args.label,
  });
  console.log(`  account:      ${bridge.account.address}`);
  console.log(`  botId:        ${bridge.botId}`);

  await runLoop({
    intervalMs: args.intervalSec * 1_000,
    publishEveryTicks: args.publishEvery,
    quoterConfig: DEFAULT_QUOTER_CONFIG,
    bridge,
    markets,
    maxTicks: args.maxTicks,
  });
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
