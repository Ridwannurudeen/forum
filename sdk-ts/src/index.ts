// Forum Arc SDK — public surface
// Full client implementations land on D2 once contracts are deployed.
// D1 ships constants + types that adapter authors can import today.

export const ARC_TESTNET = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
} as const;

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
  metaHash: `0x${string}`;
}

export interface ForumAddresses {
  registry: `0x${string}`;
  config: `0x${string}`;
  trackRecord: `0x${string}`;
  feeDistributor: `0x${string}`;
}
