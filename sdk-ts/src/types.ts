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

export interface ForumAddresses {
  registry: Address;
  config: Address;
  trackRecord: Address;
  feeDistributor: Address;
}

export const ARC_TESTNET = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
} as const;
