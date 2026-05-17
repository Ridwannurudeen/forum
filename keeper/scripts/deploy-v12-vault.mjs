#!/usr/bin/env node
// A1-fix: v1.1 vault was bound to a stale botId — TRV2 had no records for it,
// so RiskKernelV2.evaluate() always returned ALLOW.
//
// This deploys a v1.2 CovenantVault bound to the LIVE AgoraMind botId
// (0x201c...) which has real TRV2 records. RiskKernelV2 + SlashBondV1.1
// are unchanged.

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

const USDC   = d.usdc;
const TRV2   = d.contracts.TrackRecordV2.address;
const KERNEL = d.contracts.RiskKernelV2.address;
const BOND   = d.contracts.SlashBondV1_1.address;
// Live AgoraMind botId (verified via TRV2 publish logs + recordCount=2)
const BOT_ID = '0x' + '201c8909dca1eaccb80f2a11a49b98ad' + '6ae27e3bade9383f2b508587971b4ff9';

const sources = {
  'CovenantVault.sol': { content: readFileSync('src/CovenantVault.sol', 'utf8') },
};
function findImports(p) {
  const s = p.replace(/^\.\//, '');
  if (sources[s]) return { contents: sources[s].content };
  return { error: 'not found: ' + p };
}
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const cv = output.contracts['CovenantVault.sol']['CovenantVault'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

const mandate = {
  operator: account.address,
  botId: BOT_ID,
  budgetUsdc: 200_000_000n,
  maxDrawdownBps: 500,
  receiptFreshnessSec: 1800,
  expiry: 0n,
  perfFeeBps: 2_000,
  bondContract: BOND,
  riskKernel: KERNEL,
  trackRecordV2: TRV2,
};
console.log('deploying CovenantVaultV1.2 with LIVE AgoraMind botId ...');
const hash = await wal.sendTransaction({
  data: encodeDeployData({ abi: cv.abi, bytecode: '0x' + cv.evm.bytecode.object, args: [USDC, mandate] }),
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
const CVV12 = rcpt.contractAddress;
console.log('CovenantVaultV1.2:', CVV12);

d.contracts.CovenantVaultV1_2 = {
  address: CVV12, txHash: hash, block: rcpt.blockNumber.toString(),
  mandate: {
    operator: account.address, botId: BOT_ID, budgetUsdc: '200000000', maxDrawdownBps: 500,
    receiptFreshnessSec: 1800, expiry: '0', perfFeeBps: 2000,
    bondContract: BOND, riskKernel: KERNEL, trackRecordV2: TRV2,
  },
  note: 'v1.1 vault was bound to a stale botId — v1.2 fixes by binding to live AgoraMind botId 0x201c...',
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('deployments/arc-testnet.json updated.');
