#!/usr/bin/env node
// Covenant treasury-agent loop — the agent puts drawn credit to WORK on Arc.
//
//   funded CovenantVault -> size a bounded draw -> pick the best available
//   capital venue (USYC real Treasury yield if the operator is allowlisted,
//   else an honest idle fallback) -> pullCredit -> deploy -> withdraw ->
//   returnCapital + crystalliseFee -> publish a receipt with realized PnL.
//
// Unlike agent-fund-cycle.mjs (which draws + returns to prove the credit
// primitive), this one routes the drawn USDC through a real on-Arc venue, so
// the loop is "the agent used the funds", settled on Arc.
//
// USYC is gated by Circle's Entitlements allowlist: until the operator wallet
// is allowlisted, the venue's preflight detects the revert and the agent falls
// back to idle — no failed draw. Once allowlisted, --venue usyc earns real yield.
//
// Usage (from repo root, with ~/.forum-keys/deployer.key):
//   ./keeper/node_modules/.bin/tsx keeper/scripts/agent-yield-cycle.mjs --dry-run
//   ./keeper/node_modules/.bin/tsx keeper/scripts/agent-yield-cycle.mjs --venue auto --pull-cap-usdc 1 --publish
//
// Flags:
//   --vault 0x..         vault to operate (default: CovenantVaultV1_2)
//   --venue usyc|idle|auto   venue preference (default: auto = [usyc, idle])
//   --pull-cap-usdc N    max USDC to draw (default 1)
//   --conviction N       0..100, scales the draw within the cap (default 100)
//   --dry-run            read-only: print preflight + plan, no writes
//   --publish            publish a TrackRecordV2 receipt for the cycle

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { keccak256, toHex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));
const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt } = await import(fileUrl("keeper/src/receipt.ts"));
const { UsycVenue, IdleVenue, sizeDraw, computeRealizedPnl, selectVenue } =
  await import(fileUrl("keeper/src/yield-venue.ts"));
const { MockTreasuryProvider, AnthropicTreasuryProvider } =
  await import(fileUrl("keeper/src/treasury-mind.ts"));

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(k);

const dep = JSON.parse(readFileSync(`${process.cwd()}/deployments/arc-testnet.json`, "utf8"));
const VAULT = arg("--vault", dep.contracts.CovenantVaultV1_2.address);
const USDC = dep.usdc;
const TELLER = dep.circle.usyc.teller;
const USYC = dep.circle.usyc.token;
const PULL_CAP = BigInt(Math.round(Number(arg("--pull-cap-usdc", "1")) * 1e6));
const CONVICTION = Number(arg("--conviction", "100"));
const VENUE_PREF = arg("--venue", "auto");
const DRY = has("--dry-run");
const PUBLISH = has("--publish");

const bridge = new ForumV2Bridge({
  deploymentPath: `${process.cwd()}/deployments/arc-testnet.json`,
  botLabel: "yield-agent-v1",
  receiptsDir: "/tmp/forum-yield-agent",
  receiptsBaseUrl: "https://forum.gudman.xyz/receipts",
});
const OPERATOR = bridge.account.address;
console.log("operator:", OPERATOR, "\nvault:   ", VAULT, "\nvenue pref:", VENUE_PREF, DRY ? "(dry-run)" : "");

const VAULT_ABI = [
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "availableCredit", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "operatorOutstanding", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pullCredit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "returnCapital", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "crystalliseFee", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

const readVault = (name) => bridge.publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: name });
const usd = (x) => (Number(x) / 1e6).toFixed(6);

// ChainOps backed by viem — the IO the venues need.
const ops = {
  async erc20Balance(token, who) {
    return bridge.publicClient.readContract({
      address: token,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [who],
    });
  },
  async simulate(address, abi, fn, args, account) {
    try {
      await bridge.publicClient.simulateContract({ address, abi, functionName: fn, args, account });
      return { ok: true, reason: "" };
    } catch (e) {
      return { ok: false, reason: (e.shortMessage || e.message || "revert").slice(0, 160) };
    }
  },
  async write(address, abi, fn, args) {
    const hash = await bridge.walletClient.writeContract({ address, abi, functionName: fn, args, chain: bridge.publicClient.chain });
    const r = await bridge.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${fn} reverted: ${hash}`);
    return hash;
  },
};
const venueCtx = { ops, operator: OPERATOR, usdc: USDC };

const state = Number(await readVault("state"));
if (state !== 0) {
  console.error(`vault not ACTIVE (state=${state}) — reactivate before deploying credit`);
  process.exit(1);
}
const available = await readVault("availableCredit");
const mandateMeta = dep.contracts.CovenantVaultV1_2?.mandate ?? {};
console.log(`\navailableCredit=${usd(available)} pullCap=${usd(PULL_CAP)}`);

// Build venues + preflight at the cap so availability reflects the max draw.
const usyc = new UsycVenue(TELLER, USYC);
const idle = new IdleVenue();
const ranked =
  VENUE_PREF === "usyc" ? [usyc] : VENUE_PREF === "idle" ? [idle] : [usyc, idle];
const probe = PULL_CAP > available ? available : PULL_CAP;
const preflights = [];
const venueOptions = [];
for (const v of ranked) {
  const pf = await v.preflight(venueCtx, probe);
  console.log(`  preflight[${v.name}]: ${pf.ok ? "OK" : "SKIP"} — ${pf.reason}`);
  preflights.push({ venue: v, preflight: pf });
  venueOptions.push({ name: v.name, kind: v.kind, available: pf.ok, reason: pf.reason });
}

// Claude-driven (or deterministic mock) treasury-allocation decision.
const provider = process.env.ANTHROPIC_API_KEY
  ? new AnthropicTreasuryProvider()
  : new MockTreasuryProvider();
const decision = await provider.decide({
  availableCreditUsdc: Number(available) / 1e6,
  budgetUsdc: Number(mandateMeta.budgetUsdc ?? 0) / 1e6,
  maxDrawdownBps: Number(mandateMeta.maxDrawdownBps ?? 0),
  vaultState: state,
  venues: venueOptions,
  ts: Math.floor(Date.now() / 1000),
});
console.log(`\nTREASURY DECISION (${decision.model}): venue=${decision.venue} conviction=${decision.convictionPct}% posture=${decision.riskPosture} deploy=${decision.deployUsdc.toFixed(6)} USDC`);

if (decision.riskPosture === "halt" || decision.requestPause) {
  console.log("agent self-governed: halt / request pause — no deployment (the mandate working).");
  process.exit(0);
}

// --conviction overrides the agent's sizing; otherwise use the decision's.
const convPct = has("--conviction") ? CONVICTION : decision.convictionPct;
const amount = sizeDraw(available, PULL_CAP, convPct);
if (amount <= 0n) { console.log("zero draw — hold"); process.exit(0); }

const venue = selectVenue(preflights);
if (!venue) { console.error("\nno deployable venue (all preflights failed)"); process.exit(1); }
console.log(`selected venue: ${venue.name} (${venue.kind}); draw ${usd(amount)} USDC (conviction ${convPct}%)`);

const reasoning =
  decision.reasoning +
  `\nExecuting on Arc: venue=${venue.name} (${venue.kind}), draw=${usd(amount)} USDC.`;

if (DRY) {
  console.log("\n--- DRY RUN (no writes) ---");
  console.log(`plan: pullCredit(${usd(amount)}) -> ${venue.name}.deploy -> withdraw -> returnCapital -> crystalliseFee` + (PUBLISH ? " -> publish receipt" : ""));
  console.log("reasoning:\n" + reasoning);
  process.exit(0);
}

// --- Execute the loop on Arc ---
console.log(`\nbefore: operatorOutstanding=${usd(await readVault("operatorOutstanding"))}`);
console.log("1) pullCredit:", await ops.write(VAULT, VAULT_ABI, "pullCredit", [amount]));
console.log(`   outstanding now: ${usd(await readVault("operatorOutstanding"))}`);

console.log(`2) ${venue.name}.deploy(${usd(amount)}) ...`);
const deployRes = await venue.deploy(venueCtx, amount);
console.log("   deploy tx:", deployRes.txHash ?? "(no on-chain action — idle)");

console.log(`3) ${venue.name}.withdraw() ...`);
const wd = await venue.withdraw(venueCtx);
const recovered = wd.usdcRecovered;
const pnl = computeRealizedPnl(amount, recovered);
console.log(`   withdraw tx: ${wd.txHash ?? "(idle)"} | recovered ${usd(recovered)} USDC | realized PnL ${usd(pnl)} USDC`);

// Return everything recovered so any yield accrues to depositors (raises NAV).
console.log("4) returnCapital + crystalliseFee ...");
console.log("   approve tx:", await ops.write(USDC, [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }], "approve", [VAULT, recovered]));
console.log("   return  tx:", await ops.write(VAULT, VAULT_ABI, "returnCapital", [recovered]));
console.log("   fee     tx:", await ops.write(VAULT, VAULT_ABI, "crystalliseFee", []));
console.log(`after: operatorOutstanding=${usd(await readVault("operatorOutstanding"))}`);

if (PUBLISH) {
  console.log("\n5) publish receipt ...");
  await bridge.ensureRegistered(3); // 3 = OTHER (treasury/yield agent)
  const seq = (await bridge.lastSeq()) + 1;
  const prevHash = await bridge.lastRecordHash();
  const now = Math.floor(Date.now() / 1000);
  const receipt = buildReceipt({
    botId: bridge.botId,
    seq,
    periodStart: now - 60,
    periodEnd: now,
    markets: [`${venue.name}-treasury`],
    bookSnapshots: [],
    fills: [],
    inventory: [],
    pnl: {
      realizedUsdc: Number(pnl) / 1e6,
      unrealizedUsdc: 0,
      makerRebatesUsdc: 0,
      totalUsdcMicros: Number(pnl),
      formulaVersion: "v1",
    },
    strategy: { name: "yield-agent-v1", configHash: keccak256(toHex(`yield:${venue.name}`)) },
    decisionTrace: { traceUri: "", traceHash: keccak256(toHex(reasoning)) },
  });
  const { uri, hash } = bridge.writeReceipt(seq, receipt);
  const metaHash = keccak256(toHex(`yield-cycle;venue=${venue.name};seq=${seq}`));
  const { txHash } = await bridge.publishRecordAwait({
    seq, periodStart: now - 60, periodEnd: now,
    pnlMicros: BigInt(pnl), fills: 0, metaHash,
    evidenceUri: uri, evidenceHash: hash, prevRecordHash: prevHash,
  }, 3);
  console.log(`   receipt seq=${seq} uri=${uri}`);
  console.log(`   publish tx=${txHash}`);
}

console.log(`\nDONE — treasury-agent loop on Arc: draw -> ${venue.name} -> recover -> return. venue=${venue.name} realizedPnL=${usd(pnl)} USDC`);
