#!/usr/bin/env node
// Deploy TrackRecordV2 to Arc testnet (sits alongside immutable v1).
// Then merge into deployments/arc-testnet.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

import solc from 'solc';
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});

const keyfile = join(homedir(), '.forum-keys', 'deployer.key');
if (!existsSync(keyfile)) { console.error('no key file'); process.exit(1); }
const pk = readFileSync(keyfile, 'utf8').trim();
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
console.log(`deployer: ${account.address}`);

const sources = {
  'TrackRecordV2.sol': { content: readFileSync('src/TrackRecordV2.sol', 'utf8') },
};
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
console.log(`compiling with solc ${solc.version()}...`);
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
  output.errors.forEach((e) => console.warn(e.formattedMessage));
}
const c = output.contracts['TrackRecordV2.sol']['TrackRecordV2'];
const abi = c.abi;
const bytecode = `0x${c.evm.bytecode.object}`;

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('deploying TrackRecordV2...');
const data = encodeDeployData({ abi, bytecode, args: [] });
const hash = await wal.sendTransaction({ data });
console.log(`  tx: ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') { console.error('reverted'); process.exit(1); }
console.log(`  TrackRecordV2 deployed at: ${receipt.contractAddress}`);
console.log(`  block: ${receipt.blockNumber}`);

const deployments = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
deployments.contracts.TrackRecordV2 = {
  address: receipt.contractAddress,
  txHash: hash,
  block: receipt.blockNumber.toString(),
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(deployments, null, 2) + '\n');
console.log('updated deployments/arc-testnet.json');
