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

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { keccak256, toHex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
process.chdir(REPO_ROOT);

const { pathToFileURL } = await import("node:url");
const fileUrl = (p) => pathToFileURL(resolve(p)).href;

const { PolymarketReader } = await import(fileUrl("keeper/src/polymarket.ts"));
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { MockLlmProvider, AnthropicProvider, reasoningHash } = await import(
  fileUrl("keeper/src/agora-mind.ts")
);
const { buildReceipt, receiptHash } = await import(fileUrl("keeper/src/receipt.ts"));

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    markets: Number(get("--markets", "3")),
    intervalSec: Number(get("--interval", "60")),
    publishEvery: Number(get("--publish-every", "10")),
    label: get("--label", "forum-agora-mind-v1"),
    maxTicks: process.argv.includes("--max-ticks")
      ? Number(get("--max-ticks", "0"))
      : undefined,
    provider: get(
      "--provider",
      process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock",
    ),
    receiptsDir: get("--receipts-dir", "/opt/forum/web/receipts"),
    receiptsBaseUrl: get(
      "--receipts-base-url",
      "https://forum.gudman.xyz/receipts",
    ),
    // Phase 3 risk controls — all default off so existing prod keeper is
    // unchanged. Operators opt in per deployment via env or CLI.
    //   --max-loss-day-usdc N            — halt publish if cumulative PnL
    //                                      drops by > N USDC over the rolling
    //                                      24h window (0 = disabled)
    //   --min-receipt-interval-sec N     — refuse to publish closer than N
    //                                      seconds after the previous publish
    //                                      (defense in depth vs intervalSec
    //                                      misconfig; 0 = disabled)
    //   --auto-pause-on-verifier-failure — before publishing, GET our last
    //                                      receipt URI and re-verify its
    //                                      hash against TrackRecordV2; if
    //                                      mismatch, halt (don't publish
    //                                      until operator clears it)
    // --max-loss-per-market-usdc is intentionally NOT a flag yet — paper-mode
    // doesn't produce per-market fills (cycleFills is always []), so the
    // control would be vapor. Reintroduce alongside Phase 3 real-fill wiring
    // (docs/phase-2-real-fill-spec.md).
    maxLossDayUsdc: Number(get("--max-loss-day-usdc", "0")),
    minReceiptIntervalSec: Number(get("--min-receipt-interval-sec", "0")),
    autoPauseOnVerifierFailure: process.argv.includes("--auto-pause-on-verifier-failure"),
    // Cost throttle: only call the LLM on publish ticks (default off → unchanged).
    llmOnPublishOnly: process.argv.includes("--llm-on-publish-only"),
  };
}

async function main() {
  const args = parseArgs();
  console.log("AgoraMind keeper");
  console.log("  label:           ", args.label);
  console.log("  markets:         ", args.markets);
  console.log("  interval:        ", args.intervalSec, "s");
  console.log("  publishEvery:    ", args.publishEvery, "ticks");
  console.log("  provider:        ", args.provider);
  console.log("  receiptsDir:     ", args.receiptsDir);
  console.log("  receiptsBaseUrl: ", args.receiptsBaseUrl);

  mkdirSync(args.receiptsDir, { recursive: true });

  const reader = new PolymarketReader();
  const markets = await reader.discoverMarkets(args.markets, 5_000);
  if (markets.length === 0) {
    console.error("no markets with sufficient liquidity");
    process.exit(1);
  }
  console.log(`booting on ${markets.length} markets:`);
  for (const m of markets)
    console.log(`  ${m.slug} liq=$${m.liquidity.toFixed(0)}`);

  const bridge = new ForumV2Bridge({
    deploymentPath: `${REPO_ROOT}/deployments/arc-testnet.json`,
    botLabel: args.label,
    receiptsDir: args.receiptsDir,
    receiptsBaseUrl: args.receiptsBaseUrl,
  });
  console.log("  signer:          ", bridge.account.address);
  console.log("  botId:           ", bridge.botId);

  const reg = await bridge.ensureRegistered(0);
  console.log(
    reg.alreadyRegistered
      ? `bot already registered`
      : `registered in tx ${reg.txHash}`,
  );

  const llm =
    args.provider === "anthropic"
      ? new AnthropicProvider()
      : new MockLlmProvider();
  let seq = (await bridge.lastSeq()) + 1;
  let prevHash = await bridge.lastRecordHash();

  // ----------------------------------------------------------------------
  // Covenant Account integration — only quote/publish while vault is ACTIVE.
  // ----------------------------------------------------------------------
  const deployment = JSON.parse(
    readFileSync(`${REPO_ROOT}/deployments/arc-testnet.json`, "utf8"),
  );
  const covenantAddr = (
    deployment.contracts?.CovenantVaultV1_2 ??
    deployment.contracts?.CovenantVault
  )?.address;
  const riskKernelAddr = (
    deployment.contracts?.RiskKernelV2 ?? deployment.contracts?.RiskKernel
  )?.address;
  const STATE_ABI = [
    {
      type: "function",
      name: "state",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint8" }],
    },
  ];
  const ENFORCE_ABI = [
    {
      type: "function",
      name: "enforce",
      stateMutability: "nonpayable",
      inputs: [{ name: "vault", type: "address" }],
      outputs: [],
    },
  ];
  async function readVaultState() {
    if (!covenantAddr) return 0;
    try {
      return Number(
        await bridge.publicClient.readContract({
          address: covenantAddr,
          abi: STATE_ABI,
          functionName: "state",
        }),
      );
    } catch (e) {
      console.error("vault state read failed:", e.message);
      return 0;
    }
  }
  async function nudgeRiskKernel() {
    if (!covenantAddr || !riskKernelAddr) return;
    try {
      await bridge.walletClient.writeContract({
        address: riskKernelAddr,
        abi: ENFORCE_ABI,
        functionName: "enforce",
        args: [covenantAddr],
        chain: bridge.publicClient.chain,
      });
    } catch (e) {
      console.error("risk kernel enforce failed:", e.message);
    }
  }
  if (covenantAddr) {
    console.log("  bound to vault:  ", covenantAddr);
    console.log("  risk kernel:     ", riskKernelAddr);
  }
  console.log(`  starting seq:    `, seq);
  console.log(`  prev record hash:`, prevHash);

  const strategyConfigHash = keccak256(toHex("agora-mind-v1-default-config"));

  let tick = 0;
  let cumulativeFills = 0;
  let cumulativePnlUsdc = 0;
  let periodStartTs = Math.floor(Date.now() / 1000);
  let cycleBookSnapshots = [];
  let cycleFills = [];
  let cycleDecisions = [];
  let cycleAgentHalt = false;
  let cycleHaltReason = "";

  // Per-market rolling context for the LLM: recent midprice window + EWMA
  // variance. Without these the model sees one static midprice each tick and
  // decides the same thing every time.
  const ctxState = new Map(); // yesToken -> { mids:[], ewmaVar, lastMid }
  const MID_WINDOW = 20;
  const EWMA_LAMBDA = 0.94;
  // Live CovenantVaultV1.2 mandate the agent reasons against (budget / max DD).
  const MANDATE = { budgetUsdc: 200, maxDrawdownBps: 500 };
  let cachedVaultState = 0; // last on-chain vault state; refreshed each publish

  // Phase 3 risk-control state — kept local to the loop so it dies with the
  // process (no persisted halt state to manually clear; restart = reset).
  const DAY_SEC = 24 * 60 * 60;
  // [{ ts, cumPnlUsdc }] sliding window for the day-loss rule. Pruned each
  // publish attempt; capped at ~2x worth of records so it can't grow without
  // bound under a slow leak.
  const pnlWindow = [{ ts: Math.floor(Date.now() / 1000), cumPnlUsdc: 0 }];
  let lastPublishAt = 0;
  let halted = false;     // sticky — set by auto-pause-on-verifier-failure
  let haltedReason = "";

  function recordPnlSample(now, cumUsdc) {
    pnlWindow.push({ ts: now, cumPnlUsdc: cumUsdc });
    const cutoff = now - DAY_SEC;
    while (pnlWindow.length > 1 && pnlWindow[0].ts < cutoff) pnlWindow.shift();
    if (pnlWindow.length > 5000) pnlWindow.splice(0, pnlWindow.length - 5000);
  }

  function dayLossUsdc(cumUsdc) {
    // peak minus current over the rolling 24h window
    let peak = cumUsdc;
    for (const s of pnlWindow) if (s.cumPnlUsdc > peak) peak = s.cumPnlUsdc;
    return peak - cumUsdc;
  }

  // Re-fetch the previous receipt JSON and confirm its computed hash matches
  // the evidenceHash that TrackRecordV2.recordAt stored on-chain. Different
  // from the prevHash we already track (that's the EIP-712 record digest;
  // this is the document hash). If they disagree the receipt URL was tampered
  // with or moved — refuse to extend the chain on top of it.
  const RECORD_AT_V2_INDEXED_ABI = [{
    type: "function", name: "recordAt", stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }, { name: "idx", type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "seq", type: "uint64" },
      { name: "periodStart", type: "uint64" },
      { name: "periodEnd", type: "uint64" },
      { name: "pnlMicros", type: "int128" },
      { name: "fills", type: "uint64" },
      { name: "metaHash", type: "bytes32" },
      { name: "evidenceUriHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "recordHash", type: "bytes32" },
    ] }],
  }];
  async function verifyLastReceipt() {
    if (seq <= 1) return { ok: true };
    const prevSeq = seq - 1;
    const uri = `${args.receiptsBaseUrl}/${bridge.botId.slice(2, 14)}/${String(prevSeq).padStart(6, "0")}.json`;
    let receipt;
    try {
      const r = await fetch(uri);
      if (!r.ok) return { ok: false, reason: `fetch ${uri} -> ${r.status}` };
      receipt = await r.json();
    } catch (e) {
      return { ok: false, reason: `fetch error: ${e.message}` };
    }
    const computed = receiptHash(receipt);
    let stored;
    try {
      const rec = await bridge.publicClient.readContract({
        address: bridge.v2Address,
        abi: RECORD_AT_V2_INDEXED_ABI,
        functionName: "recordAt",
        args: [bridge.botId, BigInt(prevSeq - 1)],
      });
      stored = rec.evidenceHash;
    } catch (e) {
      return { ok: false, reason: `chain read error: ${e.message}` };
    }
    if (computed.toLowerCase() !== stored.toLowerCase()) {
      return {
        ok: false,
        reason: `evidenceHash mismatch seq=${prevSeq} receipt=${computed} chain=${stored}`,
      };
    }
    return { ok: true };
  }

  async function safeToPublish(now, cumUsdc) {
    if (halted) return { ok: false, reason: `halted earlier: ${haltedReason}` };
    if (args.minReceiptIntervalSec > 0 && lastPublishAt > 0) {
      const gap = now - lastPublishAt;
      if (gap < args.minReceiptIntervalSec) {
        return { ok: false, reason: `gap ${gap}s < min ${args.minReceiptIntervalSec}s` };
      }
    }
    if (args.maxLossDayUsdc > 0) {
      const loss = dayLossUsdc(cumUsdc);
      if (loss > args.maxLossDayUsdc) {
        return { ok: false, reason: `24h loss ${loss.toFixed(2)} USDC > cap ${args.maxLossDayUsdc} USDC` };
      }
    }
    if (args.autoPauseOnVerifierFailure) {
      const v = await verifyLastReceipt();
      if (!v.ok) {
        halted = true;
        haltedReason = `verifier failure: ${v.reason}`;
        return { ok: false, reason: haltedReason };
      }
    }
    return { ok: true };
  }

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

        // Update the rolling midprice window + EWMA variance for this market.
        let st = ctxState.get(m.yesToken);
        if (!st) {
          st = { mids: [], ewmaVar: 0, lastMid: midprice };
          ctxState.set(m.yesToken, st);
        }
        const ret = midprice - st.lastMid;
        st.ewmaVar = EWMA_LAMBDA * st.ewmaVar + (1 - EWMA_LAMBDA) * ret * ret;
        st.lastMid = midprice;
        st.mids.push(midprice);
        if (st.mids.length > MID_WINDOW) st.mids.shift();

        // Book snapshot every tick (free) — feeds the receipt regardless of
        // whether the LLM is called this tick.
        cycleBookSnapshots.push({
          marketId: m.yesToken,
          start: {
            bids: [{ price: bid.price, size: bid.size }],
            asks: [{ price: ask.price, size: ask.size }],
            ts,
            source: "polymarket-clob-v2",
          },
          end: {
            bids: [{ price: bid.price, size: bid.size }],
            asks: [{ price: ask.price, size: ask.size }],
            ts,
            source: "polymarket-clob-v2",
          },
        });

        // Cost throttle: with --llm-on-publish-only, only pay for an LLM call on
        // publish ticks. The rolling context above still updates every tick, so
        // the publish-tick decision sees the full price window.
        const callLlm = !args.llmOnPublishOnly || tick % args.publishEvery === 0;
        if (!callLlm) {
          console.log(`tick=${tick} ${m.slug} mid=${midprice.toFixed(3)} -> (llm throttled)`);
          continue;
        }

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
          recentMidprices: st.mids.slice(),
          inventory: 0,
          variance: st.ewmaVar,
          covenant: {
            budgetUsdc: MANDATE.budgetUsdc,
            maxDrawdownBps: MANDATE.maxDrawdownBps,
            vaultState: cachedVaultState,
          },
          ts,
        };
        const decision = await llm.decide(ctx);
        const trHash = reasoningHash(decision);
        if (decision.requestPause || decision.riskPosture === "halt") {
          cycleAgentHalt = true;
          cycleHaltReason = `${m.slug}: ${(decision.reasoning || "")
            .replace(/\s+/g, " ")
            .slice(0, 200)}`;
        }
        console.log(
          `tick=${tick} ${m.slug} mid=${midprice.toFixed(3)} -> ${decision.action} size=${decision.sizeUsdc} conv=${decision.convictionPct}% risk=${decision.riskPosture} skew=${decision.spreadSkewBps}bps trace=${trHash.slice(0, 10)}`,
        );
        cycleDecisions.push({
          trHash,
          action: decision.action,
          model: decision.model,
          marketSlug: m.slug,
          convictionPct: decision.convictionPct,
          riskPosture: decision.riskPosture,
          sizeUsdc: decision.sizeUsdc,
          reasoning: decision.reasoning,
        });
      } catch (e) {
        console.error(`tick=${tick} ${m.slug} ERROR`, e.message);
      }
    }

    if (tick % args.publishEvery === 0) {
      // Self-governance: if the agent itself decided to halt this cycle, log it
      // as an agent-initiated action before nudging the permissionless kernel.
      if (cycleAgentHalt) {
        console.log(
          `AGENT-SELF-GOVERNANCE seq=${seq} agent requested pause -> ${cycleHaltReason}`,
        );
      }
      // Covenant gate: skip publish if vault is PAUSED. Always nudge kernel.
      await nudgeRiskKernel();
      const vaultState = await readVaultState();
      cachedVaultState = vaultState;
      if (vaultState !== 0) {
        console.log(
          `COVENANT-PAUSED state=${vaultState} skipping publish for seq=${seq}`,
        );
        cycleBookSnapshots = [];
        cycleFills = [];
        cycleDecisions = [];
        cycleAgentHalt = false;
        cycleHaltReason = "";
        await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
        continue;
      }

      // Phase 3 risk-control gate.
      const nowTs = Math.floor(Date.now() / 1000);
      const check = await safeToPublish(nowTs, cumulativePnlUsdc);
      if (!check.ok) {
        console.log(`RISK-CONTROL-SKIP seq=${seq} reason=${check.reason}`);
        cycleBookSnapshots = [];
        cycleFills = [];
        cycleDecisions = [];
        cycleAgentHalt = false;
        cycleHaltReason = "";
        await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
        continue;
      }
      try {
        const periodEndTs = Math.floor(Date.now() / 1000);
        // Aggregate trace hashes into a single decisionTrace.traceHash by hashing
        // the concatenation. The receipt's `decisionTrace.traceUri` points to a
        // sidecar JSON listing each per-tick decision.
        const traceListJson = JSON.stringify(cycleDecisions);
        const traceJsonHash = keccak256(toHex(traceListJson));
        const traceFilename = `traces/${String(seq).padStart(6, "0")}.json`;
        const traceFullPath = `${args.receiptsDir}/${bridge.botId.slice(2, 14)}/${traceFilename}`;
        mkdirSync(dirname(traceFullPath), { recursive: true });
        writeFileSync(traceFullPath, traceListJson + "\n");
        const traceUri = `${args.receiptsBaseUrl}/${bridge.botId.slice(2, 14)}/${traceFilename}`;

        const receipt = buildReceipt({
          botId: bridge.botId,
          label: args.label,
          seq,
          periodStart: periodStartTs,
          periodEnd: periodEndTs,
          markets: markets.map((mm) => mm.slug),
          bookSnapshots: cycleBookSnapshots,
          fills: cycleFills,
          inventory: markets.map((mm) => ({
            marketId: mm.yesToken,
            openShares: 0,
            closeShares: 0,
          })),
          pnl: {
            realizedUsdc: 0,
            unrealizedUsdc: 0,
            makerRebatesUsdc: 0,
            totalUsdcMicros: BigInt(Math.round(cumulativePnlUsdc * 1_000_000)),
            formulaVersion: "v1",
          },
          strategy: {
            name: "agora-mind-v1",
            configHash: strategyConfigHash,
          },
          decisionTrace: { traceUri, traceHash: traceJsonHash },
        });

        // pnl totalUsdcMicros is BigInt for bigger numbers but receipt schema is number; coerce.
        receipt.pnl.totalUsdcMicros = Number(receipt.pnl.totalUsdcMicros);

        const { uri, hash, localPath } = bridge.writeReceipt(seq, receipt);
        console.log(`RECEIPT seq=${seq} hash=${hash} ${localPath}`);

        const metaHash = keccak256(
          toHex(`seq=${seq};markets=${markets.map((mm) => mm.slug).join(",")}`),
        );
        // publishRecordAwait waits for the tx to mine + returns the digest the contract
        // stored as lastRecordHash. Using the returned digest as the next prevHash avoids
        // the read-after-write race that previously stalled the keeper at BadHashChain.
        const { txHash, recordHash } = await bridge.publishRecordAwait({
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
        prevHash = recordHash;
        seq += 1;
        lastPublishAt = periodEndTs;
        recordPnlSample(periodEndTs, cumulativePnlUsdc);

        // reset cycle accumulators
        periodStartTs = periodEndTs + 1;
        cycleBookSnapshots = [];
        cycleFills = [];
        cycleDecisions = [];
        cycleAgentHalt = false;
        cycleHaltReason = "";
      } catch (e) {
        console.error("PUBLISH-V2 failed:", e.message);
      }
    }

    await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
