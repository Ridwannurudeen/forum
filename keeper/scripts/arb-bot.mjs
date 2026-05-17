#!/usr/bin/env node
// Minimal demo TAKER bot. Picks one Polymarket V2 market, decides a direction
// based on a dumb signal (midprice > 0.5 ? YES : NO), and publishes a single
// TrackRecord entry tagged as TAKER. Proves the operator plane supports
// multiple bots of multiple kinds.
//
// Usage:
//   node keeper/scripts/taker-bot.mjs --label demo-taker-v1

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  createPublicClient, createWalletClient, defineChain, http,
  keccak256, toHex, encodeAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

const label = (() => {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--label');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'demo-arb-v1';
})();

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});

const deployment = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
const TR = deployment.contracts.TrackRecord.address;

const pk = readFileSync(join(homedir(), '.forum-keys', 'deployer.key'), 'utf8').trim();
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const botId = keccak256(toHex(`${account.address.toLowerCase()}:${label}`));

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log(`ARB demo bot`);
console.log(`  label:   ${label}`);
console.log(`  botId:   ${botId}`);
console.log(`  signer:  ${account.address}`);

// Pick a Polymarket V2 market with decent liquidity.
const url = 'https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false';
const res = await fetch(url, { headers: { 'user-agent': 'forum-taker-demo/0.0.1', accept: 'application/json' } });
if (!res.ok) throw new Error(`gamma failed: ${res.status}`);
const rows = await res.json();
const candidate = rows.find((m) => m.enableOrderBook && Number(m.liquidity ?? 0) >= 1_000);
if (!candidate) {
  console.error('No suitable market — exiting');
  process.exit(1);
}
let priceStr = candidate.outcomePrices;
if (typeof priceStr === 'string') {
  try { priceStr = JSON.parse(priceStr); } catch { priceStr = []; }
}
const yesPx = Array.isArray(priceStr) && priceStr.length >= 1 ? Number(priceStr[0]) : 0.5;
const pick = yesPx > 0.5 ? 'YES' : 'NO';
console.log(`  market:  ${candidate.slug}  yesPx=${yesPx.toFixed(3)}  pick=${pick}`);

// Register the bot if not yet registered.
const signer = await pub.readContract({
  address: TR,
  abi: [{ type: 'function', name: 'botSigner', stateMutability: 'view',
          inputs: [{ name: 'botId', type: 'bytes32' }], outputs: [{ type: 'address' }] }],
  functionName: 'botSigner', args: [botId],
});
if (signer === '0x0000000000000000000000000000000000000000') {
  console.log('  registering...');
  const h = await wal.writeContract({
    address: TR,
    abi: [{ type: 'function', name: 'registerBot', stateMutability: 'nonpayable',
            inputs: [{ name: 'botId', type: 'bytes32' }, { name: 'kind', type: 'uint8' }, { name: 'signer', type: 'address' }],
            outputs: [] }],
    functionName: 'registerBot',
    args: [botId, 2, account.address], // 1 = TAKER
    chain: ARC,
  });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log(`  registered tx=${h} block=${r.blockNumber}`);
} else {
  console.log('  already registered');
}

// Build + sign + publish ONE TrackRecord entry.
const RECORD_TYPEHASH = keccak256(toHex(
  'Record(bytes32 botId,uint8 kind,uint64 ts,int128 pnlMicros,uint64 fills,bytes32 metaHash)',
));
const DOMAIN_SEPARATOR = await pub.readContract({
  address: TR,
  abi: [{ type: 'function', name: 'DOMAIN_SEPARATOR', stateMutability: 'view',
          inputs: [], outputs: [{ type: 'bytes32' }] }],
  functionName: 'DOMAIN_SEPARATOR',
});
const ts = BigInt(Math.floor(Date.now() / 1000));
const pnlMicros = 0n; // unrealized — demo bot doesn't track entries
const fills = 1n; // we count the pick itself as a fill
const metaHash = keccak256(toHex(JSON.stringify({
  market: candidate.slug, yesPx, pick, ts: Number(ts),
})));
const structHash = keccak256(encodeAbiParameters(
  [
    { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'uint64' },
    { type: 'int128' }, { type: 'uint64' }, { type: 'bytes32' },
  ],
  [RECORD_TYPEHASH, botId, 2, ts, pnlMicros, fills, metaHash],
));
const digest = keccak256(`0x1901${DOMAIN_SEPARATOR.slice(2)}${structHash.slice(2)}`);
const signature = await account.sign({ hash: digest });

const hash = await wal.writeContract({
  address: TR,
  abi: [{ type: 'function', name: 'publish', stateMutability: 'nonpayable',
          inputs: [
            { name: 'botId', type: 'bytes32' },
            { name: 'r', type: 'tuple', components: [
              { name: 'ts', type: 'uint64' }, { name: 'pnlMicros', type: 'int128' },
              { name: 'fills', type: 'uint64' }, { name: 'metaHash', type: 'bytes32' },
            ]},
            { name: 'signature', type: 'bytes' },
          ], outputs: [] }],
  functionName: 'publish',
  args: [botId, { ts, pnlMicros, fills, metaHash }, signature],
  chain: ARC,
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log(`PUBLISH  tx=${hash}  block=${rcpt.blockNumber}  pick=${pick}  market=${candidate.slug}`);
