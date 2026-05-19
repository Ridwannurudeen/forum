// Forum indexer HTTP client — wraps the read-only /api/* surface served by
// keeper/scripts/forum-indexer.mjs (production: https://forum.gudman.xyz/api).
//
// Separate from the contract-binding ForumClient in client.ts: this one never
// touches chain RPC. Use it for allocator dashboards, reconciliation
// pipelines, and any tool that wants the indexed view without spinning up
// its own node.

const DEFAULT_BASE_URL = "https://forum.gudman.xyz/api";

export interface IndexerClientOptions {
  /** Defaults to https://forum.gudman.xyz/api */
  baseUrl?: string;
  /** Optional fetch override for tests / custom transports. */
  fetchImpl?: typeof fetch;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  lastPollAt: number;
  lastBlock: number;
  freshnessSec: number | null;
  stale: boolean;
}

export interface AgentScore {
  botId: `0x${string}`;
  kind: "MAKER" | "TAKER" | "ARB" | "OTHER";
  signer: `0x${string}`;
  version: "v1" | "v2";
  recordCount: number;
  lastPnlMicros: number | string;
  peakPnlMicros: number | string;
  drawdownBps: number;
  lastReceiptAt: number;
  secondsSinceLastReceipt: number;
  slashEventCount: number;
  totalSlashedMicros: string;
  linkedVaults: { address: `0x${string}`; label?: string; state: string }[];
  bondBalanceMicros: string;
  bondBalancesMicros: string[];
  anyBondEverSlashed: boolean;
  longestStreak: number;
  recentPnls: string[];
  recentTs: number[];
  sharpeLike: number | null;
  verifiedPnl: string;
  verifiedFillCount: number;
  scoreV0: number;
  scoreV1: number;
  scoreBreakdown: unknown;
  asOf: number;
}

export interface FeeStatementVault {
  vault: `0x${string}`;
  operator: `0x${string}`;
  botId: `0x${string}`;
  state: string;
  perfFeeBps: number;
  assetsMicros: string;
  perSharePrice1e18: string;
  highWaterMark1e18: string;
  operatorClaimableMicros: string;
  perSharePriceAboveHwm: boolean;
}

export interface FeeStatementResponse {
  generatedAt: number;
  chain: string;
  chainId: number;
  factory: `0x${string}` | null;
  feeRouter: `0x${string}` | null;
  vaultCount: number;
  totalOperatorClaimableMicros: string;
  vaults: FeeStatementVault[];
  router: {
    feeRouter: `0x${string}`;
    splitCount: number;
    splits: {
      splitId: number;
      creator: `0x${string}`;
      recipients: `0x${string}`[];
      bps: number[];
      totalRoutedMicros: string;
      createdAt: number;
    }[];
    recipientClaimableMicros: Record<string, string>;
  } | null;
}

export interface RouterPerformance {
  address: `0x${string}`;
  strategist: `0x${string}`;
  tvlMicros: string;
  idleMicros: string;
  totalShares: string;
  perSharePrice1e18: string;
  strategyVersion: number;
  lastRebalanceAt: number;
  targetVaultCount: number;
  targets: { vault: `0x${string}`; weightBps: number }[];
  lifetime: {
    depositCount: number;
    withdrawCount: number;
    rebalanceCount: number;
    strategySetCount: number;
    totalDepositedMicros: string;
    totalWithdrawnMicros: string;
    lastDepositBlock: number;
    lastWithdrawBlock: number;
    lastRebalanceBlock: number;
    backfilledAt: number;
  };
}

export type RouterActivityKind =
  | "deposit"
  | "withdraw"
  | "rebalance"
  | "strategy";

export interface RouterActivityEntry {
  kind: RouterActivityKind;
  blockNumber: number;
  txHash: `0x${string}`;
  logIndex: number;
  // Per-kind fields (only present when kind matches):
  user?: `0x${string}`;
  usdcInMicros?: string;
  sharesMintedMicros?: string;
  sharesBurnedMicros?: string;
  usdcOutMicros?: string;
  atTs?: number;
  totalAssetsMicros?: string;
  vaultsTouched?: number;
  version?: number;
  vaults?: `0x${string}`[];
  weightsBps?: number[];
}

export class IndexerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: IndexerClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`Forum indexer ${path} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.get<HealthResponse>("/health");
  }

  agents(): Promise<AgentScore[]> {
    return this.get<AgentScore[]>("/agents");
  }

  agent(botId: `0x${string}`): Promise<AgentScore> {
    return this.get<AgentScore>(`/agents/${botId}`);
  }

  /** Phase 6 — per-vault accruals + router splits (live mirror of
   *  `keeper/scripts/fee-reconcile.mjs`'s JSON output). */
  feeStatement(): Promise<FeeStatementResponse> {
    return this.get<FeeStatementResponse>("/fee-statement");
  }

  /** Phase 5 — CapitalRouter TVL + strategy + lifetime event counters. */
  routerPerformance(): Promise<RouterPerformance> {
    return this.get<RouterPerformance>("/router/performance");
  }

  /** Phase 5 — newest-first reallocation receipts stream (deposits,
   *  withdraws, rebalances, strategy changes). Capped at 100 server-side. */
  routerActivity(limit = 50): Promise<RouterActivityEntry[]> {
    return this.get<RouterActivityEntry[]>(`/router/activity?limit=${limit}`);
  }
}
