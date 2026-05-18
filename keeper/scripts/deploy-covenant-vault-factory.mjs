#!/usr/bin/env node
// Deploy CovenantVaultFactory to Arc testnet.
// Self-serve creation of Covenant Accounts — Phase 1 keystone.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import solc from 'solc';
import {
  createPublicClient, createWalletClient, defineChain, http, encodeDeployData,
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

const sources = {
  'CovenantVault.sol':         { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'CovenantVaultFactory.sol':  { content: readFileSync('src/CovenantVaultFactory.sol', 'utf8') },
};
function findImports(p) {
  const s = p.replace(/^\.\//, '');
  if (sources[s]) return { contents: sources[s].content };
  return { error: 'not found: ' + p };
}
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}), { import: findImports }));
if (out.errors) {
  const fatal = out.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const factory = out.contracts['CovenantVaultFactory.sol']['CovenantVaultFactory'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('deploying CovenantVaultFactory...');
const hash = await wal.sendTransaction({
  data: encodeDeployData({ abi: factory.abi, bytecode: '0x' + factory.evm.bytecode.object, args: [d.usdc] }),
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
const FACTORY = rcpt.contractAddress;
console.log('CovenantVaultFactory:', FACTORY);

d.contracts.CovenantVaultFactory = {
  address: FACTORY, txHash: hash, block: rcpt.blockNumber.toString(),
  note: 'Self-serve creation of Covenant Accounts. Anyone can call createVault(mandate) and get a fresh CovenantVault. USDC pinned at factory deploy time. Emits VaultCreated for indexer subscription.',
};

writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('deployments JSON updated. Done.');
