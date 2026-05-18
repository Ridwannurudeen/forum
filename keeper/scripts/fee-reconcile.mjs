#!/usr/bin/env node
// Phase 6 fee reconciliation — walks every CovenantVault discoverable via
// the factory, reads on-chain `operatorClaimable` + recent
// `FeeCrystallised` events, and emits a JSON "monthly statement"
// summarising what each operator has accrued and what remains
// unclaimed. Also reads FeeRouterV1 splits + per-recipient claimable
// so a researcher / referrer can see what they're owed.
//
// Read-only by default. Writes a JSON report to:
//   reports/fee-statement-<unix>.json
//
// Run anytime; designed for a daily/weekly cron.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, defineChain, http, parseAbi } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, '..', '..'));

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});
const d = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
const FACTORY = d.contracts.CovenantVaultFactory?.address;
const FEE_ROUTER = d.contracts.FeeRouterV1?.address;
if (!FACTORY) { console.error('CovenantVaultFactory not deployed'); process.exit(1); }

const FACTORY_ABI = parseAbi([
  'function allVaults() view returns (address[])',
]);
const VAULT_ABI = parseAbi([
  'function mandate() view returns (address operator,bytes32 botId,uint128 budgetUsdc,uint16 maxDrawdownBps,uint32 receiptFreshnessSec,uint64 expiry,uint16 perfFeeBps,address bondContract,address riskKernel,address trackRecordV2)',
  'function state() view returns (uint8)',
  'function assets() view returns (uint256)',
  'function perSharePrice() view returns (uint256)',
  'function highWaterMark() view returns (uint256)',
  'function operatorClaimable() view returns (uint256)',
  'event FeeCrystallised(uint256 perfFeeUsdc, uint256 newHwmPerShare1e18)',
]);

const pub = createPublicClient({ chain: ARC, transport: http() });

const STATE_NAMES = ['ACTIVE', 'PAUSED'];

console.log(`fee-reconcile · factory=${FACTORY} feeRouter=${FEE_ROUTER ?? '(not deployed)'}`);

const vaults = await pub.readContract({
  address: FACTORY, abi: FACTORY_ABI, functionName: 'allVaults',
});
console.log(`discovered ${vaults.length} vaults via factory.`);

const vaultReports = [];
for (const vault of vaults) {
  const [mandate, state, assets, psp, hwm, claimable] = await Promise.all([
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'mandate' }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'state' }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'assets' }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'perSharePrice' }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'highWaterMark' }),
    pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'operatorClaimable' }),
  ]);
  vaultReports.push({
    vault,
    operator: mandate.operator,
    botId: mandate.botId,
    state: STATE_NAMES[Number(state)] ?? `unknown(${state})`,
    perfFeeBps: Number(mandate.perfFeeBps),
    assetsMicros: assets.toString(),
    perSharePrice1e18: psp.toString(),
    highWaterMark1e18: hwm.toString(),
    operatorClaimableMicros: claimable.toString(),
    perSharePriceAboveHwm: psp > hwm,
  });
}

let routerReport = null;
if (FEE_ROUTER) {
  const ROUTER_ABI = parseAbi([
    'function splitCount() view returns (uint256)',
    'function splitAt(uint256) view returns ((address creator,address[] recipients,uint16[] bps,uint256 totalRouted,uint64 createdAt))',
    'function totalClaimableOf(address) view returns (uint256)',
  ]);
  const splitCount = await pub.readContract({ address: FEE_ROUTER, abi: ROUTER_ABI, functionName: 'splitCount' });
  const splits = [];
  const recipientTotals = new Map();
  for (let i = 0n; i < splitCount; i++) {
    const s = await pub.readContract({ address: FEE_ROUTER, abi: ROUTER_ABI, functionName: 'splitAt', args: [i] });
    splits.push({
      splitId: Number(i),
      creator: s.creator,
      recipients: [...s.recipients],
      bps: [...s.bps],
      totalRoutedMicros: s.totalRouted.toString(),
      createdAt: Number(s.createdAt),
    });
    for (const r of s.recipients) {
      if (!recipientTotals.has(r)) {
        const t = await pub.readContract({ address: FEE_ROUTER, abi: ROUTER_ABI, functionName: 'totalClaimableOf', args: [r] });
        recipientTotals.set(r, t.toString());
      }
    }
  }
  routerReport = {
    feeRouter: FEE_ROUTER,
    splitCount: Number(splitCount),
    splits,
    recipientClaimableMicros: Object.fromEntries(recipientTotals),
  };
}

const totalAccruedAcrossVaults = vaultReports.reduce(
  (acc, v) => acc + BigInt(v.operatorClaimableMicros), 0n,
);

const report = {
  generatedAt: Math.floor(Date.now() / 1000),
  chain: 'arc-testnet',
  chainId: 5042002,
  factory: FACTORY,
  feeRouter: FEE_ROUTER ?? null,
  vaultCount: vaults.length,
  totalOperatorClaimableMicros: totalAccruedAcrossVaults.toString(),
  vaults: vaultReports,
  router: routerReport,
};

const reportsDir = 'reports';
if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
const outPath = join(reportsDir, `fee-statement-${report.generatedAt}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

console.log(`\nReport: ${outPath}`);
console.log(`Vaults : ${vaults.length}`);
console.log(`Total operator-claimable across vaults: ${totalAccruedAcrossVaults} micros`);
if (routerReport) {
  console.log(`Router splits: ${routerReport.splitCount}`);
  console.log(`Router per-recipient claimable:`);
  for (const [r, amt] of Object.entries(routerReport.recipientClaimableMicros)) {
    console.log(`  ${r} → ${amt}`);
  }
}
