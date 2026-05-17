#!/usr/bin/env node
// A3: One-command demo of autonomous pause+slash.
//
// What this does:
//   1. Reads the v1.1 CovenantVault's current state, mandate, and bound bot's last receipt.
//   2. Computes the freshness violation deadline.
//   3. If currently within fresh window: prints what WOULD happen + how to trigger.
//   4. If past the window: calls RiskKernelV2.enforce(vault) → vault transitions to PAUSED
//      AND SlashBondV1.1 transfers 25% of bond to recipient — both in one tx.
//   5. Prints before/after state + tx hash.
//
// Demo recipe (~31 min):
//   $ systemctl stop forum-agora-mind.service
//   $ # wait 31 min (mandate freshnessSec = 1800)
//   $ node keeper/scripts/demo-violation.mjs
//   $ # restart: systemctl start forum-agora-mind.service

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeFunctionData, parseAbi,
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

// Default to v1.2 vault (bound to LIVE AgoraMind botId 0x201c...)
// because v1.1 vault was bound to a stale botId with no TRV2 records.
const v12 = d.contracts.CovenantVaultV1_2;
const VAULT  = v12.address;
const KERNEL = d.contracts.RiskKernelV2.address;
const BOND   = d.contracts.SlashBondV1_1.address;
const TRV2   = d.contracts.TrackRecordV2.address;
const BOT_ID = v12.mandate.botId;

const vaultAbi = parseAbi([
  'function state() view returns (uint8)',
  'function assets() view returns (uint256)',
  'function mandate() view returns (address operator, bytes32 botId, uint128 budgetUsdc, uint16 maxDrawdownBps, uint32 receiptFreshnessSec, uint64 expiry, uint16 perfFeeBps, address bondContract, address riskKernel, address trackRecordV2)',
]);
const kernelAbi = parseAbi([
  'function evaluate(address vault) view returns (uint8)',
  'function enforce(address vault)',
]);
const bondAbi = parseAbi([
  'function bondBalance() view returns (uint256)',
  'function totalSlashed() view returns (uint256)',
]);
const trAbi = parseAbi([
  'function recordCount(bytes32 botId) view returns (uint256)',
  'function recordAt(bytes32 botId, uint256 idx) view returns (uint64 seq, uint64 periodStart, uint64 periodEnd, int128 pnlMicros, uint64 fills, bytes32 metaHash, bytes32 evidenceUriHash, bytes32 evidenceHash, bytes32 recordHash)',
]);

const STATE = ['ACTIVE', 'PAUSED', 'EXPIRED'];
const VERDICT = ['ALLOW', 'PAUSE_DRAWDOWN', 'PAUSE_OVERSUBSCRIBED', 'PAUSE_STALE', 'PAUSE_EXPIRED'];

const pub = createPublicClient({ chain: ARC, transport: http() });
const wal = createWalletClient({ chain: ARC, transport: http(), account });

console.log('━'.repeat(64));
console.log('Covenant Account autonomous pause+slash demo');
console.log('━'.repeat(64));
console.log('Vault:        ', VAULT);
console.log('RiskKernelV2: ', KERNEL);
console.log('SlashBondV1.1:', BOND);
console.log('Bot ID:       ', BOT_ID);

const mandate = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'mandate' });
const freshnessSec = Number(mandate[4]);

const state = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'state' });
const verdict = await pub.readContract({ address: KERNEL, abi: kernelAbi, functionName: 'evaluate', args: [VAULT] });
const bondBefore = await pub.readContract({ address: BOND, abi: bondAbi, functionName: 'bondBalance' });
const slashedBefore = await pub.readContract({ address: BOND, abi: bondAbi, functionName: 'totalSlashed' });

const recordCount = await pub.readContract({ address: TRV2, abi: trAbi, functionName: 'recordCount', args: [BOT_ID] });
let lastPeriodEnd = 0n;
if (recordCount > 0n) {
  const last = await pub.readContract({
    address: TRV2, abi: trAbi, functionName: 'recordAt',
    args: [BOT_ID, recordCount - 1n],
  });
  lastPeriodEnd = last[2];
}

console.log('\nBEFORE');
console.log('  state:           ', STATE[state]);
console.log('  evaluate verdict:', VERDICT[verdict]);
console.log('  bondBalance:     ', Number(bondBefore) / 1e6, 'USDC');
console.log('  totalSlashed:    ', Number(slashedBefore) / 1e6, 'USDC');
console.log('  record count:    ', recordCount.toString());

const now = Math.floor(Date.now() / 1000);
const staleAt = Number(lastPeriodEnd) + freshnessSec;
const secsTilStale = staleAt - now;
console.log('  last record at:  ', lastPeriodEnd ? new Date(Number(lastPeriodEnd) * 1000).toISOString() : '(no record)');
console.log('  stale window ends:', staleAt ? new Date(staleAt * 1000).toISOString() : '(no record)');
console.log('  secs til stale:  ', secsTilStale);

if (verdict === 0 /* ALLOW */) {
  console.log('\nVault is ALLOW. To trigger the demo:');
  console.log('  1. systemctl stop forum-agora-mind.service');
  console.log(`  2. wait ${Math.max(0, secsTilStale + 5)}s for the freshness window to pass`);
  console.log('  3. re-run this script');
  console.log('\nNo tx sent.');
  process.exit(0);
}

if (bondBefore === 0n) {
  console.log('\nVerdict is violation but SlashBondV1.1 is empty — slash will be 0.');
  console.log('Run keeper/scripts/seed-tvl-and-bond.mjs first to seed the bond.');
}

console.log(`\nVerdict=${VERDICT[verdict]} (non-ALLOW) → calling RiskKernelV2.enforce(vault)`);
console.log('This will: (1) flip vault to PAUSED, (2) slash 25% of bond, in ONE tx.');
const hash = await wal.sendTransaction({
  to: KERNEL,
  data: encodeFunctionData({ abi: kernelAbi, functionName: 'enforce', args: [VAULT] }),
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log('   tx:', hash, '(status=', rcpt.status, ', gasUsed=', rcpt.gasUsed.toString(), ')');

const stateAfter = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'state' });
const bondAfter = await pub.readContract({ address: BOND, abi: bondAbi, functionName: 'bondBalance' });
const slashedAfter = await pub.readContract({ address: BOND, abi: bondAbi, functionName: 'totalSlashed' });

console.log('\nAFTER');
console.log('  state:        ', STATE[stateAfter]);
console.log('  bondBalance:  ', Number(bondAfter) / 1e6, 'USDC');
console.log('  totalSlashed: ', Number(slashedAfter) / 1e6, 'USDC');
console.log('  Δ slashed:    ', Number(slashedAfter - slashedBefore) / 1e6, 'USDC');
console.log(`\nView on explorer: https://testnet.arcscan.app/tx/${hash}`);
