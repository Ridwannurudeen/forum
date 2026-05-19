#!/usr/bin/env node
// Phase 5 stale-vault enforcer for CapitalRouter targets.
//
// Roadmap line item: "auto-withdraw on stale receipts". The deployed
// CapitalRouter has no in-protocol withdraw-on-stale hook (would need a new
// contract). What an external keeper CAN do, with the contracts as deployed,
// is:
//
//   1. Read every targetVault from the CapitalRouter.
//   2. For each one, read its mandate.receiptFreshnessSec, look up its bound
//      bot's last on-chain receipt time, and detect staleness.
//   3. Call RiskKernelV2.enforce(vault) on every stale-but-still-active vault.
//      RiskKernelV2 auto-flips to PAUSED + slashes 25% of bond on
//      PAUSE_STALE verdict.
//   4. After any state change, call CapitalRouter.rebalance() so the pool
//      moves away from the paused vault (rebalance() targets only the
//      weight table; paused vault.withdraw remains depositor-callable).
//
// Read-only by default — pass --execute to actually broadcast. Designed
// for a 5-min cron or systemd timer.
//
// Usage:
//   tsx keeper/scripts/router-stale-enforcer.mjs            # dry run
//   tsx keeper/scripts/router-stale-enforcer.mjs --execute  # broadcast

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const execute = process.argv.includes("--execute");
const KEY_PATH = process.env.FORUM_DEPLOYER_KEY ?? join(homedir(), ".forum-keys", "deployer.key");

const ARC = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC ?? "https://rpc.testnet.arc.network"] } },
});

const dep = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
const CAPITAL_ROUTER = dep.contracts.CapitalRouter?.address;
const TR_V2 = dep.contracts.TrackRecordV2.address;
const KERNEL_V2 = dep.contracts.RiskKernelV2.address;
if (!CAPITAL_ROUTER) { console.error("CapitalRouter not deployed"); process.exit(1); }

const ROUTER_ABI = parseAbi([
  "function targetVaultCount() view returns (uint256)",
  "function targetVaults(uint256) view returns (address)",
  "function rebalance() returns (uint256)",
]);
const VAULT_ABI = parseAbi([
  "function state() view returns (uint8)",
  "function mandate() view returns (address operator, bytes32 botId, uint128 budgetUsdc, uint16 maxDrawdownBps, uint32 receiptFreshnessSec, uint64 expiry, uint16 perfFeeBps, address bondContract, address riskKernel, address trackRecordV2)",
]);
const KERNEL_ABI = parseAbi([
  "function enforce(address vault) returns (uint8)",
]);
const TR_V2_ABI = [{
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
}, {
  type: "function", name: "recordCount", stateMutability: "view",
  inputs: [{ name: "botId", type: "bytes32" }], outputs: [{ type: "uint256" }],
}];

const pub = createPublicClient({ chain: ARC, transport: http() });
let wallet = null;
if (execute) {
  const pk = readFileSync(KEY_PATH, "utf8").trim();
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  wallet = createWalletClient({ chain: ARC, transport: http(), account });
  console.log(`signer: ${account.address}`);
}

console.log(`router: ${CAPITAL_ROUTER}`);
console.log(`mode:   ${execute ? "EXECUTE" : "DRY-RUN (pass --execute to broadcast)"}`);

const count = Number(await pub.readContract({
  address: CAPITAL_ROUTER, abi: ROUTER_ABI, functionName: "targetVaultCount",
}));
console.log(`targetVaultCount: ${count}`);

const now = Math.floor(Date.now() / 1000);
let anyEnforced = false;

for (let i = 0; i < count; i++) {
  const vault = await pub.readContract({
    address: CAPITAL_ROUTER, abi: ROUTER_ABI, functionName: "targetVaults", args: [BigInt(i)],
  });
  const [vstate, mandate] = await Promise.all([
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "state" }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "mandate" }),
  ]);
  const stateNum = Number(vstate);
  const botId = mandate[1];
  // mandate tuple: [0]=operator [1]=botId [2]=budgetUsdc [3]=maxDrawdownBps
  // [4]=receiptFreshnessSec [5]=expiry [6]=perfFeeBps [7..]=addresses
  const fresh = Number(mandate[4]);
  const recordCount = Number(await pub.readContract({
    address: TR_V2, abi: TR_V2_ABI, functionName: "recordCount", args: [botId],
  }));
  let lastTs = 0;
  if (recordCount > 0) {
    const last = await pub.readContract({
      address: TR_V2, abi: TR_V2_ABI, functionName: "recordAt", args: [botId, BigInt(recordCount - 1)],
    });
    lastTs = Number(last.periodEnd);
  }
  const age = lastTs > 0 ? now - lastTs : null;
  const isStale = fresh > 0 && age !== null && age > fresh;
  const stateName = ["ACTIVE", "PAUSED", "EXPIRED"][stateNum] ?? `S${stateNum}`;
  console.log(`  vault[${i}] ${vault} state=${stateName} fresh=${fresh}s ageOfLastReceipt=${age ?? "no-records"}s stale=${isStale ? "YES" : "no"}`);

  if (isStale && stateNum === 0 /* ACTIVE */) {
    if (execute && wallet) {
      try {
        const tx = await wallet.writeContract({
          address: KERNEL_V2, abi: KERNEL_ABI, functionName: "enforce", args: [vault],
        });
        const rcpt = await pub.waitForTransactionReceipt({ hash: tx });
        console.log(`    enforced tx=${tx} status=${rcpt.status}`);
        anyEnforced = anyEnforced || rcpt.status === "success";
      } catch (e) {
        console.error(`    enforce failed: ${e.shortMessage || e.message}`);
      }
    } else {
      console.log(`    would call RiskKernelV2.enforce(${vault}) [dry-run]`);
    }
  }
}

if (anyEnforced && execute && wallet) {
  console.log("rebalancing pool after enforce ...");
  try {
    const tx = await wallet.writeContract({
      address: CAPITAL_ROUTER, abi: ROUTER_ABI, functionName: "rebalance",
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`rebalance tx=${tx} status=${rcpt.status}`);
  } catch (e) {
    console.error(`rebalance failed: ${e.shortMessage || e.message}`);
  }
}

console.log("done.");
