import { defineChain, parseGwei, type Chain } from "viem";

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: {
    default: { name: "arcscan", url: "https://testnet.arcscan.app" },
  },
});

// Arc mainnet enforces a 20 gwei base-fee floor and silently drops sub-floor
// transactions (no receipt, nonce unused). The public RPC supports
// eth_fillTransaction; viem 2.50.4 takes the node-filled fees when that call
// succeeds (chain.fees.estimateFeesPerGas is only consulted on the fallback
// path) and scales them by baseFeeMultiplier 1.2, which happens to clear 21
// gwei while the base fee sits at the floor. The floor is made explicit through
// the chain-level prepareTransactionRequest hook instead: before the fill so
// the node sees our fees, and after every parameter is filled as the final
// guarantee, whichever path viem took.
export const ARC_MAINNET_MIN_MAX_FEE_PER_GAS = parseGwei("21");
export const ARC_MAINNET_MIN_PRIORITY_FEE_PER_GAS = parseGwei("1");

export function arcMainnetFeeFloor<
  T extends {
    type?: string | undefined;
    gasPrice?: bigint | undefined;
    maxFeePerGas?: bigint | undefined;
    maxPriorityFeePerGas?: bigint | undefined;
  },
>(request: T): T {
  // Before the fill `type` may still be unset; a caller-supplied gasPrice then
  // marks the request legacy (adding 1559 fields beside it would fail viem's
  // request assertion).
  if (
    request.type === "legacy" ||
    request.type === "eip2930" ||
    (request.type === undefined && request.gasPrice !== undefined)
  ) {
    const gasPrice = request.gasPrice ?? 0n;
    return {
      ...request,
      gasPrice:
        gasPrice > ARC_MAINNET_MIN_MAX_FEE_PER_GAS
          ? gasPrice
          : ARC_MAINNET_MIN_MAX_FEE_PER_GAS,
    };
  }
  const maxFee = request.maxFeePerGas ?? 0n;
  const priority = request.maxPriorityFeePerGas ?? 0n;
  return {
    ...request,
    maxFeePerGas:
      maxFee > ARC_MAINNET_MIN_MAX_FEE_PER_GAS
        ? maxFee
        : ARC_MAINNET_MIN_MAX_FEE_PER_GAS,
    maxPriorityFeePerGas:
      priority > ARC_MAINNET_MIN_PRIORITY_FEE_PER_GAS
        ? priority
        : ARC_MAINNET_MIN_PRIORITY_FEE_PER_GAS,
  };
}

export const ARC_MAINNET = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  prepareTransactionRequest: [
    async (request) => arcMainnetFeeFloor(request),
    { runAt: ["beforeFillTransaction", "afterFillParameters"] },
  ],
});

export type ForumChainName = "arc-testnet" | "arc-mainnet";

export const FORUM_CHAINS: Record<ForumChainName, Chain> = {
  "arc-testnet": ARC_TESTNET,
  "arc-mainnet": ARC_MAINNET,
};

/** FORUM_CHAIN selects the network; unset means arc-testnet (today's behaviour). */
export function forumChainName(
  env: NodeJS.ProcessEnv = process.env,
): ForumChainName {
  const raw = env.FORUM_CHAIN ?? "arc-testnet";
  if (raw !== "arc-testnet" && raw !== "arc-mainnet") {
    throw new Error(
      `FORUM_CHAIN must be "arc-testnet" or "arc-mainnet", got "${raw}"`,
    );
  }
  return raw;
}

/**
 * The chain selected by FORUM_CHAIN. The RPC URL is the first defined entry of
 * `rpcOverrides` (a script-specific env such as FORUM_INDEXER_RPC or ARC_RPC),
 * then ARC_RPC_URL, then the chain default.
 */
export function arcChain(
  env: NodeJS.ProcessEnv = process.env,
  ...rpcOverrides: (string | undefined)[]
): Chain {
  const base = FORUM_CHAINS[forumChainName(env)];
  const rpc = rpcOverrides.find((u) => u) ?? env.ARC_RPC_URL;
  if (!rpc) return base;
  return { ...base, rpcUrls: { ...base.rpcUrls, default: { http: [rpc] } } };
}

// Polygon mainnet — where Polymarket V2 lives.
export const POLYGON = defineChain({
  id: 137,
  name: "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: ["https://polygon-rpc.com"] } },
  blockExplorers: {
    default: { name: "polygonscan", url: "https://polygonscan.com" },
  },
});
