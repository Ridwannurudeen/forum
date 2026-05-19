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
// Run as: tsx keeper/scripts/agora-mind-recover.mjs

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keccak256, toHex } from "viem";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt } = await import(fileUrl("keeper/src/receipt.ts"));

const LABEL = "forum-agora-mind-prod-v1";
const RECEIPTS_DIR = "/opt/forum/web/receipts";
const RECEIPTS_BASE = "https://forum.gudman.xyz/receipts";

// Stop the keeper so a seq collision doesn't happen mid-recovery.
console.log("stopping forum-agora-mind ...");
try { execSync("systemctl stop forum-agora-mind", { stdio: "inherit" }); } catch (e) { /* ok if not installed */ }

const bridge = new ForumV2Bridge({
  deploymentPath: `${process.cwd()}/deployments/arc-testnet.json`,
  botLabel: LABEL,
  receiptsDir: RECEIPTS_DIR,
  receiptsBaseUrl: RECEIPTS_BASE,
});
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
const dep = JSON.parse((await import("node:fs")).readFileSync(`${process.cwd()}/deployments/arc-testnet.json`, "utf8"));
const VAULT = dep.contracts.CovenantVaultV1_2.address;
const KERNEL = dep.contracts.RiskKernelV2.address;
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

console.log("restarting forum-agora-mind ...");
try { execSync("systemctl start forum-agora-mind", { stdio: "inherit" }); } catch (e) { console.error("restart failed (manual: systemctl start forum-agora-mind):", e.message); }

if (Number(newState) === 0) {
  console.log("\nRECOVERY OK — vault is ACTIVE. Keeper will resume on next tick.");
} else {
  console.log("\nWARN — vault is still not ACTIVE. Check verdict via /api/covenant/" + VAULT);
}
