#!/usr/bin/env node
// Revive CovenantVaultV1.2 (PAUSED from the demo) + seed 1 USDC TVL so the
// "Live mandate" tile on https://forum.gudman.xyz/ shows ACTIVE + non-zero TVL.
//
// Idempotent: no-op if already ACTIVE or already has TVL.

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

const USDC   = d.usdc;
const VAULT  = d.contracts.CovenantVaultV1_2.address;
const KERNEL = d.contracts.RiskKernelV2.address;

const usdcAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
]);
const vaultAbi = parseAbi([
  'function deposit(uint256 amount)',
  'function state() view returns (uint8)',
  'function assets() view returns (uint256)',
]);
const kernelAbi = parseAbi([
  'function evaluate(address vault) view returns (uint8)',
  'function enforce(address vault)',
]);

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

async function send(label, to, data) {
  const hash = await wal.sendTransaction({ to, data });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${label} -> ${hash} (status=${rcpt.status})`);
  if (rcpt.status !== 'success') throw new Error(`${label} reverted`);
  return hash;
}

const [state0, assets0, verdict0] = await Promise.all([
  pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'state' }),
  pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'assets' }),
  pub.readContract({ address: KERNEL, abi: kernelAbi, functionName: 'evaluate', args: [VAULT] }),
]);
const STATE = ['ACTIVE', 'PAUSED'];
const VERDICT = ['ALLOW', 'PAUSE_DRAWDOWN', 'PAUSE_OVERSUBSCRIBED', 'PAUSE_STALE', 'PAUSE_EXPIRED'];
console.log('BEFORE');
console.log('  state:        ', STATE[state0]);
console.log('  assets:       ', (Number(assets0) / 1e6).toFixed(6), 'USDC');
console.log('  verdict:      ', VERDICT[verdict0]);

// Step 1: revive via enforce() if PAUSED and verdict ALLOW
if (state0 !== 0 /* not ACTIVE */) {
  if (verdict0 !== 0 /* not ALLOW */) {
    console.error(`\nCannot revive: vault is ${STATE[state0]} but verdict is ${VERDICT[verdict0]}.`);
    console.error('Wait for the keeper to publish a fresh receipt + re-run.');
    process.exit(1);
  }
  console.log('\n1) reviving via RiskKernelV2.enforce(vault)');
  await send('enforce', KERNEL, encodeFunctionData({
    abi: kernelAbi, functionName: 'enforce', args: [VAULT],
  }));
} else {
  console.log('\n1) skip revive - vault already ACTIVE');
}

// Step 2: deposit 1 USDC if TVL == 0
if (assets0 === 0n) {
  console.log('\n2) seeding 1 USDC TVL');
  await send('approve', USDC, encodeFunctionData({
    abi: usdcAbi, functionName: 'approve', args: [VAULT, 1_000_000n],
  }));
  await send('deposit', VAULT, encodeFunctionData({
    abi: vaultAbi, functionName: 'deposit', args: [1_000_000n],
  }));
} else {
  console.log('\n2) skip deposit - vault already has', (Number(assets0) / 1e6).toFixed(6), 'USDC');
}

const [state1, assets1] = await Promise.all([
  pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'state' }),
  pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'assets' }),
]);
console.log('\nAFTER');
console.log('  state:        ', STATE[state1]);
console.log('  assets:       ', (Number(assets1) / 1e6).toFixed(6), 'USDC');
