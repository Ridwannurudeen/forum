#!/usr/bin/env node
// Activate the idle contracts (CapitalRouter, SlashMarket, SlashInsurance)
// so the leaderboard reflects real on-chain activity, not 0-everywhere.
//
// 1. CapitalRouter: approve + deposit $5 USDC, trigger rebalance into the
//    one target vault (CovenantVaultV1.2). Router TVL flips 0 -> $5.
// 2. SlashMarket: create a fresh market vs SlashBondV1.1 with 24h expiry,
//    then stake $2 YES on it.
// 3. SlashInsurance: approve + payPremium $2 into the pool.
//
// Self-user activation: turns 0-user contracts into 1-user with real
// positions. NOT external adoption — just removing the "0 users" overclaim.
//
// Run:
//   tsx keeper/scripts/activate-idle-contracts.mjs              # dry-run
//   tsx keeper/scripts/activate-idle-contracts.mjs --execute    # broadcast

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const KEY_PATH = process.env.FORUM_DEPLOYER_KEY ?? join(homedir(), ".forum-keys", "deployer.key");
const EXECUTE = process.argv.includes("--execute");

const ARC = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
const dep = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
const USDC = dep.constants?.usdc || "0x3600000000000000000000000000000000000000";
const ROUTER = dep.contracts.CapitalRouter.address;
const MARKET = dep.contracts.SlashMarket.address;
const INSURANCE = dep.contracts.SlashInsurance.address;
const BOND = dep.contracts.SlashBondV1_1.address;

const pk = readFileSync(KEY_PATH, "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const pub = createPublicClient({ chain: ARC, transport: http() });
const wallet = createWalletClient({ chain: ARC, transport: http(), account });

console.log("signer: " + account.address);
console.log("mode:   " + (EXECUTE ? "EXECUTE" : "DRY-RUN"));
console.log("");

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const usdcBal = await pub.readContract({
  address: USDC, abi: ERC20, functionName: "balanceOf", args: [account.address],
});
console.log("USDC balance: " + formatUnits(usdcBal, 6) + " USDC");

const ROUTER_ABI = parseAbi([
  "function deposit(uint256 amount) returns (uint256)",
  "function rebalance() returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function assets() view returns (uint256)",
]);
const SM_ABI = parseAbi([
  "function marketCount() view returns (uint256)",
  "function createMarket(address bond, uint64 expiryAt) returns (uint256)",
  "function stake(uint256 id, bool yesSide, uint256 amount)",
]);
const INS_ABI = parseAbi([
  "function payPremium(uint256 amount)",
  "function poolBalance() view returns (uint256)",
]);

const beforeRouterAssets = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "assets" });
const beforePool = await pub.readContract({ address: INSURANCE, abi: INS_ABI, functionName: "poolBalance" });
const beforeMarketCount = await pub.readContract({ address: MARKET, abi: SM_ABI, functionName: "marketCount" });
console.log("Router assets before: " + formatUnits(beforeRouterAssets, 6) + " USDC");
console.log("Insurance pool:       " + formatUnits(beforePool, 6) + " USDC");
console.log("SlashMarket markets:  " + beforeMarketCount);

const DEPOSIT_AMT = 5_000_000n;
const STAKE_AMT = 2_000_000n;
const PREMIUM_AMT = 2_000_000n;

if (!EXECUTE) {
  console.log("");
  console.log("would execute:");
  console.log("  CapitalRouter:    approve + deposit " + formatUnits(DEPOSIT_AMT, 6) + " USDC + rebalance()");
  console.log("  SlashMarket:      createMarket + stake " + formatUnits(STAKE_AMT, 6) + " USDC YES");
  console.log("  SlashInsurance:   approve + payPremium " + formatUnits(PREMIUM_AMT, 6) + " USDC");
  console.log("");
  console.log("re-run with --execute to broadcast all 3.");
  process.exit(0);
}

async function approveIfNeeded(spender, needed) {
  const cur = await pub.readContract({
    address: USDC, abi: ERC20, functionName: "allowance", args: [account.address, spender],
  });
  if (cur >= needed) return null;
  const tx = await wallet.writeContract({
    address: USDC, abi: ERC20, functionName: "approve", args: [spender, needed * 4n],
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  return tx;
}

// 1. CapitalRouter
console.log("\n--- CapitalRouter ---");
const a1 = await approveIfNeeded(ROUTER, DEPOSIT_AMT);
if (a1) console.log("approve tx: " + a1);
const depTx = await wallet.writeContract({
  address: ROUTER, abi: ROUTER_ABI, functionName: "deposit", args: [DEPOSIT_AMT],
});
const depRcpt = await pub.waitForTransactionReceipt({ hash: depTx });
console.log("deposit tx: " + depTx + " status=" + depRcpt.status);
const rebTx = await wallet.writeContract({
  address: ROUTER, abi: ROUTER_ABI, functionName: "rebalance", args: [],
});
const rebRcpt = await pub.waitForTransactionReceipt({ hash: rebTx });
console.log("rebalance tx: " + rebTx + " status=" + rebRcpt.status);
const afterRouterAssets = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "assets" });
console.log("router assets: " + formatUnits(beforeRouterAssets, 6) + " -> " + formatUnits(afterRouterAssets, 6) + " USDC");

// 2. SlashMarket
console.log("\n--- SlashMarket ---");
const a2 = await approveIfNeeded(MARKET, STAKE_AMT);
if (a2) console.log("approve tx: " + a2);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
const createTx = await wallet.writeContract({
  address: MARKET, abi: SM_ABI, functionName: "createMarket", args: [BOND, expiry],
});
const createRcpt = await pub.waitForTransactionReceipt({ hash: createTx });
console.log("createMarket tx: " + createTx + " status=" + createRcpt.status);
const newCount = await pub.readContract({ address: MARKET, abi: SM_ABI, functionName: "marketCount" });
const marketId = newCount - 1n;
console.log("new market id: " + marketId);
const stakeTx = await wallet.writeContract({
  address: MARKET, abi: SM_ABI, functionName: "stake", args: [marketId, true, STAKE_AMT],
});
const stakeRcpt = await pub.waitForTransactionReceipt({ hash: stakeTx });
console.log("stake YES tx: " + stakeTx + " status=" + stakeRcpt.status);

// 3. SlashInsurance
console.log("\n--- SlashInsurance ---");
const a3 = await approveIfNeeded(INSURANCE, PREMIUM_AMT);
if (a3) console.log("approve tx: " + a3);
const premTx = await wallet.writeContract({
  address: INSURANCE, abi: INS_ABI, functionName: "payPremium", args: [PREMIUM_AMT],
});
const premRcpt = await pub.waitForTransactionReceipt({ hash: premTx });
console.log("payPremium tx: " + premTx + " status=" + premRcpt.status);
const afterPool = await pub.readContract({ address: INSURANCE, abi: INS_ABI, functionName: "poolBalance" });
console.log("insurance pool: " + formatUnits(beforePool, 6) + " -> " + formatUnits(afterPool, 6) + " USDC");

console.log("\nACTIVATION COMPLETE.");
