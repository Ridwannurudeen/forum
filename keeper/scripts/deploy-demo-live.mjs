#!/usr/bin/env node
// Demo "live" Covenant Account bootstrap (Forum / Agora demo).
//   1. Deploy a fresh per-operator SlashBond: operator=deployer,
//      attestor=RiskKernelV2 (so enforce() can slash autonomously),
//      recipient=deployer, botId=keccak256(deployerLower + ":demo-live-v1"),
//      unbondDelay=86400.
//   2. createVault via CovenantVaultFactory bound to that botId + the new bond.
//   3. Fund: deposit ~5 USDC into the vault, post ~2 USDC bond.
//
// Mirrors deploy-slashbond.mjs (compile/deploy) + factory-create-demo.mjs
// (createVault) + seed-tvl-and-bond.mjs (approve/deposit/bond). Uses the
// deployer key so WE control the operator (the keeper needs it).
//
// Writes the new addresses to deployments/arc-testnet.json under
// DemoLiveSlashBond + DemoLiveVault (additive; existing entries untouched).

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import solc from 'solc';
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeDeployData, encodeFunctionData, parseAbi, keccak256, toHex,
} from 'viem';
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
const d = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));

const USDC    = d.usdc;
const FACTORY = d.contracts.CovenantVaultFactory.address;
const KERNEL  = d.contracts.RiskKernelV2.address;
const TRV2    = d.contracts.TrackRecordV2.address;

const LABEL  = 'demo-live-v1';
const BOT_ID = keccak256(toHex(`${account.address.toLowerCase()}:${LABEL}`));

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('operator/deployer:', account.address);
console.log('attestor (kernel):', KERNEL);
console.log('recipient:        ', account.address);
console.log('botId:            ', BOT_ID, `(label "${LABEL}")`);

// ---------------------------------------------------------------------------
// 1. Compile + deploy SlashBond (attestor = RiskKernelV2).
// ---------------------------------------------------------------------------
const sources = { 'SlashBond.sol': { content: readFileSync('src/SlashBond.sol', 'utf8') } };
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
console.log('\ncompiling SlashBond with solc', solc.version(), '...');
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const sb = output.contracts['SlashBond.sol']['SlashBond'];

console.log('deploying SlashBond...');
const bondDeployHash = await wal.sendTransaction({
  data: encodeDeployData({
    abi: sb.abi, bytecode: '0x' + sb.evm.bytecode.object,
    args: [USDC, account.address, KERNEL, account.address, BOT_ID, 86400n],
  }),
});
console.log('  tx:', bondDeployHash);
const bondRcpt = await pub.waitForTransactionReceipt({ hash: bondDeployHash });
if (bondRcpt.status !== 'success') { console.error('bond deploy reverted'); process.exit(1); }
const BOND = bondRcpt.contractAddress;
console.log('  SlashBond deployed at:', BOND, 'block', bondRcpt.blockNumber.toString());

// ---------------------------------------------------------------------------
// 2. createVault via factory.
// ---------------------------------------------------------------------------
const factoryAbi = [{
  type: 'function', name: 'createVault', stateMutability: 'nonpayable',
  inputs: [{
    name: 'm', type: 'tuple', components: [
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
const allVaultsAbi = parseAbi(['function allVaults() view returns (address[])']);

const mandate = {
  operator: account.address,
  botId: BOT_ID,
  budgetUsdc: 50_000_000n,   // 50 USDC
  maxDrawdownBps: 500,       // 5%
  receiptFreshnessSec: 1800, // 30 min
  expiry: 0n,                // never
  perfFeeBps: 2_000,         // 20%
  bondContract: BOND,
  riskKernel: KERNEL,
  trackRecordV2: TRV2,
};

console.log('\ncalling factory.createVault(mandate) ...');
const createHash = await wal.sendTransaction({
  to: FACTORY,
  data: encodeFunctionData({ abi: factoryAbi, functionName: 'createVault', args: [mandate] }),
});
const createRcpt = await pub.waitForTransactionReceipt({ hash: createHash });
if (createRcpt.status !== 'success') { console.error('createVault reverted'); process.exit(1); }
const all = await pub.readContract({ address: FACTORY, abi: allVaultsAbi, functionName: 'allVaults' });
const VAULT = all[all.length - 1];
console.log('  tx:', createHash);
console.log('  vault deployed at:', VAULT, 'block', createRcpt.blockNumber.toString());

// ---------------------------------------------------------------------------
// 3. Fund: deposit ~5 USDC into the vault, post ~2 USDC bond.
// ---------------------------------------------------------------------------
const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const vaultAbi = parseAbi(['function deposit(uint256 amount)']);
const bondAbi = parseAbi(['function bond(uint256 amount)']);

async function send(label, to, data) {
  const hash = await wal.sendTransaction({ to, data });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label} → ${hash} (${rcpt.status})`);
  if (rcpt.status !== 'success') throw new Error(`${label} reverted`);
  return hash;
}

console.log('\nfunding: deposit 5 USDC into vault ...');
await send('approve(vault,5)', USDC, encodeFunctionData({ abi: usdcAbi, functionName: 'approve', args: [VAULT, 5_000_000n] }));
const depositHash = await send('deposit(5)', VAULT, encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [5_000_000n] }));

console.log('\nfunding: bond 2 USDC into SlashBond ...');
await send('approve(bond,2)', USDC, encodeFunctionData({ abi: usdcAbi, functionName: 'approve', args: [BOND, 2_000_000n] }));
const bondHash = await send('bond(2)', BOND, encodeFunctionData({ abi: bondAbi, functionName: 'bond', args: [2_000_000n] }));

// ---------------------------------------------------------------------------
// 4. Persist (additive).
// ---------------------------------------------------------------------------
d.contracts.DemoLiveSlashBond = {
  address: BOND, txHash: bondDeployHash, block: bondRcpt.blockNumber.toString(),
  operator: account.address, attestor: KERNEL, recipient: account.address,
  botId: BOT_ID, unbondDelaySeconds: 86400,
  note: 'Demo live Covenant Account bond — attestor=RiskKernelV2 for autonomous slash.',
};
d.contracts.DemoLiveVault = {
  address: VAULT, txHash: createHash, block: createRcpt.blockNumber.toString(),
  depositTxHash: depositHash, bondTxHash: bondHash,
  mandate: {
    operator: account.address, botId: BOT_ID, budgetUsdc: '50000000', maxDrawdownBps: 500,
    receiptFreshnessSec: 1800, expiry: '0', perfFeeBps: 2000,
    bondContract: BOND, riskKernel: KERNEL, trackRecordV2: TRV2,
  },
  label: LABEL,
  note: 'Demo live Covenant Account created via factory; keeper label "demo-live-v1".',
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('\nupdated deployments/arc-testnet.json (DemoLiveSlashBond + DemoLiveVault)');

console.log('\n================ SUMMARY ================');
console.log('botId:        ', BOT_ID);
console.log('bond:         ', BOND);
console.log('vault:        ', VAULT);
console.log('bond deploy:  ', bondDeployHash);
console.log('createVault:  ', createHash);
console.log('deposit:      ', depositHash);
console.log('bond fund:    ', bondHash);
