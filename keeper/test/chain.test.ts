import { describe, it, expect } from "vitest";
import { createWalletClient, custom, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareTransactionRequest } from "viem/actions";
import {
  ARC_MAINNET,
  ARC_MAINNET_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET,
  arcChain,
  arcMainnetFeeFloor,
  forumChainName,
} from "../src/chain.js";

const FLOOR = parseGwei("21");
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);

// What rpc.mainnet.arc.io answered a read-only eth_fillTransaction probe with
// on 2026-10-14: base fee pinned at the 20 gwei floor, a 1337 wei tip.
const NODE_BASE_FEE = "0x4a817c800"; // 20 gwei
const NODE_FILLED_MAX_FEE = "0x4a817cd39"; // 20.000001337 gwei
const NODE_FILLED_TIP = "0x539";

/** A fake Arc node. `echoFees` mirrors geth: fees the caller provides are kept. */
function arcNode(echoFees: boolean) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_chainId":
          return "0x13b2";
        case "eth_fillTransaction": {
          const [tx] = params as [Record<string, string | undefined>];
          return {
            raw: "0x",
            tx: {
              type: "0x2",
              chainId: "0x13b2",
              nonce: "0x3",
              gas: "0x5208",
              maxFeePerGas:
                echoFees && tx.maxFeePerGas
                  ? tx.maxFeePerGas
                  : NODE_FILLED_MAX_FEE,
              maxPriorityFeePerGas:
                echoFees && tx.maxPriorityFeePerGas
                  ? tx.maxPriorityFeePerGas
                  : NODE_FILLED_TIP,
              to: tx.to,
              value: "0x0",
              input: "0x",
              accessList: [],
            },
          };
        }
        case "eth_getTransactionCount":
          return "0x3";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_getBlockByNumber":
          return {
            number: "0x18b8d9c",
            baseFeePerGas: NODE_BASE_FEE,
            hash: `0x${"ab".repeat(32)}`,
            parentHash: `0x${"cd".repeat(32)}`,
            timestamp: "0x68ee0000",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            transactions: [],
            miner: `0x${"00".repeat(20)}`,
            difficulty: "0x0",
            extraData: "0x",
            logsBloom: `0x${"00".repeat(256)}`,
            nonce: "0x0000000000000000",
            sha3Uncles: `0x${"00".repeat(32)}`,
            size: "0x0",
            stateRoot: `0x${"00".repeat(32)}`,
            receiptsRoot: `0x${"00".repeat(32)}`,
            transactionsRoot: `0x${"00".repeat(32)}`,
            totalDifficulty: "0x0",
            uncles: [],
            mixHash: `0x${"00".repeat(32)}`,
          };
        default:
          throw new Error(`unexpected rpc method ${method}`);
      }
    },
  });
}

describe("chain definitions", () => {
  it("ARC_MAINNET is chain 5042 with the Arc defaults", () => {
    expect(ARC_MAINNET.id).toBe(5042);
    expect(ARC_MAINNET.name).toBe("Arc");
    expect(ARC_MAINNET.nativeCurrency).toEqual({
      name: "USDC",
      symbol: "USDC",
      decimals: 18,
    });
    expect(ARC_MAINNET.rpcUrls.default.http).toEqual([
      "https://rpc.mainnet.arc.io",
    ]);
    expect(ARC_MAINNET.blockExplorers?.default.url).toBe(
      "https://explorer.arc.io",
    );
  });

  it("ARC_TESTNET is unchanged and carries no fee hook", () => {
    expect(ARC_TESTNET.id).toBe(5042002);
    expect(ARC_TESTNET.prepareTransactionRequest).toBeUndefined();
  });

  it("the floor constant is 21 gwei", () => {
    expect(ARC_MAINNET_MIN_MAX_FEE_PER_GAS).toBe(FLOOR);
  });
});

describe("arcMainnetFeeFloor", () => {
  it("fills absent EIP-1559 fees at the floor", () => {
    const out = arcMainnetFeeFloor({ type: "eip1559" });
    expect(out.maxFeePerGas).toBe(FLOOR);
    expect(out.maxPriorityFeePerGas).toBe(parseGwei("1"));
  });

  it("raises the node's sub-floor fill to the floor", () => {
    const out = arcMainnetFeeFloor({
      type: "eip1559",
      maxFeePerGas: BigInt(NODE_FILLED_MAX_FEE),
      maxPriorityFeePerGas: BigInt(NODE_FILLED_TIP),
    });
    expect(out.maxFeePerGas).toBe(FLOOR);
    expect(out.maxPriorityFeePerGas).toBe(parseGwei("1"));
  });

  it("never lowers a higher estimate", () => {
    const out = arcMainnetFeeFloor({
      type: "eip1559",
      maxFeePerGas: parseGwei("30"),
      maxPriorityFeePerGas: parseGwei("2"),
    });
    expect(out.maxFeePerGas).toBe(parseGwei("30"));
    expect(out.maxPriorityFeePerGas).toBe(parseGwei("2"));
  });

  it("clamps gasPrice on legacy requests and leaves 1559 fields alone", () => {
    const out = arcMainnetFeeFloor({
      type: "legacy",
      gasPrice: parseGwei("5"),
    });
    expect(out.gasPrice).toBe(FLOOR);
    expect(out.maxFeePerGas).toBeUndefined();
  });

  it("treats an untyped request carrying gasPrice as legacy", () => {
    const out = arcMainnetFeeFloor({ gasPrice: parseGwei("5") });
    expect(out.gasPrice).toBe(FLOOR);
    expect(out.maxFeePerGas).toBeUndefined();
    expect(out.maxPriorityFeePerGas).toBeUndefined();
  });
});

describe("ARC_MAINNET fee floor through viem prepareTransactionRequest", () => {
  const to = account.address;

  it("applies when the node echoes caller fees (geth-style fill)", async () => {
    const client = createWalletClient({
      account,
      chain: ARC_MAINNET,
      transport: arcNode(true),
    });
    const req = await prepareTransactionRequest(client, { to, value: 0n });
    expect(req.maxFeePerGas).toBe(FLOOR);
    expect(req.maxPriorityFeePerGas).toBe(parseGwei("1"));
    expect(req.gas).toBe(21000n);
    expect(req.nonce).toBe(3);
  });

  it("still applies when the node overwrites fees with its sub-floor fill", async () => {
    const client = createWalletClient({
      account,
      chain: ARC_MAINNET,
      transport: arcNode(false),
    });
    const req = await prepareTransactionRequest(client, { to, value: 0n });
    expect(req.maxFeePerGas).toBe(FLOOR);
    expect(req.maxPriorityFeePerGas).toBe(parseGwei("1"));
  });

  it("keeps an explicit higher maxFeePerGas", async () => {
    const client = createWalletClient({
      account,
      chain: ARC_MAINNET,
      transport: arcNode(true),
    });
    const req = await prepareTransactionRequest(client, {
      to,
      value: 0n,
      maxFeePerGas: parseGwei("40"),
      maxPriorityFeePerGas: parseGwei("3"),
    });
    expect(req.maxFeePerGas).toBe(parseGwei("40"));
    expect(req.maxPriorityFeePerGas).toBe(parseGwei("3"));
  });

  it("does not touch testnet requests (viem's own 1.2x scaling of the node fill is all that applies)", async () => {
    const client = createWalletClient({
      account,
      chain: ARC_TESTNET,
      transport: arcNode(false),
    });
    const req = await prepareTransactionRequest(client, { to, value: 0n });
    expect(req.maxFeePerGas).toBe((BigInt(NODE_FILLED_MAX_FEE) * 12n) / 10n);
    expect(req.maxPriorityFeePerGas).toBe(BigInt(NODE_FILLED_TIP));
  });
});

describe("forumChainName / arcChain", () => {
  it("defaults to arc-testnet", () => {
    expect(forumChainName({})).toBe("arc-testnet");
    expect(arcChain({}).id).toBe(5042002);
  });

  it("selects mainnet with FORUM_CHAIN=arc-mainnet and keeps the fee hook", () => {
    const chain = arcChain({ FORUM_CHAIN: "arc-mainnet" });
    expect(chain.id).toBe(5042);
    expect(chain.prepareTransactionRequest).toBe(
      ARC_MAINNET.prepareTransactionRequest,
    );
  });

  it("rejects an unknown FORUM_CHAIN instead of silently defaulting", () => {
    expect(() => forumChainName({ FORUM_CHAIN: "arc" })).toThrow(/FORUM_CHAIN/);
  });

  it("RPC precedence: script override, then ARC_RPC_URL, then chain default", () => {
    const env = { FORUM_CHAIN: "arc-mainnet", ARC_RPC_URL: "http://common" };
    expect(arcChain(env).rpcUrls.default.http).toEqual(["http://common"]);
    expect(
      arcChain(env, undefined, "http://script").rpcUrls.default.http,
    ).toEqual(["http://script"]);
    expect(
      arcChain({ FORUM_CHAIN: "arc-mainnet" }).rpcUrls.default.http,
    ).toEqual(["https://rpc.mainnet.arc.io"]);
  });
});
