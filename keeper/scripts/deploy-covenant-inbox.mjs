#!/usr/bin/env node
// Deploy CovenantInbox to Arc testnet.
// Also patches deployments/arc-testnet.json with: the Inbox address +
// the full Circle stack-on-Arc address book (CCTP V2, Gateway, USYC, EURC,
// FxEscrow) verified from docs.arc.io.

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
  'CovenantVault.sol': { content: readFileSync('src/CovenantVault.sol', 'utf8') },
  'CovenantInbox.sol': { content: readFileSync('src/CovenantInbox.sol', 'utf8') },
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
const inbox = out.contracts['CovenantInbox.sol']['CovenantInbox'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('deploying CovenantInbox...');
const hash = await wal.sendTransaction({
  data: encodeDeployData({ abi: inbox.abi, bytecode: '0x' + inbox.evm.bytecode.object, args: [] }),
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
const INBOX = rcpt.contractAddress;
console.log('CovenantInbox:', INBOX);

d.contracts.CovenantInbox = {
  address: INBOX, txHash: hash, block: rcpt.blockNumber.toString(),
  note: 'Bridge-friendly deposit wrapper. depositInto(vault, recipient, amount) and claim(vault, shares).',
};

// Pin the verified Circle / Arc address book here so downstream code can
// import these from the deployments JSON instead of hard-coding.
d.circle = d.circle || {};
d.circle.cctp = {
  version: 'v2',
  arcTestnetDomain: 26,
  tokenMessengerV2:     '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  tokenMinterV2:        '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
  messageV2:            '0xbaC0179bB358A8936169a63408C8481D582390C4',
  sourceDomains: {
    ethereumSepolia: 0,
    avalancheFuji:   1,
    baseSepolia:     6,
    polygonAmoy:     7,
  },
  source: 'docs.arc.io/arc/references/contract-addresses + developers.circle.com/cctp/concepts/supported-chains-and-domains',
};
d.circle.gateway = {
  gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
  gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
  source: 'docs.arc.io/arc/references/contract-addresses',
};
d.circle.usyc = {
  token:        '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
  teller:       '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A',
  entitlements: '0xcc205224862c7641930c87679e98999d23c26113',
  status: 'read-only (totalSupply verified). Teller buy/sell ABI undocumented, behind Entitlements gate. Not wired in v1.',
};
d.circle.eurc = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
d.circle.fxEscrow = '0x867650F5eAe8df91445971f14d89fd84F0C9a9f8';

writeFileSync('deployments/arc-testnet.json', JSON.stringify(d, null, 2) + '\n');
console.log('deployments/arc-testnet.json patched with CovenantInbox + Circle address book.');
