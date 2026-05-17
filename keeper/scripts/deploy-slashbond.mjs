#!/usr/bin/env node
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
const POOL = deployments.contracts.AgentPool.address;
// botId for the VPS keeper (same one AgentPool is bound to)
const BOT_ID = process.env.FORUM_BOT_ID
  || ('0x' + 'f8081c2ef55bef260ec50cc1b9960eba' + '359efc879e338439f129a97b338ed014');

console.log('deployer/operator:', account.address);
console.log('attestor:         ', account.address, '(deployer in v1 demo)');
console.log('recipient (pool): ', POOL);
console.log('botId:            ', BOT_ID);
console.log('unbond delay:     ', '86400 sec (1 day)');

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
console.log('compiling with solc', solc.version(), '...');
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) { fatal.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
}
const c = output.contracts['SlashBond.sol']['SlashBond'];
const abi = c.abi;
const bytecode = '0x' + c.evm.bytecode.object;

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });
console.log('deploying SlashBond...');
const data = encodeDeployData({
  abi, bytecode,
  args: [USDC, account.address, account.address, POOL, BOT_ID, 86400n],
});
const hash = await wal.sendTransaction({ data });
console.log('  tx:', hash);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') { console.error('reverted'); process.exit(1); }
console.log('  SlashBond deployed at:', receipt.contractAddress);
console.log('  block:', receipt.blockNumber.toString());

deployments.contracts.SlashBond = {
  address: receipt.contractAddress,
  txHash: hash,
  block: receipt.blockNumber.toString(),
  operator: account.address,
  attestor: account.address,
  recipient: POOL,
  botId: BOT_ID,
  unbondDelaySeconds: 86400,
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(deployments, null, 2) + '\n');
console.log('updated deployments/arc-testnet.json');
