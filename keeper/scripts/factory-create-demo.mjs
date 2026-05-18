#!/usr/bin/env node
// End-to-end smoke for CovenantVaultFactory.createVault().
//
// Calls factory.createVault(mandate) with the deployer as creator+operator
// and a fresh per-run botId. Prints the new vault address; the indexer
// should pick it up within ~30s (next VaultCreated event poll).

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeFunctionData, parseAbi, keccak256, toHex,
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

const FACTORY = d.contracts.CovenantVaultFactory.address;
const KERNEL = d.contracts.RiskKernelV2.address;
const BOND = d.contracts.SlashBondV1_1.address;
const TRV2 = d.contracts.TrackRecordV2.address;

const factoryAbi = [{
  type: 'function',
  name: 'createVault',
  stateMutability: 'nonpayable',
  inputs: [{
    name: 'm',
    type: 'tuple',
    components: [
      { name: 'operator', type: 'address' },
      { name: 'botId', type: 'bytes32' },
      { name: 'budgetUsdc', type: 'uint128' },
      { name: 'maxDrawdownBps', type: 'uint16' },
      { name: 'receiptFreshnessSec', type: 'uint32' },
      { name: 'expiry', type: 'uint64' },
      { name: 'perfFeeBps', type: 'uint16' },
      { name: 'bondContract', type: 'address' },
      { name: 'riskKernel', type: 'address' },
      { name: 'trackRecordV2', type: 'address' },
    ],
  }],
  outputs: [{ type: 'address' }],
}];
const factoryReadAbi = parseAbi(['function vaultCount() view returns (uint256)']);

const botLabel = `factory-smoke-${Date.now()}`;
const botId = keccak256(toHex(`${account.address.toLowerCase()}:${botLabel}`));

const mandate = {
  operator: account.address,
  botId,
  budgetUsdc: 100_000_000n, // 100 USDC
  maxDrawdownBps: 1000,     // 10%
  receiptFreshnessSec: 3600,
  expiry: 0n,
  perfFeeBps: 2_000,
  bondContract: BOND,
  riskKernel: KERNEL,
  trackRecordV2: TRV2,
};

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

const beforeCount = await pub.readContract({
  address: FACTORY, abi: factoryReadAbi, functionName: 'vaultCount',
});
console.log(`factory: ${FACTORY}`);
console.log(`vault count BEFORE: ${beforeCount}`);
console.log(`botId: ${botId}`);
console.log(`botLabel: ${botLabel}`);

console.log('\ncalling factory.createVault(mandate) ...');
const hash = await wal.sendTransaction({
  to: FACTORY,
  data: encodeFunctionData({ abi: factoryAbi, functionName: 'createVault', args: [mandate] }),
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
if (rcpt.status !== 'success') {
  console.error('createVault reverted:', hash);
  process.exit(1);
}

const afterCount = await pub.readContract({
  address: FACTORY, abi: factoryReadAbi, functionName: 'vaultCount',
});

// The factory's allVaults() lets us pull the newly-deployed vault address
const allVaultsAbi = parseAbi(['function allVaults() view returns (address[])']);
const all = await pub.readContract({
  address: FACTORY, abi: allVaultsAbi, functionName: 'allVaults',
});
const newVault = all[all.length - 1];

console.log(`\ntx: ${hash}`);
console.log(`gas used: ${rcpt.gasUsed}`);
console.log(`vault count AFTER: ${afterCount}`);
console.log(`new vault address: ${newVault}`);
console.log(`\nVerify in indexer (~30s):`);
console.log(`  curl https://forum.gudman.xyz/api/factory-vaults | head -c 500`);
console.log(`  curl https://forum.gudman.xyz/api/covenant/${newVault}`);
