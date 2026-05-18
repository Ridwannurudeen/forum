#!/usr/bin/env node
// Seed FeeRouterV1 with a demo split + tiny payIn so the contract has
// on-chain history. Uses the deployer's own address as all three demo
// recipients (operator + researcher + referrer) to avoid needing
// external wallets.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, '..', '..'));

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});
const pk = readFileSync(join(homedir(), '.forum-keys', 'deployer.key'), 'utf8').trim();
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const d = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));

const FRV = d.contracts.FeeRouterV1.address;
const USDC = d.usdc;

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

const ROUTER_ABI = parseAbi([
  'function splitCount() view returns (uint256)',
  'function createSplit(address[] recipients, uint16[] bps) returns (uint256)',
  'function pay(uint256 splitId, uint256 amount)',
]);
const USDC_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

const me = account.address;
const recipients = [me, me, me]; // self-routed demo
const bps = [6000, 3000, 1000];  // operator 60% / researcher 30% / referrer 10%

const beforeCount = await pub.readContract({ address: FRV, abi: ROUTER_ABI, functionName: 'splitCount' });
console.log(`splitCount before: ${beforeCount}`);

console.log(`createSplit(${recipients}, [6000,3000,1000]) ...`);
const tx1 = await wal.sendTransaction({
  to: FRV,
  data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'createSplit', args: [recipients, bps] }),
});
const r1 = await pub.waitForTransactionReceipt({ hash: tx1 });
console.log(`  tx: ${tx1}, status: ${r1.status}`);

const splitId = beforeCount; // new split id == count before
const amount = 1_000_000n;   // 1 USDC

console.log(`USDC.approve(FeeRouterV1, ${amount}) ...`);
const tx2 = await wal.sendTransaction({
  to: USDC,
  data: encodeFunctionData({ abi: USDC_ABI, functionName: 'approve', args: [FRV, amount] }),
});
await pub.waitForTransactionReceipt({ hash: tx2 });

console.log(`pay(splitId=${splitId}, amount=${amount}) ...`);
const tx3 = await wal.sendTransaction({
  to: FRV,
  data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'pay', args: [splitId, amount] }),
});
const r3 = await pub.waitForTransactionReceipt({ hash: tx3 });
console.log(`  tx: ${tx3}, status: ${r3.status}`);

console.log(`\nDemo split ${splitId} seeded with 1.000000 USDC.`);
console.log(`  recipient claimable: ${amount} (self-routed, all goes back to deployer)`);
