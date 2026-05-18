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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
process.chdir(REPO_ROOT);

// ---- CONFIG ----------------------------------------------------------------

const PORT = Number(process.env.FORUM_INDEXER_PORT || 3060);
const STATE_PATH = process.env.FORUM_INDEXER_STATE || '/opt/forum/indexer-state.json';
const POLL_MS = Number(process.env.FORUM_INDEXER_POLL_MS || 30_000);
const LOG_CHUNK = 9500n;
const VERSION = 'forum-indexer/0.3.0'; // adds /api/agents + AgentScore v0

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
const FACTORY_DEPLOY_BLOCK = deployment.contracts.CovenantVaultFactory?.block
  ? BigInt(deployment.contracts.CovenantVaultFactory.block)
  : null;
const DEPLOY_BLOCK = BigInt(deployment.contracts.BuilderCodeRegistry.block);

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
const VAULT_ABI = parseAbi([
  'function state() view returns (uint8)',
  'function assets() view returns (uint256)',
  'function depositTotalIdle() view returns (uint256)',
  'function operatorOutstanding() view returns (uint256)',
  'function mandate() view returns (address operator, bytes32 botId, uint128 budgetUsdc, uint16 maxDrawdownBps, uint32 receiptFreshnessSec, uint64 expiry, uint16 perfFeeBps, address bondContract, address riskKernel, address trackRecordV2)',
]);
const BOND_ABI = parseAbi([
  'function bondBalance() view returns (uint256)',
  'function totalSlashed() view returns (uint256)',
]);

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
  // Pull all BotRegistered events (idempotent: re-registration is impossible)
  const logs = await getLogsChunked({
    address: TR_V1, event: BOT_REGISTERED_EVENT, fromBlock, toBlock,
  });
  for (const log of logs) {
    const botId = log.args.botId;
    if (!state.bots[botId]) {
      state.bots[botId] = {
        botId, kind: KIND_NAMES[Number(log.args.kind)] || 'OTHER',
        signer: log.args.signer, recordCount: 0,
        lastSeq: 0, lastPnlMicros: 0, lastPeriodEnd: 0, lastUpdate: 0,
      };
    }
  }
}

async function refreshBotStats() {
  // For every known bot, refresh recordCount + most recent record stats
  const now = Math.floor(Date.now() / 1000);
  const botIds = Object.keys(state.bots);
  await Promise.all(botIds.map(async (botId) => {
    try {
      const count = await pub.readContract({
        address: TR_V1, abi: RECORD_COUNT_ABI, functionName: 'recordCount', args: [botId],
      });
      const n = Number(count);
      state.bots[botId].recordCount = n;
      if (n > 0) {
        const r = await pub.readContract({
          address: TR_V1, abi: RECORD_AT_V1_ABI, functionName: 'recordAt',
          args: [botId, BigInt(n - 1)],
        });
        state.bots[botId].lastSeq = n;
        state.bots[botId].lastPnlMicros = Number(r.pnlMicros);
        state.bots[botId].lastPeriodEnd = Number(r.ts);
        // Running peak across all observed cycles — for drawdown computation.
        const cur = Number(r.pnlMicros);
        const prevPeak = Number(state.bots[botId].peakPnlMicros ?? cur);
        state.bots[botId].peakPnlMicros = Math.max(prevPeak, cur);
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
    // Live read — not cached
    (async () => {
      try {
        const count = await pub.readContract({
          address: TR_V1, abi: RECORD_COUNT_ABI, functionName: 'recordCount', args: [botId],
        });
        const n = Number(count);
        const start = n > limit ? n - limit : 0;
        const idxs = [];
        for (let i = start; i < n; i++) idxs.push(BigInt(i));
        const records = await Promise.all(idxs.map((idx) =>
          pub.readContract({ address: TR_V1, abi: RECORD_AT_V1_ABI, functionName: 'recordAt', args: [botId, idx] }),
        ));
        const out = records.map((r, i) => ({
          seq: start + i + 1,
          ts: Number(r.ts),
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

  if (path === '/factory-vaults' || path === '/factory-vaults/') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    return jsonReply(res, 200, state.factoryVaults.slice(0, limit));
  }

  if (path === '/vaults' || path === '/vaults/') {
    return jsonReply(res, 200, Object.entries(state.vaults).map(([addr, v]) => ({ address: addr, ...v })));
  }

  // -- AgentScore v0 --------------------------------------------------------
  // Score formula (all in source, no oracles):
  //   start = 100
  //   - if recordCount == 0: -40
  //   - drawdown penalty   : -min(40, ddBps / 100)
  //   - staleness penalty  : -min(30, max(0, (secondsSince - 1800)/60))
  //   - slash penalty      : -15 * slashEventCount
  //   - bond bonus         : +10 if bondBalance > 0 anywhere
  //   clamp 0..100
  function computeAgentScore(botId) {
    const bot = state.bots[botId];
    if (!bot) return null;
    const now = Math.floor(Date.now() / 1000);
    const records = bot.recordCount || 0;
    const lastPnl = Number(bot.lastPnlMicros ?? 0);
    const peak = Number(bot.peakPnlMicros ?? lastPnl);
    const lastTs = Number(bot.lastPeriodEnd ?? 0);
    const secondsSince = lastTs > 0 ? now - lastTs : 0;
    let ddBps = 0;
    if (peak > 0 && lastPnl < peak) {
      ddBps = Math.floor(((peak - lastPnl) * 10000) / peak);
    }

    // Vaults bound to this bot (cross-vault stats)
    const linkedVaults = Object.entries(state.vaults)
      .filter(([, v]) => v.mandate?.botId?.toLowerCase() === botId.toLowerCase())
      .map(([addr, v]) => ({ address: addr, label: v.label, state: v.state }));

    // Slash events targeting any linked vault
    const linkedVaultSet = new Set(linkedVaults.map((v) => v.address.toLowerCase()));
    const botSlashEvents = state.slashEvents.filter((e) => linkedVaultSet.has(e.vault.toLowerCase()) && e.slashedMicros !== '0');
    const slashEventCount = botSlashEvents.length;
    const totalSlashedMicros = botSlashEvents.reduce((a, e) => a + BigInt(e.slashedMicros), 0n).toString();

    // Bond coverage — sum across linked bonds (proxy: SlashBondV1.1 only for v0)
    let bondBalanceMicros = '0';
    const bondLabels = Object.keys(state.bonds);
    if (bondLabels.length > 0) bondBalanceMicros = state.bonds[bondLabels[0]].bondBalanceMicros;
    const hasBond = bondBalanceMicros !== '0';

    let score = 100;
    if (records === 0) score -= 40;
    score -= Math.min(40, Math.floor(ddBps / 100));
    if (secondsSince > 1800) score -= Math.min(30, Math.floor((secondsSince - 1800) / 60));
    score -= 15 * slashEventCount;
    if (hasBond) score += 10;
    score = Math.max(0, Math.min(100, score));

    return {
      botId,
      kind: bot.kind,
      signer: bot.signer,
      recordCount: records,
      lastPnlMicros: lastPnl,
      peakPnlMicros: peak,
      drawdownBps: ddBps,
      lastReceiptAt: lastTs,
      secondsSinceLastReceipt: secondsSince,
      slashEventCount,
      totalSlashedMicros,
      linkedVaults,
      bondBalanceMicros,
      scoreV0: score,
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[indexer] listening on 127.0.0.1:${PORT} state=${STATE_PATH} poll=${POLL_MS}ms`);
  pollOnce(); // immediate
  setInterval(pollOnce, POLL_MS);
});
