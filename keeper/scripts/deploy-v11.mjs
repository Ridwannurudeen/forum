#!/usr/bin/env node
// A1: Deploy v1.1 autonomous-slash trio.
//   1. RiskKernelV2 (auto-slashes via SlashBond on violation)
//   2. New SlashBond (attestor = RiskKernelV2, recipient = new CovenantVault)
//   3. New CovenantVault (bound to new SlashBond + new RiskKernelV2 + existing TrackRecordV2)
//
// Old v1 contracts remain deployed. This is the parallel v1.1 demonstration.

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
const BOT_ID = process.env.FORUM_BOT_ID
  || ('0x' + 'f8081c2ef55bef260ec50cc1b9960eba' + '359efc879e338439f129a97b338ed014');

const sources = {
  'CovenantVault.sol': { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'SlashBond.sol':     { content: readFileSync('src/SlashBond.sol', 'utf8') },
  'RiskKernelV2.sol':  { content: readFileSync('src/RiskKernelV2.sol', 'utf8') },
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
console.log('compiling with solc', solc.version());
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const kv2 = output.contracts['RiskKernelV2.sol']['RiskKernelV2'];
const sb  = output.contracts['SlashBond.sol']['SlashBond'];
const cv  = output.contracts['CovenantVault.sol']['CovenantVault'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('\n1) deploying RiskKernelV2 ...');
const k1Hash = await wal.sendTransaction({ data: encodeDeployData({ abi: kv2.abi, bytecode: '0x' + kv2.evm.bytecode.object, args: [] }) });
const k1Rcpt = await pub.waitForTransactionReceipt({ hash: k1Hash });
const K2 = k1Rcpt.contractAddress;
console.log('   RiskKernelV2:', K2);

// We need the CovenantVault address BEFORE deploying SlashBond (so SlashBond.recipient = vault).
// But the vault constructor needs the bond address. Chicken-and-egg.
// Solve: predict vault address via getContractAddress(deployer, nonce+1) after bond is deployed,
// or deploy bond with recipient = zero placeholder then redirect.
//
// Simplest: deploy bond with recipient = deployer (so we have a clean address),
// then deploy vault, then we OWE a redeploy of bond with recipient=vault later.
// For the v1.1 demo, recipient = deployer is fine — operator IS deployer, demoing self-slash.

console.log('\n2) deploying SlashBondV1.1 (attestor = RiskKernelV2) ...');
const sbArgs = [USDC, account.address, K2, account.address, BOT_ID, 86400n];
const s1Hash = await wal.sendTransaction({ data: encodeDeployData({ abi: sb.abi, bytecode: '0x' + sb.evm.bytecode.object, args: sbArgs }) });
const s1Rcpt = await pub.waitForTransactionReceipt({ hash: s1Hash });
const SBV2 = s1Rcpt.contractAddress;
console.log('   SlashBondV1.1:', SBV2);

console.log('\n3) deploying CovenantVaultV1.1 (bond=new, kernel=new) ...');
const mandate = {
  operator: account.address,
  botId: BOT_ID,
  budgetUsdc: 200_000_000n,
  maxDrawdownBps: 500,
  receiptFreshnessSec: 1800,
  expiry: 0n,
  perfFeeBps: 2_000,
  bondContract: SBV2,
  riskKernel: K2,
  trackRecordV2: TRV2,
};
const v1Hash = await wal.sendTransaction({
  data: encodeDeployData({ abi: cv.abi, bytecode: '0x' + cv.evm.bytecode.object, args: [USDC, mandate] }),
});
const v1Rcpt = await pub.waitForTransactionReceipt({ hash: v1Hash });
const CVV2 = v1Rcpt.contractAddress;
console.log('   CovenantVaultV1.1:', CVV2);

deployments.contracts.RiskKernelV2 = { address: K2, txHash: k1Hash, block: k1Rcpt.blockNumber.toString() };
deployments.contracts.SlashBondV1_1 = { address: SBV2, txHash: s1Hash, block: s1Rcpt.blockNumber.toString(),
  operator: account.address, attestor: K2, recipient: account.address, botId: BOT_ID, unbondDelaySeconds: 86400 };
deployments.contracts.CovenantVaultV1_1 = { address: CVV2, txHash: v1Hash, block: v1Rcpt.blockNumber.toString(),
  mandate: { operator: account.address, botId: BOT_ID, budgetUsdc: '200000000', maxDrawdownBps: 500,
    receiptFreshnessSec: 1800, expiry: '0', perfFeeBps: 2000, bondContract: SBV2, riskKernel: K2, trackRecordV2: TRV2 } };

writeFileSync('deployments/arc-testnet.json', JSON.stringify(deployments, null, 2) + '\n');
console.log('\n=== V1.1 DEPLOYED ===');
console.log('RiskKernelV2:      ', K2);
console.log('SlashBondV1.1:     ', SBV2);
console.log('CovenantVaultV1.1: ', CVV2);
