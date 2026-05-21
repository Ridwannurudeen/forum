#!/usr/bin/env node
// Vault-custodied strategy cycle on CovenantVaultV2 — the capstone loop where the
// agent puts vault funds to work WITHOUT ever holding them, and the resulting
// yield is recomputable on-chain.
//
//   seed idle USDC -> agent deployToStrategy (vault -> adapter, NOT operator) ->
//   recallFromStrategy (adapter -> vault, ± yield) -> crystalliseFee ->
//   publish a receipt carrying strategyLegs (deployed/recovered + deploy/recall
//   tx refs) that verify-receipt + recomputeRecallPnl can check from chain.
//
// Unlike agent-yield-cycle.mjs (V1 pullCredit -> operator -> off-chain venue),
// here the capital is custodied by the vault/adapter the whole time. The treasury
// brain (Claude/mock) provides the posture + reasoning.
//
// Usage (repo root, ~/.forum-keys/deployer.key, operator == V2 operator+governor):
//   ./keeper/node_modules/.bin/tsx keeper/scripts/agent-strategy-cycle.mjs --amount 1 --publish
// Flags: --amount <usdc> (default 1), --keep (leave funds in vault), --dry-run, --publish

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { keccak256, toHex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));
const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt, strategyRealizedMicros } = await import(fileUrl("keeper/src/receipt.ts"));
const { decodeRecalls } = await import(fileUrl("keeper/src/strategy-onchain.ts"));
const { MockTreasuryProvider, AnthropicTreasuryProvider } = await import(fileUrl("keeper/src/treasury-mind.ts"));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const dep = JSON.parse(readFileSync(`${process.cwd()}/deployments/arc-testnet.json`, "utf8"));
const VAULT = dep.contracts.CovenantVaultV2.address;
const ADAPTER = dep.contracts.IdleStrategyAdapter.address;
const USDC = dep.usdc;
const AMOUNT = BigInt(Math.round(Number(arg("--amount", "1")) * 1e6));
const DRY = has("--dry-run");
const PUBLISH = has("--publish");
const KEEP = has("--keep");

const bridge = new ForumV2Bridge({
  deploymentPath: `${process.cwd()}/deployments/arc-testnet.json`,
  botLabel: "strategy-agent-v1",
  receiptsDir: "/tmp/forum-strategy-agent",
  receiptsBaseUrl: "https://forum.gudman.xyz/receipts",
});
const OPERATOR = bridge.account.address;
console.log("operator:", OPERATOR, "\nvaultV2: ", VAULT, "\nadapter: ", ADAPTER, DRY ? "(dry-run)" : "");

const V2_ABI = [
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "depositTotalIdle", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "strategyDeployed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sharesOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mandate", stateMutability: "view", inputs: [], outputs: [
    { type: "address" }, { type: "bytes32" }, { type: "uint128" }, { type: "uint16" }, { type: "uint32" },
    { type: "uint64" }, { type: "uint16" }, { type: "address" }, { type: "address" }, { type: "address" } ] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deployToStrategy", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "recallFromStrategy", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "crystalliseFee", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
];
const ERC20_APPROVE = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }];
const read = (name, args = []) => bridge.publicClient.readContract({ address: VAULT, abi: V2_ABI, functionName: name, args });
const usd = (x) => (Number(x) / 1e6).toFixed(6);
async function send(address, abi, fn, args = []) {
  const hash = await bridge.walletClient.writeContract({ address, abi, functionName: fn, args, chain: bridge.publicClient.chain });
  const r = await bridge.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} reverted: ${hash}`);
  return { hash, receipt: r };
}

const MAX_UINT = (1n << 256n) - 1n;
const state = Number(await read("state"));
if (state !== 0) { console.error(`V2 vault not ACTIVE (state=${state})`); process.exit(1); }

// Treasury posture + reasoning (idle adapter is the allowlist-free venue today).
const m = await read("mandate");
const provider = process.env.ANTHROPIC_API_KEY ? new AnthropicTreasuryProvider() : new MockTreasuryProvider();
const decision = await provider.decide({
  availableCreditUsdc: Number(AMOUNT) / 1e6,
  budgetUsdc: Number(m[2] ?? 0) / 1e6,
  maxDrawdownBps: Number(m[3] ?? 0),
  vaultState: state,
  venues: [{ name: "idle-strategy", kind: "idle", available: true, reason: "allowlisted vault-custodied adapter" }],
  ts: Math.floor(Date.now() / 1000),
});
console.log(`\nTREASURY DECISION (${decision.model}): posture=${decision.riskPosture} conviction=${decision.convictionPct}%`);
if (decision.riskPosture === "halt" || decision.requestPause) { console.log("agent self-governed halt — no deployment."); process.exit(0); }

console.log(`plan: deposit ${usd(AMOUNT)} -> deployToStrategy(adapter) -> recall -> crystalliseFee${KEEP ? "" : " -> withdraw"}${PUBLISH ? " -> publish strategyLegs receipt" : ""}`);
if (DRY) { console.log("\n--- DRY RUN (no writes) ---"); process.exit(0); }

// 1. Seed idle, 2. deploy into the strategy (vault -> adapter), 3. recall.
console.log("\n1) approve+deposit:", (await send(USDC, ERC20_APPROVE, "approve", [VAULT, AMOUNT])).hash.slice(0, 12) + "…", "/", (await send(VAULT, V2_ABI, "deposit", [AMOUNT])).hash.slice(0, 12) + "…");
const opBefore = await bridge.publicClient.readContract({ address: USDC, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [OPERATOR] });
const deployRes = await send(VAULT, V2_ABI, "deployToStrategy", [ADAPTER, AMOUNT]);
console.log("2) deployToStrategy:", deployRes.hash);
const adapterBal = await bridge.publicClient.readContract({ address: USDC, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [ADAPTER] });
console.log(`   -> USDC in adapter=${usd(adapterBal)} strategyDeployed=${usd(await read("strategyDeployed"))} (custody = vault/adapter, not operator)`);
const recallRes = await send(VAULT, V2_ABI, "recallFromStrategy", [ADAPTER, MAX_UINT]);
console.log("3) recallFromStrategy:", recallRes.hash);

// Recovered, recomputed from the RecalledFromStrategy event (on-chain truth).
const recalls = decodeRecalls(recallRes.receipt.logs);
const recovered = recalls.reduce((s, r) => s + r.recoveredMicros, 0n);
const realized = recovered - AMOUNT;
console.log(`   -> recovered=${usd(recovered)} realized PnL=${usd(realized)} (idle => 0; USYC adapter would carry yield)`);

console.log("4) crystalliseFee:", (await send(VAULT, V2_ABI, "crystalliseFee", [])).hash.slice(0, 12) + "…");
if (!KEEP) {
  const shares = await read("sharesOf", [OPERATOR]);
  if (shares > 0n) console.log("5) withdraw (non-destructive):", (await send(VAULT, V2_ABI, "withdraw", [shares])).hash.slice(0, 12) + "…");
}

if (PUBLISH) {
  console.log("\npublishing strategyLegs receipt ...");
  await bridge.ensureRegistered(3);
  const seq = (await bridge.lastSeq()) + 1;
  const prevHash = await bridge.lastRecordHash();
  const now = Math.floor(Date.now() / 1000);
  const reasoning = decision.reasoning + `\nVault-custodied: deployToStrategy ${deployRes.hash}, recall ${recallRes.hash}.`;
  const receipt = buildReceipt({
    botId: bridge.botId, seq, periodStart: now - 60, periodEnd: now,
    markets: ["idle-strategy"], bookSnapshots: [], fills: [], inventory: [],
    pnl: { realizedUsdc: 0, unrealizedUsdc: 0, makerRebatesUsdc: 0, totalUsdcMicros: Number(realized), formulaVersion: "v1" },
    strategy: { name: "strategy-agent-v1", configHash: keccak256(toHex("strategy:idle")) },
    decisionTrace: { traceUri: "", traceHash: keccak256(toHex(reasoning)) },
    strategyLegs: [{ adapter: ADAPTER, deployedMicros: Number(AMOUNT), recoveredMicros: Number(recovered), deployTx: deployRes.hash, recallTx: recallRes.hash }],
  });
  const { uri, hash } = bridge.writeReceipt(seq, receipt);
  const { txHash } = await bridge.publishRecordAwait({
    seq, periodStart: now - 60, periodEnd: now, pnlMicros: BigInt(realized), fills: 0,
    metaHash: keccak256(toHex(`strategy-cycle;seq=${seq}`)), evidenceUri: uri, evidenceHash: hash, prevRecordHash: prevHash,
  }, 3);
  console.log(`   receipt seq=${seq} uri=${uri}\n   publish tx=${txHash}`);
  console.log(`   localReceipt=${bridge.botId.slice(2, 14)}/${String(seq).padStart(6, "0")}.json`);
}
console.log(`\nDONE — vault-custodied strategy cycle on CovenantVaultV2. realized=${usd(realized)} USDC`);
