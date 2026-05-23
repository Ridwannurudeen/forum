// Forum adapter template — TypeScript reference.
//
// Run from the repo root with the keeper's tsx:
//   FORUM_BOT_LABEL=my-bot-v1 \
//   RECEIPT_BASE_URL=https://forum.gudman.xyz/receipts \
//   RECEIPT_LOCAL_DIR=./receipts \
//   ./keeper/node_modules/.bin/tsx adapters/template/adapter.ts
//
// With RECEIPT_BASE_URL on the Forum host (the default), each receipt is
// auto-uploaded to Forum's hash-gated endpoint — no receipt hosting of your
// own. To self-host instead, set RECEIPT_BASE_URL to your own public HTTPS path.
//
// Requires:
// - ~/.forum-keys/deployer.key with a raw 0x-hex private key
//   (or set FORUM_KEY_PATH to point at a different key file)
// - Arc testnet USDC for gas (faucet.circle.com)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
process.chdir(REPO_ROOT);

const fileUrl = (p: string) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt, canonicalize } = await import(
  fileUrl("keeper/src/receipt.ts")
);

const BOT_LABEL = process.env.FORUM_BOT_LABEL || "template-bot-v1";
const RECEIPTS_DIR = process.env.RECEIPT_LOCAL_DIR || "./receipts";
const RECEIPTS_BASE_URL =
  process.env.RECEIPT_BASE_URL || "https://forum.gudman.xyz/receipts";
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS || 600_000); // 10 min

mkdirSync(RECEIPTS_DIR, { recursive: true });

// ----------------------------------------------------------------------------
// REPLACE THIS BLOCK with your bot's actual loop.
//
// Return an array of per-decision objects (any shape your bot uses) plus the
// realized + unrealized PnL for the period in micro-USDC.
// ----------------------------------------------------------------------------

interface BotPeriodOutput {
  decisions: { marketSlug: string; action: string; size: number; ts: number }[];
  fills: {
    marketId: string;
    sideBoughtSharesIfBuy: number;
    priceMicros: number;
    ts: number;
  }[];
  realizedPnlMicros: bigint;
  unrealizedPnlMicros: bigint;
}

async function runBot(
  periodStart: number,
  periodEnd: number,
): Promise<BotPeriodOutput> {
  // === your bot's loop here ===
  // - subscribe to market data
  // - call your strategy
  // - submit orders to your venue (Polymarket V2, HL, etc.)
  // - collect the decisions + fills + realized PnL
  return {
    decisions: [
      { marketSlug: "example-market", action: "BUY", size: 0, ts: periodEnd },
    ],
    fills: [],
    realizedPnlMicros: 0n,
    unrealizedPnlMicros: 0n,
  };
}

// ----------------------------------------------------------------------------
// Publish loop — boilerplate, do not edit unless you know what you're doing.
// ----------------------------------------------------------------------------

const bridge = new ForumV2Bridge({
  deploymentPath: `${REPO_ROOT}/deployments/arc-testnet.json`,
  botLabel: BOT_LABEL,
  receiptsDir: RECEIPTS_DIR,
  receiptsBaseUrl: RECEIPTS_BASE_URL,
  // Optional: point at a non-default key file (defaults to ~/.forum-keys/deployer.key).
  keyPath: process.env.FORUM_KEY_PATH || undefined,
});
console.log(`[adapter] signer=${bridge.account.address} botId=${bridge.botId}`);

const reg = await bridge.ensureRegistered(0); // 0 = MAKER. Use 1=TAKER, 2=ARB, 3=OTHER.
console.log(
  reg.alreadyRegistered
    ? "[adapter] bot already registered"
    : `[adapter] registered in tx ${reg.txHash}`,
);

let seq = (await bridge.lastSeq()) + 1;
let prevHash = await bridge.lastRecordHash();
let periodStartTs = Math.floor(Date.now() / 1000);
const strategyConfigHash = keccak256(toHex(`${BOT_LABEL}-config-v1`));

async function publishOnce() {
  const periodEndTs = Math.floor(Date.now() / 1000);
  const out = await runBot(periodStartTs, periodEndTs);

  // Build the canonical receipt
  const receipt = buildReceipt({
    botId: bridge.botId,
    seq,
    periodStart: periodStartTs,
    periodEnd: periodEndTs,
    markets: Array.from(new Set(out.decisions.map((d) => d.marketSlug))),
    bookSnapshots: [],
    fills: out.fills,
    inventory: [],
    pnl: {
      realizedUsdc: 0,
      unrealizedUsdc: 0,
      makerRebatesUsdc: 0,
      totalUsdcMicros: Number(out.realizedPnlMicros + out.unrealizedPnlMicros),
      formulaVersion: "v1",
    },
    strategy: { name: BOT_LABEL, configHash: strategyConfigHash },
    decisionTrace: { traceUri: "", traceHash: "0x" + "0".repeat(64) },
    // Optional Phase 7 cross-chain provenance. If this cycle's capital was
    // bridged in via CCTP V2 (see keeper/scripts/cctp-bridge-and-deposit.mjs),
    // attach the source-chain coordinates so verifiers can join the receipt
    // graph back to the bridging tx. All three fields are required when
    // present — verifier rejects partial claims. Uncomment + replace the
    // placeholder values once you have a real bridging tx + Iris message.
    //
    // sourceChain: {
    //   domain: 6,                                       // CCTP V2 domain (0 ETH, 6 Base, 7 Polygon, 26 Arc)
    //   messageHash: "0x" + "ab".repeat(32) as `0x${string}`,  // keccak256(messageBytes from Iris)
    //   txHash:      "0x" + "cd".repeat(32) as `0x${string}`,  // source-chain depositForBurnWithHook tx
    // },
  });
  const { uri, hash } = bridge.writeReceipt(seq, receipt);
  console.log(`[adapter] RECEIPT seq=${seq} hash=${hash} uri=${uri}`);

  const metaHash = keccak256(toHex(`seq=${seq};label=${BOT_LABEL}`));
  const { txHash, recordHash } = await bridge.publishRecordAwait({
    seq,
    periodStart: periodStartTs,
    periodEnd: periodEndTs,
    pnlMicros: out.realizedPnlMicros + out.unrealizedPnlMicros,
    fills: out.fills.length,
    metaHash,
    evidenceUri: uri,
    evidenceHash: hash,
    prevRecordHash: prevHash,
  });
  console.log(`[adapter] PUBLISH-V2 tx=${txHash} seq=${seq}`);

  // Zero-infra hosting: if RECEIPT_BASE_URL points at Forum's host, upload the
  // receipt JSON. The endpoint only stores it if its keccak hash matches the
  // on-chain TrackRecordV2 record — so it's tokenless and tamper-proof.
  if (/\/\/forum\.gudman\.xyz\//.test(RECEIPTS_BASE_URL)) {
    try {
      const up = await fetch(
        `https://forum.gudman.xyz/api/receipts/${bridge.botId}/${seq}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: canonicalize(receipt),
        },
      );
      console.log(`[adapter] receipt upload: HTTP ${up.status}`);
    } catch (e) {
      console.log(
        `[adapter] receipt upload failed (non-fatal): ${(e as Error)?.message ?? e}`,
      );
    }
  }

  prevHash = recordHash;
  seq += 1;
  periodStartTs = periodEndTs + 1;
}

await publishOnce();
setInterval(publishOnce, PUBLISH_INTERVAL_MS);
