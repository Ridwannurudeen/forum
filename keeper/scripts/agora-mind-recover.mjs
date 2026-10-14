#!/usr/bin/env node
// Operational recovery for the AgoraMind keeper + CovenantVaultV1.2.
//
// Background: the keeper has a defensive covenant gate that skips publishes
// while the vault is PAUSED. That creates a chicken-and-egg: vault PAUSED
// because freshness lapsed, keeper wont publish because PAUSED, so freshness
// never restores. Cleared once with this script: publish ONE fresh receipt
// (bypassing the gate), then call RiskKernelV2.enforce to re-evaluate the
// verdict. If receipt is fresh, state flips back to ACTIVE and the keeper
// resumes its normal loop on next tick.
//
// Safe to re-run. Idempotent at the on-chain level.
// Run as: tsx keeper/scripts/agora-mind-recover.mjs [--label L] [--unit U]
//
// FORUM_CHAIN / FORUM_DEPLOYMENTS / ARC_RPC_URL select the network. The bot
// label and the systemd unit default to the chain's AgoraMind deployment
// (deploy/forum-agora-mind.service on testnet,
// deploy/forum-agora-mind-mainnet.service on mainnet) and must match the
// running keeper, or the recovery receipt lands on a different bot.

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keccak256, toHex } from "viem";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
process.chdir(REPO_ROOT);

const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt } = await import(fileUrl("keeper/src/receipt.ts"));
const { forumChainName } = await import(fileUrl("keeper/src/chain.ts"));
const { defaultCovenantVault, deploymentsPath, loadDeployment } = await import(
  fileUrl("keeper/src/forum-config.ts")
);

const argv = process.argv.slice(2);
const arg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MAINNET = forumChainName() === "arc-mainnet";
const LABEL = arg("--label", MAINNET ? "forum-agora-mind-mainnet-v1" : "forum-agora-mind-prod-v1");
const UNIT = arg("--unit", MAINNET ? "forum-agora-mind-mainnet" : "forum-agora-mind");
const RECEIPTS_DIR = "/opt/forum/web/receipts";
const RECEIPTS_BASE = "https://forum.gudman.xyz/receipts";

const dep = loadDeployment(REPO_ROOT);
const VAULT = defaultCovenantVault(dep);
const KERNEL = dep.contracts.RiskKernelV2?.address;
if (!VAULT || !KERNEL) {
  console.error("manifest lacks a CovenantVault (V3 / V1_2 / V1) or RiskKernelV2 — nothing to recover");
  process.exit(1);
}

// Stop the keeper so a seq collision doesn't happen mid-recovery.
console.log(`stopping ${UNIT} ...`);
try { execSync(`systemctl stop ${UNIT}`, { stdio: "inherit" }); } catch (e) { /* ok if not installed */ }

const bridge = new ForumV2Bridge({
  deploymentPath: deploymentsPath(REPO_ROOT),
  botLabel: LABEL,
  receiptsDir: RECEIPTS_DIR,
  receiptsBaseUrl: RECEIPTS_BASE,
});
console.log("chain:", bridge.chain.name, bridge.chain.id);
console.log("label:", LABEL);
console.log("botId:", bridge.botId);

const seq = (await bridge.lastSeq()) + 1;
const prevHash = await bridge.lastRecordHash();
const now = Math.floor(Date.now() / 1000);
const periodStart = now - 60;
const periodEnd = now;

const receipt = buildReceipt({
  botId: bridge.botId,
  seq, periodStart, periodEnd,
  markets: ["recovery-noop"],
  bookSnapshots: [], fills: [],
  inventory: [],
  pnl: { realizedUsdc: 0, unrealizedUsdc: 0, makerRebatesUsdc: 0, totalUsdcMicros: 0, formulaVersion: "v1" },
  strategy: { name: LABEL, configHash: keccak256(toHex(`${LABEL}-recovery-cfg-v1`)) },
  decisionTrace: { traceUri: "", traceHash: ("0x" + "0".repeat(64)) },
});
const { uri, hash } = bridge.writeReceipt(seq, receipt);
console.log(`RECEIPT seq=${seq} hash=${hash} uri=${uri}`);

const metaHash = keccak256(toHex(`seq=${seq};label=${LABEL};recovery=true`));
const { txHash } = await bridge.publishRecordAwait({
  seq, periodStart, periodEnd,
  pnlMicros: 0n, fills: 0, metaHash,
  evidenceUri: uri, evidenceHash: hash, prevRecordHash: prevHash,
});
console.log(`PUBLISH-V2 tx=${txHash}`);

// Now nudge the kernel to re-evaluate.
const ENFORCE_ABI = [{ type: "function", name: "enforce", stateMutability: "nonpayable", inputs: [{ name: "vault", type: "address" }], outputs: [] }];
console.log(`calling RiskKernelV2.enforce(${VAULT}) ...`);
const enforceHash = await bridge.walletClient.writeContract({
  address: KERNEL, abi: ENFORCE_ABI, functionName: "enforce", args: [VAULT], chain: bridge.publicClient.chain,
});
const rcpt = await bridge.publicClient.waitForTransactionReceipt({ hash: enforceHash });
console.log(`enforce tx=${enforceHash} status=${rcpt.status}`);

// Read state after.
const STATE_ABI = [{ type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }];
const newState = await bridge.publicClient.readContract({ address: VAULT, abi: STATE_ABI, functionName: "state" });
console.log(`vault state after: ${newState} (${["ACTIVE","PAUSED","EXPIRED"][Number(newState)] || "?"})`);

console.log(`restarting ${UNIT} ...`);
try { execSync(`systemctl start ${UNIT}`, { stdio: "inherit" }); } catch (e) { console.error(`restart failed (manual: systemctl start ${UNIT}):`, e.message); }

if (Number(newState) === 0) {
  console.log("\nRECOVERY OK — vault is ACTIVE. Keeper will resume on next tick.");
} else {
  console.log("\nWARN — vault is still not ACTIVE. Check verdict via /api/covenant/" + VAULT);
}
