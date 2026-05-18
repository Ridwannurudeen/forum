import type { Hex, Address } from "viem";

export type BotKind = "MAKER" | "TAKER" | "ARB" | "OTHER";

export const BOT_KIND_ENUM: Record<BotKind, number> = {
  MAKER: 0,
  TAKER: 1,
  ARB: 2,
  OTHER: 3,
};

export interface TrackRecord {
  ts: number;
  pnlMicros: bigint;
  fills: number;
  metaHash: Hex;
}

export interface TrackRecordV2Record {
  seq: number;
  periodStart: number;
  periodEnd: number;
  pnlMicros: bigint;
  fills: number;
  metaHash: Hex;
  evidenceUriHash: Hex;
  evidenceHash: Hex;
  recordHash: Hex;
}

export interface CovenantMandate {
  operator: Address;
  botId: Hex;
  budgetUsdc: bigint;
  maxDrawdownBps: number;
  receiptFreshnessSec: number;
  expiry: bigint;
  perfFeeBps: number;
  bondContract: Address;
  riskKernel: Address;
  trackRecordV2: Address;
}

export type CovenantState = "ACTIVE" | "PAUSED";

export type RiskVerdict =
  | "ALLOW"
  | "PAUSE_DRAWDOWN"
  | "PAUSE_OVERSUBSCRIBED"
  | "PAUSE_STALE"
  | "PAUSE_EXPIRED";

export interface ForumAddresses {
  registry: Address;
  config: Address;
  trackRecord: Address;
  feeDistributor: Address;
  trackRecordV2?: Address;
  agentPool?: Address;
  slashBond?: Address;
  riskKernel?: Address;
  covenantVault?: Address;
  covenantVaultFactory?: Address;
  covenantInbox?: Address;
}

export const ARC_TESTNET = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
} as const;
