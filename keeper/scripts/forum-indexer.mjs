#!/usr/bin/env node
// Forum indexer service.
//
// Replaces the frontend's direct-RPC reads with a polled cache exposed over
// HTTP. Designed to run as a systemd service alongside the keeper(s).
//
// Endpoints (all GET, CORS-enabled):
//   GET /api/health
//     { ok, lastPollAt, lastBlock, freshness, version }
//   GET /api/state
//     full snapshot — bots, vaults, bonds, recent slash events
//   GET /api/bots
//     [{ botId, kind, signer, recordCount, lastSeq, lastPnlMicros, lastPeriodEnd }, ...]
//   GET /api/bots/:botId/records?limit=50
//     [{ seq, ts, pnlMicros, fills, metaHash }, ...] for v1 TrackRecord
//   GET /api/covenant/:address
//     { state, assets, idle, outstanding, mandate, lastUpdate }
//   GET /api/slash-events?limit=20
//     [{ vault, verdict, newState, slashedUsdc, blockNumber, txHash, ts }, ...]
//
// Persistence: keeps a single JSON snapshot on disk. Reloads on boot.
// Polling interval: 30s. Log fetch chunk: 9500 blocks (matches Arc RPC cap).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import {
  createPublicClient, defineChain, http, parseAbi, parseAbiItem,
} from 'viem';
import { computeAgentScoreV1 as scoreFnV1 } from '../src/agent-score.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

// ---- CONFIG ----------------------------------------------------------------

const PORT = Number(process.env.FORUM_INDEXER_PORT || 3060);
const STATE_PATH = process.env.FORUM_INDEXER_STATE || '/opt/forum/indexer-state.json';
const POLL_MS = Number(process.env.FORUM_INDEXER_POLL_MS || 30_000);
const LOG_CHUNK = 9500n;
const VERSION = 'forum-indexer/0.8.0'; // + agent recentPnls/recentTs in /api/agents/:id (Phase 4 sparkline data)

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.FORUM_INDEXER_RPC || 'https://rpc.testnet.arc.network'] } },
});

const deployment = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
const TR_V1 = deployment.contracts.TrackRecord.address;
const TR_V2 = deployment.contracts.TrackRecordV2.address;
const KERNEL_V2 = deployment.contracts.RiskKernelV2.address;
const VAULTS = {
  v1: deployment.contracts.CovenantVault.address,
  v1_1: deployment.contracts.CovenantVaultV1_1?.address,
  v1_2: deployment.contracts.CovenantVaultV1_2?.address,
};
const BOND_V11 = deployment.contracts.SlashBondV1_1?.address;
const FACTORY = deployment.contracts.CovenantVaultFactory?.address;
const FEE_ROUTER = deployment.contracts.FeeRouterV1?.address;
const FACTORY_DEPLOY_BLOCK = deployment.contracts.CovenantVaultFactory?.block
  ? BigInt(deployment.contracts.CovenantVaultFactory.block)
  : null;
const DEPLOY_BLOCK = BigInt(deployment.contracts.BuilderCodeRegistry.block);
const TR_V2_DEPLOY_BLOCK = deployment.contracts.TrackRecordV2?.block
  ? BigInt(deployment.contracts.TrackRecordV2.block)
  : DEPLOY_BLOCK;

// ---- ABIs ------------------------------------------------------------------

const RECORD_COUNT_ABI = parseAbi(['function recordCount(bytes32) view returns (uint256)']);
// viem human-readable parseAbi rejects inline tuple(...) for outputs; use JSON ABI.
const RECORD_AT_V1_ABI = [{
  type: 'function',
  name: 'recordAt',
  stateMutability: 'view',
  inputs: [{ name: 'botId', type: 'bytes32' }, { name: 'idx', type: 'uint256' }],
  outputs: [{
    type: 'tuple',
    components: [
      { name: 'ts', type: 'uint64' },
      { name: 'pnlMicros', type: 'int128' },
      { name: 'fills', type: 'uint64' },
      { name: 'metaHash', type: 'bytes32' },
    ],
  }],
}];
// V2 StoredRecord is wider: full seq/periodStart/periodEnd window + the evidence
// + recordHash fields. The indexer only reads pnlMicros / fills / periodEnd
// (treated as the cycle ts) for scoring; the rest is decoded but ignored.
const RECORD_AT_V2_ABI = [{
  type: 'function',
  name: 'recordAt',
  stateMutability: 'view',
  inputs: [{ name: 'botId', type: 'bytes32' }, { name: 'idx', type: 'uint256' }],
  outputs: [{
    type: 'tuple',
    components: [
      { name: 'seq', type: 'uint64' },
      { name: 'periodStart', type: 'uint64' },
      { name: 'periodEnd', type: 'uint64' },
      { name: 'pnlMicros', type: 'int128' },
      { name: 'fills', type: 'uint64' },
      { name: 'metaHash', type: 'bytes32' },
      { name: 'evidenceUriHash', type: 'bytes32' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'recordHash', type: 'bytes32' },
    ],
  }],
}];
const VAULT_ABI = parseAbi([
  'function state() view returns (uint8)',
  'function assets() view returns (uint256)',
  'function depositTotalIdle() view returns (uint256)',
  'function operatorOutstanding() view returns (uint256)',
  'function mandate() view returns (address operator, bytes32 botId, uint128 budgetUsdc, uint16 maxDrawdownBps, uint32 receiptFreshnessSec, uint64 expiry, uint16 perfFeeBps, address bondContract, address riskKernel, address trackRecordV2)',
]);
// Read-only fee-statement surface — separate from VAULT_ABI to keep the hot
// polling path lean (these reads only run on /api/fee-statement requests).
const VAULT_FEE_ABI = parseAbi([
  'function perSharePrice() view returns (uint256)',
  'function highWaterMark() view returns (uint256)',
  'function operatorClaimable() view returns (uint256)',
]);
const FACTORY_ALL_VAULTS_ABI = parseAbi([
  'function allVaults() view returns (address[])',
]);
const BOND_ABI = parseAbi([
  'function bondBalance() view returns (uint256)',
  'function totalSlashed() view returns (uint256)',
]);
const FEE_ROUTER_READ_ABI = parseAbi([
  'function splitCount() view returns (uint256)',
  'function totalClaimableOf(address) view returns (uint256)',
]);
// viem human-readable parseAbi rejects inline tuple outputs; use JSON ABI.
const FEE_ROUTER_SPLIT_ABI = [{
  type: 'function', name: 'splitAt', stateMutability: 'view',
  inputs: [{ name: 'splitId', type: 'uint256' }],
  outputs: [{
    type: 'tuple',
    components: [
      { name: 'creator', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'bps', type: 'uint16[]' },
      { name: 'totalRouted', type: 'uint256' },
      { name: 'createdAt', type: 'uint64' },
    ],
  }],
}];

const BOT_REGISTERED_EVENT = parseAbiItem(
  'event BotRegistered(bytes32 indexed botId, uint8 kind, address indexed signer)',
);
const ENFORCED_EVENT = parseAbiItem(
  'event Enforced(address indexed vault, uint8 verdict, uint8 newState, uint256 slashedUsdc)',
);
const VAULT_CREATED_EVENT = parseAbiItem(
  'event VaultCreated(address indexed vault, address indexed creator, address indexed operator, bytes32 botId, uint128 budgetUsdc, uint64 createdAt)',
);

const KIND_NAMES = ['MAKER', 'TAKER', 'ARB', 'OTHER'];
const STATE_NAMES = ['ACTIVE', 'PAUSED', 'EXPIRED'];
const VERDICT_NAMES = ['ALLOW', 'PAUSE_DRAWDOWN', 'PAUSE_OVERSUBSCRIBED', 'PAUSE_STALE', 'PAUSE_EXPIRED'];

// ---- STATE -----------------------------------------------------------------

const initial = {
  cursor: { lastBlock: DEPLOY_BLOCK.toString() },
  bots: {},            // botId -> { kind, signer, recordCount, lastSeq, lastPnlMicros, lastPeriodEnd, lastUpdate }
  vaults: {},          // address -> { state, assets, idle, outstanding, mandate, lastUpdate, source }
  bonds: {},           // address -> { bondBalance, totalSlashed, lastUpdate }
  slashEvents: [],     // newest first, capped at 200
  factoryVaults: [],   // [{ vault, creator, operator, botId, budgetMicros, createdAt, blockNumber, txHash }] newest first
  lastPollAt: 0,
  lastBlock: 0,
};

let state;
try {
  if (existsSync(STATE_PATH)) {
    state = { ...initial, ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) };
    console.log(`[indexer] resumed from ${STATE_PATH} (lastBlock=${state.cursor.lastBlock})`);
  } else {
    state = initial;
    mkdirSync(dirname(STATE_PATH), { recursive: true });
  }
} catch (e) {
  console.error('[indexer] state load failed, starting fresh:', e.message);
  state = initial;
}

function persist() {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 0) + '\n');
  } catch (e) {
    console.error('[indexer] persist failed:', e.message);
  }
}

// ---- POLLER ----------------------------------------------------------------

const pub = createPublicClient({ chain: ARC, transport: http() });

async function getLogsChunked({ address, event, fromBlock, toBlock }) {
  const logs = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkTo = cursor + LOG_CHUNK - 1n > toBlock ? toBlock : cursor + LOG_CHUNK - 1n;
    logs.push(...await pub.getLogs({ address, event, fromBlock: cursor, toBlock: chunkTo }));
    cursor = chunkTo + 1n;
  }
  return logs;
}

async function indexBots(fromBlock, toBlock) {
  // V1 + V2 share the BotRegistered event signature (uint8 BotKind index).
  // We attribute each bot to the contract it was registered against so the
  // stats refresh + record fetch later target the right address + ABI.
  // First-seen wins if a botId somehow exists in both (shouldn't, since
  // botId = keccak(signer:label) is deterministic and registerBot reverts
  // AlreadyRegistered on the second call within the same contract).
  for (const [address, version] of [[TR_V1, 'v1'], [TR_V2, 'v2']]) {
    const logs = await getLogsChunked({
      address, event: BOT_REGISTERED_EVENT, fromBlock, toBlock,
    });
    for (const log of logs) {
      const botId = log.args.botId;
      if (!state.bots[botId]) {
        state.bots[botId] = {
          botId, kind: KIND_NAMES[Number(log.args.kind)] || 'OTHER',
          signer: log.args.signer, version, recordCount: 0,
          lastSeq: 0, lastPnlMicros: 0, lastPeriodEnd: 0, lastUpdate: 0,
        };
      }
    }
  }
}

const RECENT_RECORDS_N = 10; // window for sharpe-like + streak
const STREAK_GAP_SEC = 1800; // gaps over this break the streak (matches default freshness)

// Map a recordAt return tuple to the cycle ts the streak/freshness logic
// expects. V1 stores a single `ts` per record; V2 stores periodStart/periodEnd
// and the cycle end is the meaningful timestamp for "last receipt at" / streak
// gap.
function recordTs(version, r) {
  return version === 'v2' ? Number(r.periodEnd) : Number(r.ts);
}

async function refreshBotStats() {
  // For every known bot, refresh recordCount + recent record window for v1 score
  const now = Math.floor(Date.now() / 1000);
  const botIds = Object.keys(state.bots);
  await Promise.all(botIds.map(async (botId) => {
    try {
      // Bots persisted before v0.6.0 have no `version` field; default to v1.
      const version = state.bots[botId].version || 'v1';
      const address = version === 'v2' ? TR_V2 : TR_V1;
      const recordAtAbi = version === 'v2' ? RECORD_AT_V2_ABI : RECORD_AT_V1_ABI;
      const count = await pub.readContract({
        address, abi: RECORD_COUNT_ABI, functionName: 'recordCount', args: [botId],
      });
      const n = Number(count);
      state.bots[botId].recordCount = n;
      if (n > 0) {
        // Fetch the last min(N, n) records for sharpe + streak
        const start = n > RECENT_RECORDS_N ? n - RECENT_RECORDS_N : 0;
        const idxs = [];
        for (let i = start; i < n; i++) idxs.push(BigInt(i));
        const records = await Promise.all(idxs.map((idx) =>
          pub.readContract({ address, abi: recordAtAbi, functionName: 'recordAt', args: [botId, idx] }),
        ));
        const recentPnls = records.map((r) => Number(r.pnlMicros));
        const recentTs = records.map((r) => recordTs(version, r));
        // Longest streak across this window: count consecutive records where ts gap < STREAK_GAP_SEC
        let longestStreak = recentTs.length > 0 ? 1 : 0;
        let cur = 1;
        for (let i = 1; i < recentTs.length; i++) {
          if (recentTs[i] - recentTs[i - 1] < STREAK_GAP_SEC) {
            cur += 1;
            if (cur > longestStreak) longestStreak = cur;
          } else {
            cur = 1;
          }
        }
        const last = records[records.length - 1];
        state.bots[botId].lastSeq = n;
        state.bots[botId].lastPnlMicros = Number(last.pnlMicros);
        state.bots[botId].lastPeriodEnd = recordTs(version, last);
        state.bots[botId].recentPnls = recentPnls;
        state.bots[botId].recentTs = recentTs;
        state.bots[botId].longestStreak = longestStreak;
        // Running peak across all observed cycles — for drawdown computation.
        const curPnl = Number(last.pnlMicros);
        const prevPeak = Number(state.bots[botId].peakPnlMicros ?? curPnl);
        state.bots[botId].peakPnlMicros = Math.max(prevPeak, curPnl);
      }
      state.bots[botId].lastUpdate = now;
    } catch (e) {
      // Skip on read failure; will retry next cycle
    }
  }));
}

async function indexFactoryVaults(fromBlock, toBlock) {
  if (!FACTORY || !FACTORY_DEPLOY_BLOCK) return;
  const start = fromBlock > FACTORY_DEPLOY_BLOCK ? fromBlock : FACTORY_DEPLOY_BLOCK;
  if (toBlock < start) return;
  const logs = await getLogsChunked({
    address: FACTORY, event: VAULT_CREATED_EVENT, fromBlock: start, toBlock,
  });
  const knownVaults = new Set(state.factoryVaults.map((v) => v.vault.toLowerCase()));
  for (const log of logs) {
    const addr = log.args.vault;
    if (knownVaults.has(addr.toLowerCase())) continue;
    state.factoryVaults.unshift({
      vault: addr,
      creator: log.args.creator,
      operator: log.args.operator,
      botId: log.args.botId,
      budgetMicros: log.args.budgetUsdc.toString(),
      createdAt: Number(log.args.createdAt),
      blockNumber: log.blockNumber.toString(),
      txHash: log.transactionHash,
    });
    knownVaults.add(addr.toLowerCase());
  }
  state.factoryVaults = state.factoryVaults.slice(0, 500);
}

async function refreshOneVault(addr, label) {
  try {
    const [s, a, idle, out, m] = await Promise.all([
      pub.readContract({ address: addr, abi: VAULT_ABI, functionName: 'state' }),
      pub.readContract({ address: addr, abi: VAULT_ABI, functionName: 'assets' }),
      pub.readContract({ address: addr, abi: VAULT_ABI, functionName: 'depositTotalIdle' }),
      pub.readContract({ address: addr, abi: VAULT_ABI, functionName: 'operatorOutstanding' }),
      pub.readContract({ address: addr, abi: VAULT_ABI, functionName: 'mandate' }),
    ]);
    state.vaults[addr] = {
      label,
      source: label.startsWith('factory') ? 'factory' : 'hardcoded',
      state: STATE_NAMES[Number(s)] || `S${s}`,
      assetsMicros: a.toString(),
      idleMicros: idle.toString(),
      outstandingMicros: out.toString(),
      mandate: {
        operator: m[0],
        botId: m[1],
        budgetMicros: m[2].toString(),
        maxDrawdownBps: Number(m[3]),
        receiptFreshnessSec: Number(m[4]),
        expiry: m[5].toString(),
        perfFeeBps: Number(m[6]),
        bondContract: m[7],
        riskKernel: m[8],
        trackRecordV2: m[9],
      },
      lastUpdate: Math.floor(Date.now() / 1000),
    };
  } catch (e) {
    // Skip on failure; next cycle will retry
  }
}

async function refreshVaults() {
  // Hard-coded labelled vaults
  for (const [label, addr] of Object.entries(VAULTS)) {
    if (addr) await refreshOneVault(addr, label);
  }
  // Factory-discovered vaults
  for (let i = 0; i < state.factoryVaults.length; i++) {
    const fv = state.factoryVaults[i];
    await refreshOneVault(fv.vault, `factory/${i + 1}`);
  }
}

async function refreshBonds() {
  const now = Math.floor(Date.now() / 1000);
  if (!BOND_V11) return;
  try {
    const [bal, slashed] = await Promise.all([
      pub.readContract({ address: BOND_V11, abi: BOND_ABI, functionName: 'bondBalance' }),
      pub.readContract({ address: BOND_V11, abi: BOND_ABI, functionName: 'totalSlashed' }),
    ]);
    state.bonds[BOND_V11] = {
      label: 'SlashBondV1.1',
      bondBalanceMicros: bal.toString(),
      totalSlashedMicros: slashed.toString(),
      lastUpdate: now,
    };
  } catch (e) {
    /* skip */
  }
}

async function indexSlashEvents(fromBlock, toBlock) {
  const logs = await getLogsChunked({
    address: KERNEL_V2, event: ENFORCED_EVENT, fromBlock, toBlock,
  });
  for (const log of logs) {
    state.slashEvents.unshift({
      vault: log.args.vault,
      verdict: VERDICT_NAMES[Number(log.args.verdict)] || `V${log.args.verdict}`,
      newState: STATE_NAMES[Number(log.args.newState)] || `S${log.args.newState}`,
      slashedMicros: log.args.slashedUsdc.toString(),
      blockNumber: log.blockNumber.toString(),
      txHash: log.transactionHash,
    });
  }
  state.slashEvents = state.slashEvents.slice(0, 200);
}

let polling = false;
async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const block = await pub.getBlockNumber();
    const fromBlock = BigInt(state.cursor.lastBlock);
    const toBlock = block;
    if (toBlock > fromBlock) {
      await indexBots(fromBlock, toBlock);
      await indexSlashEvents(fromBlock, toBlock);
      await indexFactoryVaults(fromBlock, toBlock);
      state.cursor.lastBlock = toBlock.toString();
    }
    await refreshBotStats();
    await refreshVaults();
    await refreshBonds();
    state.lastBlock = Number(block);
    state.lastPollAt = Math.floor(Date.now() / 1000);
    persist();
    console.log(`[indexer] poll OK block=${block} bots=${Object.keys(state.bots).length} vaults=${Object.keys(state.vaults).length} slashes=${state.slashEvents.length}`);
  } catch (e) {
    console.error('[indexer] poll failed:', e.message);
  } finally {
    polling = false;
  }
}

// ---- HTTP ------------------------------------------------------------------

function jsonReply(res, status, body) {
  const json = JSON.stringify(body, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=10',
    'X-Indexer-Version': VERSION,
  });
  res.end(json);
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonReply(res, 405, { error: 'method not allowed' });
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api/, '');
  const freshness = state.lastPollAt > 0 ? Math.floor(Date.now() / 1000) - state.lastPollAt : null;

  if (path === '/health' || path === '/health/') {
    return jsonReply(res, 200, {
      ok: true,
      version: VERSION,
      lastPollAt: state.lastPollAt,
      lastBlock: state.lastBlock,
      freshnessSec: freshness,
      stale: freshness === null || freshness > POLL_MS / 1000 * 3,
    });
  }

  if (path === '/state' || path === '/state/') {
    return jsonReply(res, 200, state);
  }

  if (path === '/bots' || path === '/bots/') {
    return jsonReply(res, 200, Object.values(state.bots));
  }

  const botMatch = path.match(/^\/bots\/(0x[0-9a-fA-F]{64})\/records\/?$/);
  if (botMatch) {
    const botId = botMatch[1];
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    // Dispatch reads to the contract the bot is registered against. Unknown
    // bots default to V1 to preserve pre-v0.6.0 behavior (returns empty list
    // rather than a misleading error if the bot really only exists in V2).
    const known = state.bots[botId];
    const version = known?.version || 'v1';
    const address = version === 'v2' ? TR_V2 : TR_V1;
    const recordAtAbi = version === 'v2' ? RECORD_AT_V2_ABI : RECORD_AT_V1_ABI;
    // Live read — not cached
    (async () => {
      try {
        const count = await pub.readContract({
          address, abi: RECORD_COUNT_ABI, functionName: 'recordCount', args: [botId],
        });
        const n = Number(count);
        const start = n > limit ? n - limit : 0;
        const idxs = [];
        for (let i = start; i < n; i++) idxs.push(BigInt(i));
        const records = await Promise.all(idxs.map((idx) =>
          pub.readContract({ address, abi: recordAtAbi, functionName: 'recordAt', args: [botId, idx] }),
        ));
        const out = records.map((r, i) => ({
          seq: start + i + 1,
          ts: recordTs(version, r),
          pnlMicros: r.pnlMicros.toString(),
          fills: Number(r.fills),
          metaHash: r.metaHash,
        }));
        jsonReply(res, 200, out);
      } catch (e) {
        jsonReply(res, 500, { error: e.message });
      }
    })();
    return;
  }

  const covMatch = path.match(/^\/covenant\/(0x[0-9a-fA-F]{40})\/?$/);
  if (covMatch) {
    const addr = covMatch[1].toLowerCase();
    const found = Object.entries(state.vaults).find(([k]) => k.toLowerCase() === addr);
    if (!found) return jsonReply(res, 404, { error: 'vault not indexed' });
    return jsonReply(res, 200, found[1]);
  }

  if (path === '/slash-events' || path === '/slash-events/') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 200);
    return jsonReply(res, 200, state.slashEvents.slice(0, limit));
  }

  if (path === '/fees' || path === '/fees/') {
    if (!FEE_ROUTER) return jsonReply(res, 404, { error: 'FeeRouterV1 not deployed' });
    (async () => {
      try {
        const count = await pub.readContract({
          address: FEE_ROUTER, abi: FEE_ROUTER_READ_ABI, functionName: 'splitCount',
        });
        const n = Number(count);
        const ids = Array.from({ length: n }, (_, i) => BigInt(i));
        const splits = await Promise.all(ids.map(async (id) => {
          const s = await pub.readContract({
            address: FEE_ROUTER, abi: FEE_ROUTER_SPLIT_ABI, functionName: 'splitAt', args: [id],
          });
          return {
            splitId: Number(id),
            creator: s.creator,
            recipients: [...s.recipients],
            bps: s.bps.map((b) => Number(b)),
            totalRoutedMicros: s.totalRouted.toString(),
            createdAt: Number(s.createdAt),
          };
        }));
        // De-dupe recipients, then fetch totalClaimable for each.
        const uniqRecipients = [...new Set(splits.flatMap((s) => s.recipients))];
        const claimable = {};
        await Promise.all(uniqRecipients.map(async (r) => {
          const t = await pub.readContract({
            address: FEE_ROUTER, abi: FEE_ROUTER_READ_ABI, functionName: 'totalClaimableOf', args: [r],
          });
          claimable[r] = t.toString();
        }));
        const totalRoutedAllSplits = splits.reduce((a, s) => a + BigInt(s.totalRoutedMicros), 0n);
        jsonReply(res, 200, {
          feeRouter: FEE_ROUTER,
          splitCount: n,
          totalRoutedMicros: totalRoutedAllSplits.toString(),
          splits,
          recipientClaimableMicros: claimable,
        });
      } catch (e) {
        jsonReply(res, 500, { error: e.message });
      }
    })();
    return;
  }

  if (path === '/fee-statement' || path === '/fee-statement/') {
    // Phase 6: programmatic equivalent of the keeper/scripts/fee-reconcile.mjs
    // statement, served live from the indexer so the frontend (and any cron
    // consumer) can pull it without running a script. Walks every vault the
    // factory knows about, reads the per-vault fee state on demand, then
    // joins it to the (already-indexed) FeeRouterV1 split + per-recipient
    // claimable totals. Result shape matches the script's JSON output one for
    // one so existing tooling stays compatible.
    (async () => {
      try {
        const allVaults = FACTORY
          ? await pub.readContract({ address: FACTORY, abi: FACTORY_ALL_VAULTS_ABI, functionName: 'allVaults' })
          : [];
        const vaultReports = await Promise.all(allVaults.map(async (vault) => {
          const [mandate, vstate, assets, psp, hwm, claimable] = await Promise.all([
            pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'mandate' }),
            pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'state' }),
            pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'assets' }),
            pub.readContract({ address: vault, abi: VAULT_FEE_ABI, functionName: 'perSharePrice' }),
            pub.readContract({ address: vault, abi: VAULT_FEE_ABI, functionName: 'highWaterMark' }),
            pub.readContract({ address: vault, abi: VAULT_FEE_ABI, functionName: 'operatorClaimable' }),
          ]);
          // viem decodes the mandate tuple as a positional array (not object)
          // — mirrors refreshOneVault's m[0]/m[1]/m[6] indexing.
          return {
            vault,
            operator: mandate[0],
            botId: mandate[1],
            state: STATE_NAMES[Number(vstate)] ?? `unknown(${vstate})`,
            perfFeeBps: Number(mandate[6]),
            assetsMicros: assets.toString(),
            perSharePrice1e18: psp.toString(),
            highWaterMark1e18: hwm.toString(),
            operatorClaimableMicros: claimable.toString(),
            perSharePriceAboveHwm: psp > hwm,
          };
        }));

        let routerReport = null;
        if (FEE_ROUTER) {
          const splitCount = await pub.readContract({
            address: FEE_ROUTER, abi: FEE_ROUTER_READ_ABI, functionName: 'splitCount',
          });
          const n = Number(splitCount);
          const splits = await Promise.all(Array.from({ length: n }, (_, i) => BigInt(i)).map(async (id) => {
            const s = await pub.readContract({
              address: FEE_ROUTER, abi: FEE_ROUTER_SPLIT_ABI, functionName: 'splitAt', args: [id],
            });
            return {
              splitId: Number(id),
              creator: s.creator,
              recipients: [...s.recipients],
              bps: s.bps.map((b) => Number(b)),
              totalRoutedMicros: s.totalRouted.toString(),
              createdAt: Number(s.createdAt),
            };
          }));
          const recipients = [...new Set(splits.flatMap((s) => s.recipients))];
          const claimableEntries = await Promise.all(recipients.map(async (r) => {
            const t = await pub.readContract({
              address: FEE_ROUTER, abi: FEE_ROUTER_READ_ABI, functionName: 'totalClaimableOf', args: [r],
            });
            return [r, t.toString()];
          }));
          routerReport = {
            feeRouter: FEE_ROUTER,
            splitCount: n,
            splits,
            recipientClaimableMicros: Object.fromEntries(claimableEntries),
          };
        }

        const totalAccrued = vaultReports.reduce(
          (acc, v) => acc + BigInt(v.operatorClaimableMicros), 0n,
        );

        jsonReply(res, 200, {
          generatedAt: Math.floor(Date.now() / 1000),
          chain: 'arc-testnet',
          chainId: 5042002,
          factory: FACTORY ?? null,
          feeRouter: FEE_ROUTER ?? null,
          vaultCount: allVaults.length,
          totalOperatorClaimableMicros: totalAccrued.toString(),
          vaults: vaultReports,
          router: routerReport,
        });
      } catch (e) {
        jsonReply(res, 500, { error: e.message });
      }
    })();
    return;
  }

  if (path === '/factory-vaults' || path === '/factory-vaults/') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    return jsonReply(res, 200, state.factoryVaults.slice(0, limit));
  }

  if (path === '/vaults' || path === '/vaults/') {
    return jsonReply(res, 200, Object.entries(state.vaults).map(([addr, v]) => ({ address: addr, ...v })));
  }

  // -- AgentScore v0 --------------------------------------------------------
  // Lookup + glue. The scoring math is in keeper/src/agent-score.ts
  // (covered by keeper/test/agent-score.test.ts — 15 vitest cases).
  function computeAgentScore(botId) {
    const bot = state.bots[botId];
    if (!bot) return null;
    const now = Math.floor(Date.now() / 1000);
    const records = bot.recordCount || 0;
    const lastPnl = Number(bot.lastPnlMicros ?? 0);
    const peak = Number(bot.peakPnlMicros ?? lastPnl);
    const lastTs = Number(bot.lastPeriodEnd ?? 0);
    const secondsSince = lastTs > 0 ? now - lastTs : 0;

    // Vaults bound to this bot (cross-vault stats)
    const linkedVaults = Object.entries(state.vaults)
      .filter(([, v]) => v.mandate?.botId?.toLowerCase() === botId.toLowerCase())
      .map(([addr, v]) => ({ address: addr, label: v.label, state: v.state }));

    // Slash events targeting any linked vault
    const linkedVaultSet = new Set(linkedVaults.map((v) => v.address.toLowerCase()));
    const botSlashEvents = state.slashEvents.filter((e) => linkedVaultSet.has(e.vault.toLowerCase()) && e.slashedMicros !== '0');
    const slashEventCount = botSlashEvents.length;
    const totalSlashedMicros = botSlashEvents.reduce((a, e) => a + BigInt(e.slashedMicros), 0n).toString();

    // Per-vault bond attribution — walk every linked vault, look up its
    // declared bondContract in the indexed bond set. v0 used SlashBondV1.1 as
    // a proxy for everyone; v1 is real.
    const linkedBondAddrs = new Set();
    for (const lv of linkedVaults) {
      const fullVault = state.vaults[lv.address];
      if (fullVault?.mandate?.bondContract) linkedBondAddrs.add(fullVault.mandate.bondContract);
    }
    const bondBalancesMicros = [];
    let anyBondEverSlashed = false;
    for (const bondAddr of linkedBondAddrs) {
      const bondEntry = Object.entries(state.bonds).find(
        ([k]) => k.toLowerCase() === bondAddr.toLowerCase(),
      )?.[1];
      if (!bondEntry) continue;
      bondBalancesMicros.push(bondEntry.bondBalanceMicros);
      if (bondEntry.totalSlashedMicros && bondEntry.totalSlashedMicros !== '0') {
        anyBondEverSlashed = true;
      }
    }

    // Back-compat alias for /api/agents consumers (v0 used a single scalar)
    let bondBalanceMicros = '0';
    const bondLabels = Object.keys(state.bonds);
    if (bondLabels.length > 0) bondBalanceMicros = state.bonds[bondLabels[0]].bondBalanceMicros;

    const breakdown = scoreFnV1({
      recordCount: records,
      lastPnlMicros: lastPnl,
      peakPnlMicros: peak,
      secondsSinceLastReceipt: secondsSince,
      slashEventCount,
      bondBalanceMicros,
      longestStreak: bot.longestStreak ?? 0,
      recentPnls: bot.recentPnls ?? [],
      bondBalancesMicros,
      anyBondEverSlashed,
      verifiedFillCount: 0, // Phase 3 wire-up: needs real fills
    });

    return {
      botId,
      kind: bot.kind,
      signer: bot.signer,
      version: bot.version || 'v1',
      recordCount: records,
      lastPnlMicros: lastPnl,
      peakPnlMicros: peak,
      drawdownBps: breakdown.drawdownBps,
      lastReceiptAt: lastTs,
      secondsSinceLastReceipt: secondsSince,
      slashEventCount,
      totalSlashedMicros,
      linkedVaults,
      bondBalanceMicros,
      bondBalancesMicros: bondBalancesMicros.map(String),
      anyBondEverSlashed,
      longestStreak: breakdown.longestStreak,
      // Raw sparkline series for the agent-inspector mini-charts (Phase 4).
      // recentPnls / recentTs are the same arrays refreshBotStats() built
      // for the v1 score window; we expose them as-is so the frontend can
      // render drawdown + freshness without a second API round-trip.
      recentPnls: (bot.recentPnls ?? []).map(String),
      recentTs: bot.recentTs ?? [],
      sharpeLike: breakdown.sharpeLike,
      verifiedPnl: breakdown.verifiedPnl,
      verifiedFillCount: breakdown.verifiedFillCount,
      scoreV0: breakdown.scoreV0,
      scoreV1: breakdown.scoreV1,
      scoreBreakdown: {
        penalties: breakdown.penalties,
        bonuses: breakdown.bonuses,
        v1Adjustments: breakdown.v1Adjustments,
      },
      asOf: now,
    };
  }

  if (path === '/agents' || path === '/agents/') {
    const out = Object.keys(state.bots)
      .map((botId) => computeAgentScore(botId))
      .filter((s) => s !== null)
      .sort((a, b) => b.scoreV0 - a.scoreV0);
    return jsonReply(res, 200, out);
  }

  const agentMatch = path.match(/^\/agents\/(0x[0-9a-fA-F]{64})\/?$/);
  if (agentMatch) {
    const s = computeAgentScore(agentMatch[1]);
    if (!s) return jsonReply(res, 404, { error: 'agent not indexed' });
    return jsonReply(res, 200, s);
  }

  jsonReply(res, 404, { error: 'unknown endpoint', path: req.url });
});

// One-time V2 backfill. The state cursor (set by v0.5.0 deploys) sits past
// every existing V2 BotRegistered, so without this every V2-only bot would be
// invisible to the leaderboard forever. We can't simply reset the cursor —
// indexSlashEvents / indexFactoryVaults unshift without dedupe, so a rescan
// would duplicate that history. So scan V2 BotRegistered separately, log how
// many were found, and mark the state so this only runs once per upgrade.
async function v2BackfillIfNeeded() {
  if (state.v2BackfilledAt) return;
  try {
    const block = await pub.getBlockNumber();
    const logs = await getLogsChunked({
      address: TR_V2, event: BOT_REGISTERED_EVENT,
      fromBlock: TR_V2_DEPLOY_BLOCK, toBlock: block,
    });
    let added = 0;
    for (const log of logs) {
      const botId = log.args.botId;
      if (!state.bots[botId]) {
        state.bots[botId] = {
          botId, kind: KIND_NAMES[Number(log.args.kind)] || 'OTHER',
          signer: log.args.signer, version: 'v2', recordCount: 0,
          lastSeq: 0, lastPnlMicros: 0, lastPeriodEnd: 0, lastUpdate: 0,
        };
        added += 1;
      }
    }
    state.v2BackfilledAt = Math.floor(Date.now() / 1000);
    persist();
    console.log(`[indexer] v2 backfill done — scanned ${logs.length} events, added ${added} new bots, range [${TR_V2_DEPLOY_BLOCK}..${block}]`);
  } catch (e) {
    console.error('[indexer] v2 backfill failed:', e.message);
  }
}

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[indexer] listening on 127.0.0.1:${PORT} state=${STATE_PATH} poll=${POLL_MS}ms`);
  await v2BackfillIfNeeded();
  pollOnce(); // immediate
  setInterval(pollOnce, POLL_MS);
});
