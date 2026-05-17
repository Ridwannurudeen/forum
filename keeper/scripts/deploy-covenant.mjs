#!/usr/bin/env node
// Deploy RiskKernel first (parameter-less), then CovenantVault bound to the
// VPS keeper bot + the existing TrackRecordV2 + the freshly-deployed kernel.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import solc from 'solc';
import { createPublicClient, createWalletClient, defineChain, http, encodeDeployData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});

const pk = readFileSync(join(homedir(), '.forum-keys', 'deployer.key'), 'utf8').trim();
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const deployments = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
const USDC = deployments.usdc;
const TRV2 = deployments.contracts.TrackRecordV2.address;
const BOND = deployments.contracts.SlashBond.address;
const BOT_ID = process.env.FORUM_BOT_ID
  || ('0x' + 'f8081c2ef55bef260ec50cc1b9960eba' + '359efc879e338439f129a97b338ed014');

console.log('deployer:    ', account.address);
console.log('USDC:        ', USDC);
console.log('TrackRecordV2:', TRV2);
console.log('SlashBond:   ', BOND);
console.log('botId:       ', BOT_ID);

const sources = {
  'CovenantVault.sol': { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'RiskKernel.sol':    { content: readFileSync('src/RiskKernel.sol', 'utf8') },
};
function findImports(p) {
  if (sources[p]) return { contents: sources[p].content };
  const s = p.replace(/^\.\//, '');
  if (sources[s]) return { contents: sources[s].content };
  return { error: 'File not found: ' + p };
}
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
console.log('compiling with solc', solc.version(), '...');
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const kc = output.contracts['RiskKernel.sol']['RiskKernel'];
const vc = output.contracts['CovenantVault.sol']['CovenantVault'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('\n1) deploying RiskKernel ...');
const kData = encodeDeployData({ abi: kc.abi, bytecode: '0x' + kc.evm.bytecode.object, args: [] });
const kHash = await wal.sendTransaction({ data: kData });
const kRcpt = await pub.waitForTransactionReceipt({ hash: kHash });
if (kRcpt.status !== 'success') { console.error('RiskKernel reverted'); process.exit(1); }
console.log('  RiskKernel at:', kRcpt.contractAddress, 'block', kRcpt.blockNumber.toString());

console.log('\n2) deploying CovenantVault bound to AgoraMind bot ...');
const mandate = {
  operator: account.address,
  botId: BOT_ID,
  budgetUsdc: 200_000_000n,         // 200 USDC budget
  maxDrawdownBps: 500,              // 5% peak-to-trough max
  receiptFreshnessSec: 1800,        // 30 min staleness window
  expiry: 0n,                       // never
  perfFeeBps: 2_000,                // 20%
  bondContract: BOND,
  riskKernel: kRcpt.contractAddress,
  trackRecordV2: TRV2,
};
const vData = encodeDeployData({
  abi: vc.abi,
  bytecode: '0x' + vc.evm.bytecode.object,
  args: [USDC, mandate],
});
const vHash = await wal.sendTransaction({ data: vData });
const vRcpt = await pub.waitForTransactionReceipt({ hash: vHash });
if (vRcpt.status !== 'success') { console.error('CovenantVault reverted'); process.exit(1); }
console.log('  CovenantVault at:', vRcpt.contractAddress, 'block', vRcpt.blockNumber.toString());

deployments.contracts.RiskKernel = { address: kRcpt.contractAddress, txHash: kHash, block: kRcpt.blockNumber.toString() };
deployments.contracts.CovenantVault = {
  address: vRcpt.contractAddress, txHash: vHash, block: vRcpt.blockNumber.toString(),
  mandate: {
    operator: account.address, botId: BOT_ID,
    budgetUsdc: '200000000', maxDrawdownBps: 500, receiptFreshnessSec: 1800,
    expiry: '0', perfFeeBps: 2000,
    bondContract: BOND, riskKernel: kRcpt.contractAddress, trackRecordV2: TRV2,
  },
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(deployments, null, 2) + '\n');
console.log('\nupdated deployments/arc-testnet.json');
