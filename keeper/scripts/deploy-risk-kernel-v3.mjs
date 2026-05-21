#!/usr/bin/env node
// Deploy RiskKernelV3 to Arc testnet and prove it evaluates real vaults on-chain.
// RiskKernelV3 adds a persistent (un-spammable) drawdown peak + an on-chain NAV
// circuit breaker over RiskKernelV2. Read-only evaluate() works on any vault
// (V1 or V2) without rebinding; full enforce requires binding as the vault's
// riskKernel (covered by the Forge tests).

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import solc from "solc";
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
process.chdir(REPO_ROOT);
const ARC = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } });
const pk = readFileSync(join(homedir(), ".forum-keys", "deployer.key"), "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
const deployments = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));

const sources = {
  "CovenantVault.sol": { content: readFileSync("src/CovenantVault.sol", "utf8") },
  "RiskKernelV3.sol": { content: readFileSync("src/RiskKernelV3.sol", "utf8") },
};
function findImports(p) { const s = p.replace(/^\.\//, ""); return sources[s] ? { contents: sources[s].content } : { error: "not found " + p }; }
const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
console.log("compiling with solc", solc.version());
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
if (output.errors) { const fatal = output.errors.filter((e) => e.severity === "error"); if (fatal.length) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); } }
const k = output.contracts["RiskKernelV3.sol"]["RiskKernelV3"];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log("\ndeploying RiskKernelV3 ...");
const h = await wal.sendTransaction({ data: encodeDeployData({ abi: k.abi, bytecode: "0x" + k.evm.bytecode.object, args: [] }) });
const rcpt = await pub.waitForTransactionReceipt({ hash: h });
const K3 = rcpt.contractAddress;
console.log("RiskKernelV3:", K3);

const VERDICTS = ["ALLOW", "PAUSE_DRAWDOWN", "PAUSE_OVERSUBSCRIBED", "PAUSE_STALE", "PAUSE_EXPIRED", "PAUSE_NAV"];
const evalAbi = [{ type: "function", name: "evaluate", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }] }];
for (const name of ["CovenantVaultV1_2", "CovenantVaultV2"]) {
  const addr = deployments.contracts[name]?.address;
  if (!addr) continue;
  try {
    const v = await pub.readContract({ address: K3, abi: evalAbi, functionName: "evaluate", args: [addr] });
    console.log(`evaluate(${name} ${addr}) -> ${VERDICTS[Number(v)] ?? v}`);
  } catch (e) { console.log(`evaluate(${name}) -> ERROR ${(e.shortMessage || e.message).slice(0, 80)}`); }
}

deployments.contracts.RiskKernelV3 = { address: K3, txHash: h, block: rcpt.blockNumber.toString(),
  note: "Hardened risk engine: persistent monotonic drawdown peak (un-spammable, O(1)) + on-chain NAV circuit breaker (perSharePrice vs highWaterMark). Adds Verdict.PAUSE_NAV. Bind as a vault's riskKernel + bond attestor to enable enforce+slash." };
writeFileSync("deployments/arc-testnet.json", JSON.stringify(deployments, null, 2) + "\n");
console.log("\n=== RiskKernelV3 deployed + evaluated live ===", K3);
