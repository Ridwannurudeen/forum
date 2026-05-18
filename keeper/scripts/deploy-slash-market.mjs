#!/usr/bin/env node
// Deploy SlashMarket + create an initial 24h market against SlashBondV1.1.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import solc from 'solc';
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeDeployData, encodeFunctionData, parseAbi,
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
  'CovenantVault.sol': { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'SlashMarket.sol':   { content: readFileSync('src/SlashMarket.sol', 'utf8') },
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
const sm = out.contracts['SlashMarket.sol']['SlashMarket'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('1) deploying SlashMarket...');
const deployHash = await wal.sendTransaction({
  data: encodeDeployData({ abi: sm.abi, bytecode: '0x' + sm.evm.bytecode.object, args: [d.usdc] }),
});
const deployRcpt = await pub.waitForTransactionReceipt({ hash: deployHash });
const MARKET = deployRcpt.contractAddress;
console.log('   SlashMarket:', MARKET, 'tx:', deployHash);

const BOND = d.contracts.SlashBondV1_1.address;
const now = Math.floor(Date.now() / 1000);
const expiry = now + 86400; // 24h window
console.log(`\n2) createMarket(${BOND}, expiry=${expiry}) — 24h window`);
const createAbi = parseAbi(['function createMarket(address bond, uint64 expiryAt) returns (uint256)']);
const createHash = await wal.sendTransaction({
  to: MARKET,
  data: encodeFunctionData({ abi: createAbi, functionName: 'createMarket', args: [BOND, BigInt(expiry)] }),
});
const createRcpt = await pub.waitForTransactionReceipt({ hash: createHash });
console.log(`   tx: ${createHash} status=${createRcpt.status}`);

d.contracts.SlashMarket = {
  address: MARKET, txHash: deployHash, block: deployRcpt.blockNumber.toString(),
  initialMarket: { bond: BOND, expiryAt: expiry, createTx: createHash },
  note: 'Phase 9 Risk Markets v0. Per-bond binary prediction market: "will this SlashBond have a slash event before expiry?" Oracle-free: reads SlashBond.totalSlashed delta at settle.',
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('\ndeployments JSON updated.');
