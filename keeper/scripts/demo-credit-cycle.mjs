#!/usr/bin/env node
// Exercise the CovenantVault operator credit surface end-to-end:
//   pullCredit -> (agent operates) -> returnCapital -> crystalliseFee,
// leaving a small outstanding balance so the active drawn credit line is
// visible on /api/covenant.
//
// HONEST SCOPE: this proves the credit-line PRIMITIVE works on-chain — the
// operator draws bounded credit within the mandate (capped by budget AND idle
// liquidity), returns it, and the perf-fee crystallises. It does NOT fund a
// real Polymarket trade: Arc vault USDC is not Polymarket pUSD, so cross-chain
// capital routing (CCTP -> pUSD deposit) is the deferred piece. This is a
// first-party demo: operator == depositor == deployer.
//
// Run on VPS:
//   cd /opt/forum/keeper && ./node_modules/.bin/tsx scripts/demo-credit-cycle.mjs

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));
const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));

const dep = JSON.parse(
  readFileSync(`${process.cwd()}/deployments/arc-testnet.json`, "utf8"),
);
const VAULT = dep.contracts.CovenantVaultV1_2.address;
const USDC = dep.usdc;

const PULL = 2_000_000n; // draw 2 USDC of credit
const RETURN = 1_000_000n; // return 1, leave 1 USDC outstanding (active line)

const bridge = new ForumV2Bridge({
  deploymentPath: `${process.cwd()}/deployments/arc-testnet.json`,
  botLabel: "demo-credit-cycle",
  receiptsDir: "/tmp/forum-credit-demo",
  receiptsBaseUrl: "https://forum.gudman.xyz/receipts",
});
console.log("operator:", bridge.account.address);
console.log("vault:   ", VAULT);
console.log("usdc:    ", USDC);

const VAULT_ABI = [
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "availableCredit", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "operatorOutstanding", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "depositTotalIdle", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pullCredit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "returnCapital", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "crystalliseFee", stateMutability: "nonpayable", inputs: [], outputs: [] },
];
const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const read = (name) =>
  bridge.publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: name });
async function send(address, abi, functionName, args = []) {
  const hash = await bridge.walletClient.writeContract({
    address, abi, functionName, args, chain: bridge.publicClient.chain,
  });
  const rcpt = await bridge.publicClient.waitForTransactionReceipt({ hash });
  return `${hash} (${rcpt.status})`;
}
const usd = (x) => (Number(x) / 1e6).toFixed(6);

const state = Number(await read("state"));
if (state !== 0) {
  console.error(`vault not ACTIVE (state=${state}) — run agora-mind-recover.mjs first`);
  process.exit(1);
}
console.log(
  `\nbefore: idle=${usd(await read("depositTotalIdle"))} outstanding=${usd(await read("operatorOutstanding"))} availableCredit=${usd(await read("availableCredit"))}`,
);

const avail = await read("availableCredit");
if (avail < PULL) {
  console.error(`available credit ${usd(avail)} < pull ${usd(PULL)} — fund the vault first`);
  process.exit(1);
}

console.log(`\npullCredit(${usd(PULL)}) ...`);
console.log("  tx:", await send(VAULT, VAULT_ABI, "pullCredit", [PULL]));
console.log(`  operatorOutstanding now: ${usd(await read("operatorOutstanding"))}`);

console.log("\n[agent operates against drawn credit — paper; no real venue trade]");

console.log(`\napprove(vault, ${usd(RETURN)}) + returnCapital(${usd(RETURN)}) ...`);
console.log("  approve tx:", await send(USDC, ERC20_ABI, "approve", [VAULT, RETURN]));
console.log("  return  tx:", await send(VAULT, VAULT_ABI, "returnCapital", [RETURN]));
console.log(`  operatorOutstanding now: ${usd(await read("operatorOutstanding"))}`);

console.log("\ncrystalliseFee() ...");
console.log("  tx:", await send(VAULT, VAULT_ABI, "crystalliseFee", []));

console.log(
  `\nafter: idle=${usd(await read("depositTotalIdle"))} outstanding=${usd(await read("operatorOutstanding"))} availableCredit=${usd(await read("availableCredit"))}`,
);
console.log("\nDONE — credit-line primitive exercised end-to-end. Outstanding > 0 = active drawn credit (first-party demo).");
