#!/usr/bin/env node
// Node-based deploy script: compiles all 4 Forum contracts with solc
// (no Foundry required for deploy) and broadcasts to Arc testnet via viem.
//
// Reads:
//   ~/.forum-keys/deployer.key   — testnet private key (never committed)
//   forum/.env                    — RPC URL, USDC address
//
// Writes:
//   forum/deployments/arc-testnet.json  — { contract: address, txHash, block }
//
// Run from forum/ root:  node scripts/deploy.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// Resolve repo root from this script's location so deploy.mjs works
// whether invoked from forum/ or from forum/keeper/ (where node_modules lives).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
process.chdir(REPO_ROOT);

import solc from 'solc';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  encodeDeployData,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';

dotenv.config();

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'arcscan', url: 'https://testnet.arcscan.app' } },
});

const KEYFILE = join(homedir(), '.forum-keys', 'deployer.key');
const USDC = process.env.ARC_USDC_ADDRESS || '0x3600000000000000000000000000000000000000';

if (!existsSync(KEYFILE)) {
  console.error(`ERROR: ${KEYFILE} not found.`);
  process.exit(1);
}
const pk = readFileSync(KEYFILE, 'utf8').trim();
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

console.log(`Deployer: ${account.address}`);
console.log(`Chain:    Arc testnet (${ARC_TESTNET.id})`);
console.log(`USDC:     ${USDC}`);

// ---- Compile -----------------------------------------------------------
const sources = {
  'BuilderCodeRegistry.sol': { content: readFileSync('src/BuilderCodeRegistry.sol', 'utf8') },
  'KeeperConfig.sol':        { content: readFileSync('src/KeeperConfig.sol', 'utf8') },
  'TrackRecord.sol':         { content: readFileSync('src/TrackRecord.sol', 'utf8') },
  'FeeDistributor.sol':      { content: readFileSync('src/FeeDistributor.sol', 'utf8') },
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

// Custom import resolver — FeeDistributor.sol imports BuilderCodeRegistry.sol
function findImports(path) {
  if (sources[path]) return { contents: sources[path].content };
  // Strip leading ./ and try again
  const stripped = path.replace(/^\.\//, '');
  if (sources[stripped]) return { contents: sources[stripped].content };
  return { error: `File not found: ${path}` };
}

console.log(`Compiling with solc ${solc.version()}...`);
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) {
    console.error('COMPILATION ERRORS:');
    fatal.forEach((e) => console.error(e.formattedMessage));
    process.exit(1);
  }
  // Warnings only
  output.errors.forEach((e) => console.warn(e.formattedMessage));
}

function getCompiled(file, contract) {
  const c = output.contracts[file][contract];
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

const registryCompiled = getCompiled('BuilderCodeRegistry.sol', 'BuilderCodeRegistry');
const configCompiled = getCompiled('KeeperConfig.sol', 'KeeperConfig');
const trackCompiled = getCompiled('TrackRecord.sol', 'TrackRecord');
const feeCompiled = getCompiled('FeeDistributor.sol', 'FeeDistributor');

// ---- Deploy ------------------------------------------------------------
const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http() });
const wallet = createWalletClient({ chain: ARC_TESTNET, transport: http(), account });

async function deploy(name, { abi, bytecode }, args = []) {
  console.log(`\nDeploying ${name}...`);
  const data = encodeDeployData({ abi, bytecode, args });
  const hash = await wallet.sendTransaction({ data });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${name} deploy reverted`);
  console.log(`  address: ${receipt.contractAddress}  block: ${receipt.blockNumber}`);
  return { address: receipt.contractAddress, txHash: hash, block: receipt.blockNumber.toString() };
}

const deployments = {};
deployments.BuilderCodeRegistry = await deploy('BuilderCodeRegistry', registryCompiled);
deployments.KeeperConfig         = await deploy('KeeperConfig', configCompiled);
deployments.TrackRecord          = await deploy('TrackRecord', trackCompiled);
deployments.FeeDistributor       = await deploy('FeeDistributor', feeCompiled, [
  deployments.BuilderCodeRegistry.address,
  USDC,
]);

// ---- Persist -----------------------------------------------------------
mkdirSync('deployments', { recursive: true });
const out = {
  chainId: 5042002,
  rpc: ARC_TESTNET.rpcUrls.default.http[0],
  deployer: account.address,
  deployedAt: new Date().toISOString(),
  usdc: USDC,
  contracts: deployments,
};
writeFileSync('deployments/arc-testnet.json', JSON.stringify(out, null, 2) + '\n');

console.log('\n=== DEPLOYMENT COMPLETE ===');
for (const [name, info] of Object.entries(deployments)) {
  console.log(`${name.padEnd(22)}  ${info.address}`);
}
console.log(`\nArtifacts written to:  deployments/arc-testnet.json`);
console.log(`View on explorer:      https://testnet.arcscan.app/address/${deployments.BuilderCodeRegistry.address}`);
