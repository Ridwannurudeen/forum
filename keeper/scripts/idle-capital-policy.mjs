#!/usr/bin/env node
// Phase 7 idle-capital policy reporter.
//
// Roadmap line item: "idle capital policy". For every CovenantVault the
// factory has minted, compute the share of assets sitting idle (vs deployed
// as outstanding operator credit), check against a configurable threshold,
// and emit a JSON status report. Optional --halt-on-violation exits 1 so
// a cron / CI hook can page on persistent over-idle states.
//
// Read-only — never broadcasts. A higher-tier rebalancer (Phase 5
// router-stale-enforcer.mjs is the precedent) decides what to actually
// do about an over-idle vault: the policy here just measures + alerts.
//
// Usage:
//   tsx keeper/scripts/idle-capital-policy.mjs                  # report only
//   tsx keeper/scripts/idle-capital-policy.mjs --threshold 50   # 50% idle ceiling
//   tsx keeper/scripts/idle-capital-policy.mjs --halt-on-violation
//   tsx keeper/scripts/idle-capital-policy.mjs --out reports/idle.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http, parseAbi } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const THRESHOLD_PCT = Number(arg("--threshold", "75"));
const HALT_ON_VIOLATION = process.argv.includes("--halt-on-violation");
const OUT_PATH = arg("--out", `reports/idle-${Math.floor(Date.now() / 1000)}.json`);

const ARC = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC ?? "https://rpc.testnet.arc.network"] } },
});
const dep = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
const FACTORY = dep.contracts.CovenantVaultFactory?.address;
if (!FACTORY) { console.error("CovenantVaultFactory not deployed"); process.exit(2); }

const FACTORY_ABI = parseAbi(["function allVaults() view returns (address[])"]);
const VAULT_ABI = parseAbi([
  "function state() view returns (uint8)",
  "function assets() view returns (uint256)",
  "function depositTotalIdle() view returns (uint256)",
  "function operatorOutstanding() view returns (uint256)",
  "function mandate() view returns (address operator, bytes32 botId, uint128 budgetUsdc, uint16 maxDrawdownBps, uint32 receiptFreshnessSec, uint64 expiry, uint16 perfFeeBps, address bondContract, address riskKernel, address trackRecordV2)",
]);

const pub = createPublicClient({ chain: ARC, transport: http() });
const STATE_NAMES = ["ACTIVE", "PAUSED", "EXPIRED"];

console.log(`idle-capital-policy · threshold=${THRESHOLD_PCT}%${HALT_ON_VIOLATION ? " halt-on-violation" : ""}`);

const vaults = await pub.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "allVaults" });
console.log(`discovered ${vaults.length} vault(s) via factory`);

const reports = [];
let violations = 0;

for (const vault of vaults) {
  const [vstate, assets, idle, outstanding, mandate] = await Promise.all([
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "state" }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "assets" }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "depositTotalIdle" }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "operatorOutstanding" }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "mandate" }),
  ]);
  const total = BigInt(assets);
  const idleMicros = BigInt(idle);
  // BigInt-safe percentage with 2 decimals (basis-point math)
  const idlePctBps = total === 0n ? 0n : (idleMicros * 10000n) / total;
  const idlePct = Number(idlePctBps) / 100;
  const violated = idlePct > THRESHOLD_PCT && total > 0n;
  if (violated) violations += 1;
  reports.push({
    vault,
    operator: mandate[0],
    botId: mandate[1],
    state: STATE_NAMES[Number(vstate)] ?? `S${vstate}`,
    assetsMicros: assets.toString(),
    idleMicros: idle.toString(),
    outstandingMicros: outstanding.toString(),
    idlePct,
    violation: violated,
  });
  const tag = violated ? "VIOLATION" : "ok";
  console.log(`  ${vault} state=${STATE_NAMES[Number(vstate)] ?? "?"} total=${(Number(assets) / 1e6).toFixed(6)} USDC idle=${idlePct.toFixed(2)}% (${tag})`);
}

const out = {
  generatedAt: Math.floor(Date.now() / 1000),
  thresholdPct: THRESHOLD_PCT,
  vaultCount: vaults.length,
  violationCount: violations,
  reports,
};

const reportsDir = dirname(OUT_PATH);
if (reportsDir && !existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`\nreport: ${OUT_PATH}`);
console.log(`violations: ${violations} / ${vaults.length}`);

if (HALT_ON_VIOLATION && violations > 0) process.exit(1);
