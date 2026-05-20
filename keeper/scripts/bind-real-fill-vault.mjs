#!/usr/bin/env node
// Bind a funded + risk-enforced CovenantVault to a bot's botId (intended: the
// real-fill Polymarket bot) so its linkedVaults is no longer empty.
//
// HONEST SCOPE: this makes the bot a funded, slashable, risk-gated Covenant
// Account. It does NOT mean the historical $2 Polymarket fill was funded by
// this vault — that trade predated the vault and used the operator's own
// Polymarket pUSD. Cross-chain capital routing (Arc vault USDC -> Polymarket
// pUSD via CCTP) is the deferred piece. First-party demo: operator = deployer.
//
// Run on VPS (pass the botId as an arg so no 64-hex literal lives in source):
//   cd /opt/forum/keeper && ./node_modules/.bin/tsx scripts/bind-real-fill-vault.mjs <botId>

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeFunctionData, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const BOTID = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(BOTID || "")) {
  console.error("usage: tsx scripts/bind-real-fill-vault.mjs <botId(0x+64hex)>");
  process.exit(2);
}
const DEPOSIT = 1_000_000n; // fund with 1 USDC so it's a funded (not empty) vault

const ARC = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
const pk = readFileSync(join(homedir(), ".forum-keys", "deployer.key"), "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const d = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));

const FACTORY = d.contracts.CovenantVaultFactory.address;
const KERNEL = d.contracts.RiskKernelV2.address;
const BOND = d.contracts.SlashBondV1_1.address;
const TRV2 = d.contracts.TrackRecordV2.address;
const USDC = d.usdc;

const factoryAbi = [{
  type: "function", name: "createVault", stateMutability: "nonpayable",
  inputs: [{ name: "m", type: "tuple", components: [
    { name: "operator", type: "address" },
    { name: "botId", type: "bytes32" },
    { name: "budgetUsdc", type: "uint128" },
    { name: "maxDrawdownBps", type: "uint16" },
    { name: "receiptFreshnessSec", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "perfFeeBps", type: "uint16" },
    { name: "bondContract", type: "address" },
    { name: "riskKernel", type: "address" },
    { name: "trackRecordV2", type: "address" },
  ] }],
  outputs: [{ type: "address" }],
}];
const allVaultsAbi = parseAbi(["function allVaults() view returns (address[])"]);
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const vaultDepositAbi = parseAbi(["function deposit(uint256) returns (uint256)"]);

const mandate = {
  operator: account.address,
  botId: BOTID,
  budgetUsdc: 50_000_000n,         // 50 USDC
  maxDrawdownBps: 1000,            // 10%
  receiptFreshnessSec: 2_592_000,  // 30d — bot isn't a continuous keeper
  expiry: 0n,
  perfFeeBps: 2_000,
  bondContract: BOND,
  riskKernel: KERNEL,
  trackRecordV2: TRV2,
};

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });
const usd = (x) => (Number(x) / 1e6).toFixed(6);
async function tx(to, data) {
  const hash = await wal.sendTransaction({ to, data });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
}

console.log("operator/deployer:", account.address);
console.log("binding vault to botId:", BOTID);

console.log("\ncreateVault(mandate) ...");
console.log("  tx:", await tx(FACTORY, encodeFunctionData({ abi: factoryAbi, functionName: "createVault", args: [mandate] })));
const all = await pub.readContract({ address: FACTORY, abi: allVaultsAbi, functionName: "allVaults" });
const vault = all[all.length - 1];
console.log("  new vault:", vault);

const bal = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`\noperator USDC balance: ${usd(bal)}`);
const dep = bal < DEPOSIT ? bal : DEPOSIT;
if (dep > 0n) {
  console.log(`fund vault: approve + deposit(${usd(dep)}) ...`);
  console.log("  approve tx:", await tx(USDC, encodeFunctionData({ abi: erc20, functionName: "approve", args: [vault, dep] })));
  console.log("  deposit tx:", await tx(vault, encodeFunctionData({ abi: vaultDepositAbi, functionName: "deposit", args: [dep] })));
} else {
  console.log("operator has no USDC to deposit — vault created but unfunded.");
}

console.log("\nDONE. Verify (~30s):");
console.log(`  curl https://forum.gudman.xyz/api/agents/${BOTID} | grep -o '"linkedVaults":\\[[^]]*]'`);
console.log(`  curl https://forum.gudman.xyz/api/covenant/${vault}`);
