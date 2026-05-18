#!/usr/bin/env node
// Deploy SlashInsurance for SlashBondV1.1.
// topUpRecipient = deployer (matches SlashBondV1.1.recipient set at deploy time).

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
  'CovenantVault.sol':   { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'SlashInsurance.sol':  { content: readFileSync('src/SlashInsurance.sol', 'utf8') },
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
const ins = out.contracts['SlashInsurance.sol']['SlashInsurance'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

const BOND = d.contracts.SlashBondV1_1.address;
const RECIPIENT = account.address; // matches SlashBondV1.1.recipient

console.log(`deploying SlashInsurance(bond=${BOND}, recipient=${RECIPIENT}) ...`);
const hash = await wal.sendTransaction({
  data: encodeDeployData({ abi: ins.abi, bytecode: '0x' + ins.evm.bytecode.object, args: [d.usdc, BOND, RECIPIENT] }),
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
const INS = rcpt.contractAddress;
console.log(`SlashInsurance: ${INS}, tx: ${hash}`);

d.contracts.SlashInsurance = {
  address: INS, txHash: hash, block: rcpt.blockNumber.toString(),
  bond: BOND, topUpRecipient: RECIPIENT,
  note: 'Phase 9 continuous-premium insurance pool for SlashBondV1.1. notifySlash() reads bond.totalSlashed delta + pays delta to topUpRecipient. payPremium / withdrawPremium for funders.',
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('deployments JSON updated.');
