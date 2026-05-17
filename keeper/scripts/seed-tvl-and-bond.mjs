#!/usr/bin/env node
// A2: Seed live state for demo.
//   1. Deposit 1 USDC into ORIGINAL CovenantVault (v1)         → non-zero TVL on frontend
//   2. Bond  5 USDC into SlashBondV1.1                          → slash has something to grab
//   3. Deposit 1 USDC into CovenantVaultV1.1                    → v1.1 vault also live
//
// Idempotent: safely re-runnable; only acts on currently-zero state.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeFunctionData, parseAbi,
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

const USDC = d.usdc;
const VAULT_V1   = d.contracts.CovenantVault.address;
const VAULT_V11  = d.contracts.CovenantVaultV1_1.address;
const BOND_V11   = d.contracts.SlashBondV1_1.address;

const usdcAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const vaultAbi = parseAbi([
  'function deposit(uint256 amount)',
  'function assets() view returns (uint256)',
]);
const bondAbi = parseAbi([
  'function bond(uint256 amount)',
  'function bondBalance() view returns (uint256)',
]);

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

async function send(label, to, data) {
  const hash = await wal.sendTransaction({ to, data });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${label} → ${hash} (status=${rcpt.status})`);
  if (rcpt.status !== 'success') throw new Error(`${label} reverted`);
  return hash;
}

const bal = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [account.address] });
console.log(`deployer USDC balance: ${Number(bal) / 1e6} USDC`);

// 1) v1 vault TVL
console.log('\n1) v1 CovenantVault deposit (1 USDC)');
const tvlV1 = await pub.readContract({ address: VAULT_V1, abi: vaultAbi, functionName: 'assets' });
if (tvlV1 === 0n) {
  await send('approve', USDC, encodeFunctionData({ abi: usdcAbi, functionName: 'approve', args: [VAULT_V1, 1_000_000n] }));
  await send('deposit', VAULT_V1, encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [1_000_000n] }));
} else {
  console.log(`   skip — already at ${Number(tvlV1) / 1e6} USDC`);
}

// 2) v1.1 SlashBond seed (5 USDC)
console.log('\n2) SlashBondV1.1 bond (5 USDC)');
const bondBal = await pub.readContract({ address: BOND_V11, abi: bondAbi, functionName: 'bondBalance' });
if (bondBal === 0n) {
  await send('approve', USDC, encodeFunctionData({ abi: usdcAbi, functionName: 'approve', args: [BOND_V11, 5_000_000n] }));
  await send('bond', BOND_V11, encodeFunctionData({ abi: bondAbi, functionName: 'bond', args: [5_000_000n] }));
} else {
  console.log(`   skip — already at ${Number(bondBal) / 1e6} USDC`);
}

// 3) v1.1 vault TVL
console.log('\n3) v1.1 CovenantVault deposit (1 USDC)');
const tvlV11 = await pub.readContract({ address: VAULT_V11, abi: vaultAbi, functionName: 'assets' });
if (tvlV11 === 0n) {
  await send('approve', USDC, encodeFunctionData({ abi: usdcAbi, functionName: 'approve', args: [VAULT_V11, 1_000_000n] }));
  await send('deposit', VAULT_V11, encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [1_000_000n] }));
} else {
  console.log(`   skip — already at ${Number(tvlV11) / 1e6} USDC`);
}

const newBal = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [account.address] });
console.log(`\nfinal deployer USDC balance: ${Number(newBal) / 1e6} USDC`);
console.log('done.');
