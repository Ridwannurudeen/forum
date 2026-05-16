#!/usr/bin/env node
// End-to-end smoke: claim a builder code on the live BuilderCodeRegistry
// using the deployer key + the deployed addresses. Proves the full stack
// (Arc RPC + key + viem + contract ABI + deployed bytecode) works together.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

const deployment = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
const REG = deployment.contracts.BuilderCodeRegistry.address;

const ARC = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});

const pk = readFileSync(join(homedir(), '.forum-keys', 'deployer.key'), 'utf8').trim();
const acct = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

const code = keccak256(toHex('forum-genesis-code'));
console.log(`Builder code: ${code}`);
console.log(`Registry:     ${REG}`);
console.log(`Caller:       ${acct.address}`);

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account: acct });

const READ = { type: 'function', name: 'ownerOf', stateMutability: 'view',
                inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] };
const CLAIM = { type: 'function', name: 'claim', stateMutability: 'nonpayable',
                inputs: [{ type: 'bytes32' }], outputs: [] };

const before = await pub.readContract({ address: REG, abi: [READ], functionName: 'ownerOf', args: [code] });
console.log(`\nBefore claim, owner: ${before}`);

if (before.toLowerCase() === acct.address.toLowerCase()) {
  console.log('Already claimed by us, skipping write');
} else if (before !== '0x0000000000000000000000000000000000000000') {
  console.log('Already claimed by someone else, skipping write');
} else {
  const hash = await wal.writeContract({ address: REG, abi: [CLAIM], functionName: 'claim', args: [code] });
  console.log(`Claim tx: ${hash}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  block ${rcpt.blockNumber}  status ${rcpt.status}`);
}

const after = await pub.readContract({ address: REG, abi: [READ], functionName: 'ownerOf', args: [code] });
console.log(`After claim, owner:  ${after}`);

if (after.toLowerCase() === acct.address.toLowerCase()) {
  console.log('\nSMOKE PASSED — end-to-end claim works on live Arc testnet');
} else {
  console.error('\nSMOKE FAILED — owner does not match caller');
  process.exit(1);
}
