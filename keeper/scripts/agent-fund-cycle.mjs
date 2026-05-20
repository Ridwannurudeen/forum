#!/usr/bin/env node
// On-chain "Covenant-funded agent" loop — the honest, closeable portion of the
// funded-agent story:
//
//   funded CovenantVault  ->  AI decision (Claude/mock)  ->  agent draws BOUNDED
//   credit from its own Covenant Account (real on-chain pullCredit, sized by
//   conviction)  ->  returnCapital + crystalliseFee.
//
// This proves the agent can draw capital from its mandate on-chain and that the
// draw is bounded + accountable. It does NOT execute on Polymarket: Arc (testnet)
// USDC is not Polymarket pUSD, the pUSD mint needs Polymarket's deposit UI, and
// submission is geo-blocked — that cross-chain execution leg stays operator-gated
// (see docs/STATUS.md). So this is the on-chain funded-agent action, not a
// completed cross-chain trade.
//
// Run on VPS for the AgoraMind vault (operator = deployer):
//   cd /opt/forum/keeper && ./node_modules/.bin/tsx scripts/agent-fund-cycle.mjs
// For another vault you operate (e.g. your own factory vault), with YOUR key:
//   ./node_modules/.bin/tsx scripts/agent-fund-cycle.mjs --vault 0x<addr>

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));
const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { PolymarketReader } = await import(fileUrl("keeper/src/polymarket.ts"));
const { MockLlmProvider, AnthropicProvider } = await import(fileUrl("keeper/src/agora-mind.ts"));

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const dep = JSON.parse(readFileSync(`${process.cwd()}/deployments/arc-testnet.json`, "utf8"));
const VAULT = arg("--vault", dep.contracts.CovenantVaultV1_2.address);
const USDC = dep.usdc;
const PULL_CAP = BigInt(Math.round(Number(arg("--pull-cap-usdc", "2")) * 1e6)); // max to draw

const bridge = new ForumV2Bridge({
  deploymentPath: `${process.cwd()}/deployments/arc-testnet.json`,
  botLabel: "agent-fund-cycle",
  receiptsDir: "/tmp/forum-agent-fund",
  receiptsBaseUrl: "https://forum.gudman.xyz/receipts",
});
console.log("operator:", bridge.account.address, "\nvault:   ", VAULT);

const VAULT_ABI = [
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "availableCredit", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "operatorOutstanding", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mandate", stateMutability: "view", inputs: [], outputs: [
    { name: "operator", type: "address" }, { name: "botId", type: "bytes32" },
    { name: "budgetUsdc", type: "uint128" }, { name: "maxDrawdownBps", type: "uint16" },
    { name: "receiptFreshnessSec", type: "uint32" }, { name: "expiry", type: "uint64" },
    { name: "perfFeeBps", type: "uint16" }, { name: "bondContract", type: "address" },
    { name: "riskKernel", type: "address" }, { name: "trackRecordV2", type: "address" },
  ] },
  { type: "function", name: "pullCredit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "returnCapital", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "crystalliseFee", stateMutability: "nonpayable", inputs: [], outputs: [] },
];
const ERC20_APPROVE = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }];

const read = (name) => bridge.publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: name });
async function send(address, abi, functionName, args = []) {
  const hash = await bridge.walletClient.writeContract({ address, abi, functionName, args, chain: bridge.publicClient.chain });
  const r = await bridge.publicClient.waitForTransactionReceipt({ hash });
  return `${hash} (${r.status})`;
}
const usd = (x) => (Number(x) / 1e6).toFixed(6);

const state = Number(await read("state"));
if (state !== 0) { console.error(`vault not ACTIVE (state=${state}) — reactivate first`); process.exit(1); }
const m = await read("mandate");

// 1. AI decision on a live market.
const reader = new PolymarketReader();
const markets = await reader.discoverMarkets(1, 5000);
if (!markets.length) { console.error("no liquid market"); process.exit(1); }
const mk = markets[0];
const book = await reader.fetchBook(mk.yesToken);
const bid = PolymarketReader.bestBid(book), ask = PolymarketReader.bestAsk(book);
if (!bid || !ask) { console.error("empty book"); process.exit(1); }
const mid = (bid.price + ask.price) / 2;
const llm = process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : new MockLlmProvider();
const decision = await llm.decide({
  marketSlug: mk.slug, marketQuestion: mk.question,
  book: { bestBid: bid.price, bestAsk: ask.price, midprice: mid, bidDepth: bid.size, askDepth: ask.size },
  recentMidprices: [mid], inventory: 0, variance: 0,
  covenant: { budgetUsdc: Number(m.budgetUsdc ?? m[2] ?? 0) / 1e6, maxDrawdownBps: Number(m.maxDrawdownBps ?? m[3] ?? 0), vaultState: state },
  ts: Math.floor(Date.now() / 1000),
});
console.log(`\nAGENT DECISION (${decision.model}) on ${mk.slug}:`);
console.log(`  ${decision.action} · conviction ${decision.convictionPct}% · risk ${decision.riskPosture}`);
console.log(`  reasoning: ${(decision.reasoning || "").replace(/\s+/g, " ").slice(0, 200)}`);

if (decision.action === "HOLD" || decision.requestPause || decision.riskPosture === "halt") {
  console.log("\nAgent chose not to deploy capital (HOLD / self-governed pause). No credit drawn — that is the mandate working.");
  process.exit(0);
}

// 2. Draw bounded credit sized by conviction (capped by availableCredit + PULL_CAP).
const avail = await read("availableCredit");
let amount = (PULL_CAP * BigInt(Math.max(1, Math.min(100, decision.convictionPct)))) / 100n;
if (amount > avail) amount = avail;
if (amount <= 0n) { console.log("\nno available credit to draw"); process.exit(0); }
console.log(`\nbefore: outstanding=${usd(await read("operatorOutstanding"))} availableCredit=${usd(avail)}`);
console.log(`agent draws ${usd(amount)} USDC of bounded credit to act on its ${decision.action} (conviction-sized) ...`);
console.log("  pullCredit tx:", await send(VAULT, VAULT_ABI, "pullCredit", [amount]));
console.log(`  outstanding now: ${usd(await read("operatorOutstanding"))}`);

console.log("\n[venue execution is operator-gated: Arc USDC != Polymarket pUSD, pUSD mint needs Polymarket's deposit UI, submission geo-blocked — see docs/STATUS.md]");

// 3. Return capital + crystallise fee (round-trip; the pullCredit tx above is the on-chain proof).
console.log("\nreturnCapital + crystalliseFee ...");
console.log("  approve tx:", await send(USDC, ERC20_APPROVE, "approve", [VAULT, amount]));
console.log("  return  tx:", await send(VAULT, VAULT_ABI, "returnCapital", [amount]));
console.log("  fee     tx:", await send(VAULT, VAULT_ABI, "crystalliseFee", []));
console.log(`\nafter: outstanding=${usd(await read("operatorOutstanding"))}`);
console.log("\nDONE — on-chain funded-agent loop: decision -> bounded credit draw -> return. Venue execution stays operator-gated (honest).");
