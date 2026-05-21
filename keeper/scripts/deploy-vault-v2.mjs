#!/usr/bin/env node
// Deploy CovenantVaultV2 (vault-custodied strategy) + IdleStrategyAdapter to Arc
// testnet, allowlist the adapter, and run an on-chain custody-flow proof:
//   deposit -> deployToStrategy (USDC -> ADAPTER, not operator) -> recall -> withdraw.
//
// Mirrors deploy-v11.mjs: solc standard-JSON compile + viem deploy. Uses the
// existing RiskKernelV2 + SlashBondV1_1 + TrackRecordV2 from the deployment file.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import solc from "solc";
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
process.chdir(REPO_ROOT);

const ARC = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
const pk = readFileSync(join(homedir(), ".forum-keys", "deployer.key"), "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const deployments = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
const USDC = deployments.usdc;
const TRV2 = deployments.contracts.TrackRecordV2.address;
const K2 = deployments.contracts.RiskKernelV2.address;
const BOND = deployments.contracts.SlashBondV1_1.address;
const BOT_ID = keccak256(toHex("forum-covenant-vault-v2"));

const sources = {
  "CovenantVault.sol": { content: readFileSync("src/CovenantVault.sol", "utf8") },
  "IStrategyAdapter.sol": { content: readFileSync("src/IStrategyAdapter.sol", "utf8") },
  "CovenantVaultV2.sol": { content: readFileSync("src/CovenantVaultV2.sol", "utf8") },
  "IdleStrategyAdapter.sol": { content: readFileSync("src/IdleStrategyAdapter.sol", "utf8") },
};
function findImports(p) {
  const s = p.replace(/^\.\//, "");
  if (sources[s]) return { contents: sources[s].content };
  return { error: "File not found: " + p };
}
const input = { language: "Solidity", sources, settings: {
  optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
console.log("compiling with solc", solc.version());
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  if (fatal.length) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const cv2 = output.contracts["CovenantVaultV2.sol"]["CovenantVaultV2"];
const idle = output.contracts["IdleStrategyAdapter.sol"]["IdleStrategyAdapter"];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });
const send = async (req) => { const h = await wal.writeContract(req); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== "success") throw new Error("revert " + h); return h; };
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const usd = (x) => (Number(x) / 1e6).toFixed(6);
const ERC20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

const mandate = { operator: account.address, botId: BOT_ID, budgetUsdc: 200_000_000n, maxDrawdownBps: 500,
  receiptFreshnessSec: 1800, expiry: 0n, perfFeeBps: 2_000, bondContract: BOND, riskKernel: K2, trackRecordV2: TRV2 };

console.log("\n1) deploying CovenantVaultV2 (governor = operator = deployer) ...");
const vHash = await wal.sendTransaction({ data: encodeDeployData({ abi: cv2.abi, bytecode: "0x" + cv2.evm.bytecode.object, args: [USDC, mandate, account.address] }) });
const vRcpt = await pub.waitForTransactionReceipt({ hash: vHash });
const VAULT = vRcpt.contractAddress;
console.log("   CovenantVaultV2:", VAULT);

console.log("\n2) deploying IdleStrategyAdapter(usdc, vault) ...");
const aHash = await wal.sendTransaction({ data: encodeDeployData({ abi: idle.abi, bytecode: "0x" + idle.evm.bytecode.object, args: [USDC, VAULT] }) });
const aRcpt = await pub.waitForTransactionReceipt({ hash: aHash });
const ADAPTER = aRcpt.contractAddress;
console.log("   IdleStrategyAdapter:", ADAPTER);

console.log("\n3) governor.setStrategyAllowed(idle, true) ...");
console.log("   tx:", await send({ address: VAULT, abi: cv2.abi, functionName: "setStrategyAllowed", args: [ADAPTER, true], chain: ARC }));

console.log("\n4) ON-CHAIN CUSTODY PROOF");
const opStart = await read(USDC, ERC20, "balanceOf", [account.address]);
console.log("   approve+deposit 2 USDC ->", await send({ address: USDC, abi: ERC20, functionName: "approve", args: [VAULT, 2_000_000n], chain: ARC }), "/", await send({ address: VAULT, abi: cv2.abi, functionName: "deposit", args: [2_000_000n], chain: ARC }));
console.log("   deployToStrategy(idle, 1 USDC) ->", await send({ address: VAULT, abi: cv2.abi, functionName: "deployToStrategy", args: [ADAPTER, 1_000_000n], chain: ARC }));
const adapterBal = await read(USDC, ERC20, "balanceOf", [ADAPTER]);
const opMid = await read(USDC, ERC20, "balanceOf", [account.address]);
console.log(`   -> USDC in ADAPTER=${usd(adapterBal)} (custody is the adapter, NOT the operator)`);
console.log(`   -> strategyDeployed=${usd(await read(VAULT, cv2.abi, "strategyDeployed"))} idle=${usd(await read(VAULT, cv2.abi, "depositTotalIdle"))} assets=${usd(await read(VAULT, cv2.abi, "assets"))}`);
console.log(`   -> operator USDC delta during deploy: ${usd(opMid - opStart)} (deposit -2, no credit to operator)`);
console.log("   recallFromStrategy(idle, max) ->", await send({ address: VAULT, abi: cv2.abi, functionName: "recallFromStrategy", args: [ADAPTER, (1n << 256n) - 1n], chain: ARC }));
console.log(`   -> after recall: strategyDeployed=${usd(await read(VAULT, cv2.abi, "strategyDeployed"))} idle=${usd(await read(VAULT, cv2.abi, "depositTotalIdle"))} adapterBal=${usd(await read(USDC, ERC20, "balanceOf", [ADAPTER]))}`);
const shares = await read(VAULT, cv2.abi, "sharesOf", [account.address]);
console.log("   withdraw all shares (non-destructive) ->", await send({ address: VAULT, abi: cv2.abi, functionName: "withdraw", args: [shares], chain: ARC }));
console.log(`   -> operator USDC restored: delta ${usd((await read(USDC, ERC20, "balanceOf", [account.address])) - opStart)}`);

deployments.contracts.CovenantVaultV2 = { address: VAULT, txHash: vHash, block: vRcpt.blockNumber.toString(),
  governor: account.address,
  mandate: { operator: account.address, botId: BOT_ID, budgetUsdc: "200000000", maxDrawdownBps: 500, receiptFreshnessSec: 1800, expiry: "0", perfFeeBps: 2000, bondContract: BOND, riskKernel: K2, trackRecordV2: TRV2 },
  note: "V2 = vault-custodied strategy deployment. governor curates the adapter allowlist; operator deploys credit into approved adapters only; funds move vault->adapter, never through the operator." };
deployments.contracts.IdleStrategyAdapter = { address: ADAPTER, txHash: aHash, block: aRcpt.blockNumber.toString(),
  vault: VAULT, note: "Zero-yield strategy adapter (allowlist-free). Proves the deploy/recall custody path; USYC adapter is the real-yield variant pending Entitlements allowlist." };
writeFileSync("deployments/arc-testnet.json", JSON.stringify(deployments, null, 2) + "\n");
console.log("\n=== V2 DEPLOYED + custody flow proven on Arc ===\nCovenantVaultV2:", VAULT, "\nIdleStrategyAdapter:", ADAPTER);
