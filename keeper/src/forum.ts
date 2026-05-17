// Arc-side glue: connect to deployed Forum contracts, register a bot once,
// publish a TrackRecord periodically. EIP-712 signing for record auth.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodeAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ARC_TESTNET } from "./chain.js";

interface Deployment {
  contracts: {
    BuilderCodeRegistry: { address: Address };
    KeeperConfig: { address: Address };
    TrackRecord: { address: Address };
    FeeDistributor: { address: Address };
  };
}

const REGISTER_BOT_ABI = [
  {
    type: "function",
    name: "registerBot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "kind", type: "uint8" },
      { name: "signer", type: "address" },
    ],
    outputs: [],
  },
] as const;

const BOT_SIGNER_ABI = [
  {
    type: "function",
    name: "botSigner",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const DOMAIN_SEPARATOR_ABI = [
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const PUBLISH_ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32" },
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "ts", type: "uint64" },
          { name: "pnlMicros", type: "int128" },
          { name: "fills", type: "uint64" },
          { name: "metaHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const RECORD_TYPEHASH = keccak256(
  toHex(
    "Record(bytes32 botId,uint8 kind,uint64 ts,int128 pnlMicros,uint64 fills,bytes32 metaHash)",
  ),
);

export interface ForumBridgeOptions {
  deploymentPath: string; // forum/deployments/arc-testnet.json
  keyPath?: string; // default: ~/.forum-keys/deployer.key
  botLabel: string; // human-readable bot name (used to derive bot_id)
}

export class ForumBridge {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly account: PrivateKeyAccount;
  readonly addresses: Deployment["contracts"];
  readonly botId: Hex;
  private domainSeparator: Hex | null = null;

  constructor(opts: ForumBridgeOptions) {
    const dep = JSON.parse(
      readFileSync(opts.deploymentPath, "utf8"),
    ) as Deployment;
    this.addresses = dep.contracts;

    const keyPath =
      opts.keyPath ?? join(homedir(), ".forum-keys", "deployer.key");
    const pk = readFileSync(keyPath, "utf8").trim();
    this.account = privateKeyToAccount(
      pk.startsWith("0x") ? (pk as Hex) : (`0x${pk}` as Hex),
    );

    this.publicClient = createPublicClient({
      chain: ARC_TESTNET,
      transport: http(),
    });
    this.walletClient = createWalletClient({
      chain: ARC_TESTNET,
      transport: http(),
      account: this.account,
    });

    this.botId = keccak256(
      toHex(`${this.account.address.toLowerCase()}:${opts.botLabel}`),
    );
  }

  /** Idempotent — registers the bot as MAKER kind with the account as signer if not registered. */
  async ensureRegistered(): Promise<{
    alreadyRegistered: boolean;
    txHash?: Hex;
  }> {
    const existing = (await this.publicClient.readContract({
      address: this.addresses.TrackRecord.address,
      abi: BOT_SIGNER_ABI,
      functionName: "botSigner",
      args: [this.botId],
    })) as Address;
    if (existing !== "0x0000000000000000000000000000000000000000") {
      return { alreadyRegistered: true };
    }
    const hash = await this.walletClient.writeContract({
      address: this.addresses.TrackRecord.address,
      abi: REGISTER_BOT_ABI,
      functionName: "registerBot",
      args: [this.botId, 0, this.account.address], // 0 = MAKER
      account: this.account,
      chain: ARC_TESTNET,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { alreadyRegistered: false, txHash: hash };
  }

  private async getDomainSeparator(): Promise<Hex> {
    if (this.domainSeparator) return this.domainSeparator;
    this.domainSeparator = (await this.publicClient.readContract({
      address: this.addresses.TrackRecord.address,
      abi: DOMAIN_SEPARATOR_ABI,
      functionName: "DOMAIN_SEPARATOR",
    })) as Hex;
    return this.domainSeparator;
  }

  /** Publish a TrackRecord entry. PnL is given in micro-USDC (6 decimals). */
  async publishRecord(
    pnlMicros: bigint,
    fills: number,
    metaHash: Hex,
    ts: number = Math.floor(Date.now() / 1000),
  ): Promise<Hex> {
    const domainSeparator = await this.getDomainSeparator();
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint8" },
          { type: "uint64" },
          { type: "int128" },
          { type: "uint64" },
          { type: "bytes32" },
        ],
        [
          RECORD_TYPEHASH,
          this.botId,
          0,
          BigInt(ts),
          pnlMicros,
          BigInt(fills),
          metaHash,
        ],
      ),
    );
    const digest = keccak256(
      `0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex,
    );
    const signature = await this.account.sign({ hash: digest });

    return this.walletClient.writeContract({
      address: this.addresses.TrackRecord.address,
      abi: PUBLISH_ABI,
      functionName: "publish",
      args: [
        this.botId,
        { ts: BigInt(ts), pnlMicros, fills: BigInt(fills), metaHash },
        signature,
      ],
      account: this.account,
      chain: ARC_TESTNET,
    });
  }
}
