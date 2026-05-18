#!/usr/bin/env node
// Deploy CapitalRouter to Arc testnet + set the initial strategy.
//
// Initial strategy: 100% weight to CovenantVaultV1.2 (the live AgoraMind
// vault). Strategist = deployer for v1 — this is a single-strategist demo,
// not a DAO-governed product. Operators wanting their own router fork the
// contract and deploy with their own strategist address.

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
  'CovenantVault.sol':  { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'CapitalRouter.sol':  { content: readFileSync('src/CapitalRouter.sol', 'utf8') },
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
const router = out.contracts['CapitalRouter.sol']['CapitalRouter'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('1) deploying CapitalRouter (strategist = deployer)...');
const deployHash = await wal.sendTransaction({
  data: encodeDeployData({ abi: router.abi, bytecode: '0x' + router.evm.bytecode.object, args: [d.usdc, account.address] }),
});
const deployRcpt = await pub.waitForTransactionReceipt({ hash: deployHash });
const ROUTER = deployRcpt.contractAddress;
console.log('   CapitalRouter:', ROUTER, 'tx:', deployHash);

const TARGET_VAULT = d.contracts.CovenantVaultV1_2.address;
console.log(`\n2) setStrategy([${TARGET_VAULT}], [10000]) — 100% to CovenantVaultV1.2`);
const setStratAbi = parseAbi([
  'function setStrategy(address[] vaults, uint16[] weightsBps)',
]);
const setHash = await wal.sendTransaction({
  to: ROUTER,
  data: encodeFunctionData({
    abi: setStratAbi, functionName: 'setStrategy',
    args: [[TARGET_VAULT], [10_000]],
  }),
});
const setRcpt = await pub.waitForTransactionReceipt({ hash: setHash });
console.log(`   tx: ${setHash} status=${setRcpt.status}`);

d.contracts.CapitalRouter = {
  address: ROUTER, txHash: deployHash, block: deployRcpt.blockNumber.toString(),
  strategist: account.address,
  initialStrategy: { vaults: [TARGET_VAULT], weightsBps: [10_000], setTx: setHash },
  note: 'Phase 5 allocator product. Pools USDC, routes to target vaults per strategist-set weights. Permissionless rebalance().',
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('\ndeployments/arc-testnet.json updated.');
