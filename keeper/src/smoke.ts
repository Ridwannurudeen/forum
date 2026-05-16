// Day 0 / Day 2 smoke test: verify Arc testnet RPC is reachable and
// @polymarket/clob-client-v2 imports cleanly. Run after `npm install`:
//   npx tsx src/smoke.ts

import { createPublicClient, http, defineChain } from "viem";

const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: {
    default: { name: "arcscan", url: "https://testnet.arcscan.app" },
  },
});

async function main() {
  const client = createPublicClient({ chain: ARC_TESTNET, transport: http() });

  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();
  console.log(`Arc testnet OK  chainId=${chainId}  block=${blockNumber}`);

  // Verify clob-client-v2 imports
  const sdk = await import("@polymarket/clob-client-v2");
  const sdkKeys = Object.keys(sdk).slice(0, 10);
  console.log(`@polymarket/clob-client-v2 OK  exports=${sdkKeys.join(",")}`);
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
