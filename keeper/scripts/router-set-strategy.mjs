#!/usr/bin/env node
// Route the CapitalRouter across TWO agent vaults so "allocates across agents"
// is literally true, then rebalance to enforce the new weights.
// Strategist-only (deployer). First-party demo.
//
// Run on VPS: cd /opt/forum/keeper && ./node_modules/.bin/tsx scripts/router-set-strategy.mjs <vaultA> <vaultB>

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const A = process.argv[2], B = process.argv[3];
for (const v of [A, B]) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v || "")) {
    console.error("usage: tsx scripts/router-set-strategy.mjs <vaultA> <vaultB>");
    process.exit(2);
  }
}

const ARC = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
const pk = readFileSync(join(homedir(), ".forum-keys", "deployer.key"), "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const d = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
const ROUTER = d.contracts.CapitalRouter.address;

const abi = parseAbi([
  "function setStrategy(address[] vaults, uint16[] weightsBps)",
  "function rebalance()",
  "function strategist() view returns (address)",
  "function targetVaultCount() view returns (uint256)",
]);
const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });
async function tx(data) {
  const hash = await wal.sendTransaction({ to: ROUTER, data });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
}

const strat = await pub.readContract({ address: ROUTER, abi, functionName: "strategist" });
console.log("router:", ROUTER, "\nstrategist:", strat, "\ncaller:", account.address);
if (strat.toLowerCase() !== account.address.toLowerCase()) {
  console.error("caller is not the strategist — cannot setStrategy");
  process.exit(1);
}

console.log("\nsetStrategy([A,B], [5000,5000]) ...");
console.log("  tx:", await tx(encodeFunctionData({ abi, functionName: "setStrategy", args: [[A, B], [5000, 5000]] })));
console.log("targetVaultCount:", await pub.readContract({ address: ROUTER, abi, functionName: "targetVaultCount" }));

console.log("\nrebalance() ...");
console.log("  tx:", await tx(encodeFunctionData({ abi, functionName: "rebalance", args: [] })));
console.log("\nDONE — router now allocates across 2 vaults. Verify: curl https://forum.gudman.xyz/api/router/performance");
