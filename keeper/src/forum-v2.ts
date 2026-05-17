// Forum v2 bridge — talks to TrackRecordV2 contract + writes receipts.
//
// The keeper accumulates fills/inventory/decisions during a period, builds a
// Receipt JSON, persists it to disk (served as a static file by nginx so
// `evidenceUri = https://forum.gudman.xyz/receipts/<bothex>/<seq>.json`),
// computes its keccak hash, then publishes a TrackRecordV2 record with the
// strict-sequence + prev-hash-chain + replay constraints enforced on-chain.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
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
import { canonicalize, type Receipt } from "./receipt.js";

const RECORD_TYPEHASH = keccak256(
  toHex(
    "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)",
  ),
);

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

const LAST_SEQ_ABI = [
  {
    type: "function",
    name: "lastSeq",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
] as const;

const LAST_RECORD_HASH_ABI = [
  {
    type: "function",
    name: "lastRecordHash",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
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

const PUBLISH_V2_ABI = [
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
          { name: "seq", type: "uint64" },
          { name: "periodStart", type: "uint64" },
          { name: "periodEnd", type: "uint64" },
          { name: "pnlMicros", type: "int128" },
          { name: "fills", type: "uint64" },
          { name: "metaHash", type: "bytes32" },
          { name: "evidenceUri", type: "string" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "prevRecordHash", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

interface Deployment {
  contracts: {
    TrackRecordV2: { address: Address };
  };
}

export interface ForumV2BridgeOptions {
  deploymentPath: string;
  keyPath?: string;
  botLabel: string;
  /** Directory to persist receipts as JSON files. */
  receiptsDir: string;
  /** Base URL that serves receiptsDir (e.g. https://forum.gudman.xyz/receipts). */
  receiptsBaseUrl: string;
}

export class ForumV2Bridge {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly account: PrivateKeyAccount;
  readonly v2Address: Address;
  readonly botId: Hex;
  private readonly receiptsDir: string;
  private readonly receiptsBaseUrl: string;
  private domainSeparator: Hex | null = null;

  constructor(opts: ForumV2BridgeOptions) {
    const dep = JSON.parse(
      readFileSync(opts.deploymentPath, "utf8"),
    ) as Deployment;
    this.v2Address = dep.contracts.TrackRecordV2.address;

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
    this.receiptsDir = opts.receiptsDir;
    this.receiptsBaseUrl = opts.receiptsBaseUrl.replace(/\/+$/, "");
    mkdirSync(this.receiptsDir, { recursive: true });
  }

  async ensureRegistered(
    kind: number = 0,
  ): Promise<{ alreadyRegistered: boolean; txHash?: Hex }> {
    const existing = (await this.publicClient.readContract({
      address: this.v2Address,
      abi: BOT_SIGNER_ABI,
      functionName: "botSigner",
      args: [this.botId],
    })) as Address;
    if (existing !== "0x0000000000000000000000000000000000000000") {
      return { alreadyRegistered: true };
    }
    const hash = await this.walletClient.writeContract({
      address: this.v2Address,
      abi: REGISTER_BOT_ABI,
      functionName: "registerBot",
      args: [this.botId, kind, this.account.address],
      account: this.account,
      chain: ARC_TESTNET,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { alreadyRegistered: false, txHash: hash };
  }

  async lastSeq(): Promise<number> {
    const r = (await this.publicClient.readContract({
      address: this.v2Address,
      abi: LAST_SEQ_ABI,
      functionName: "lastSeq",
      args: [this.botId],
    })) as bigint;
    return Number(r);
  }

  async lastRecordHash(): Promise<Hex> {
    return (await this.publicClient.readContract({
      address: this.v2Address,
      abi: LAST_RECORD_HASH_ABI,
      functionName: "lastRecordHash",
      args: [this.botId],
    })) as Hex;
  }

  private async getDomainSeparator(): Promise<Hex> {
    if (this.domainSeparator) return this.domainSeparator;
    this.domainSeparator = (await this.publicClient.readContract({
      address: this.v2Address,
      abi: DOMAIN_SEPARATOR_ABI,
      functionName: "DOMAIN_SEPARATOR",
    })) as Hex;
    return this.domainSeparator;
  }

  /** Persist a receipt to disk and return its public URI + hash. */
  writeReceipt(
    seq: number,
    receipt: Receipt,
  ): { uri: string; hash: Hex; localPath: string } {
    const botShort = this.botId.slice(2, 14);
    const dir = join(this.receiptsDir, botShort);
    mkdirSync(dir, { recursive: true });
    const json = canonicalize(receipt);
    const hash = keccak256(toHex(json));
    const filename = `${String(seq).padStart(6, "0")}.json`;
    const localPath = join(dir, filename);
    writeFileSync(localPath, json + "\n");
    const uri = `${this.receiptsBaseUrl}/${botShort}/${filename}`;
    return { uri, hash, localPath };
  }

  /** Publish a record to TrackRecordV2. Strict sequence + chain checked on-chain. */
  async publishRecord(
    rec: {
      seq: number;
      periodStart: number;
      periodEnd: number;
      pnlMicros: bigint;
      fills: number;
      metaHash: Hex;
      evidenceUri: string;
      evidenceHash: Hex;
      prevRecordHash: Hex;
    },
    kind: number = 0,
  ): Promise<Hex> {
    const domainSeparator = await this.getDomainSeparator();
    const evidenceUriHash = keccak256(toHex(rec.evidenceUri));
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint8" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "int128" },
          { type: "uint64" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [
          RECORD_TYPEHASH,
          this.botId,
          kind,
          BigInt(rec.seq),
          BigInt(rec.periodStart),
          BigInt(rec.periodEnd),
          rec.pnlMicros,
          BigInt(rec.fills),
          rec.metaHash,
          evidenceUriHash,
          rec.evidenceHash,
          rec.prevRecordHash,
        ],
      ),
    );
    const digest = keccak256(
      `0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex,
    );
    const signature = await this.account.sign({ hash: digest });

    return this.walletClient.writeContract({
      address: this.v2Address,
      abi: PUBLISH_V2_ABI,
      functionName: "publish",
      args: [
        this.botId,
        {
          seq: BigInt(rec.seq),
          periodStart: BigInt(rec.periodStart),
          periodEnd: BigInt(rec.periodEnd),
          pnlMicros: rec.pnlMicros,
          fills: BigInt(rec.fills),
          metaHash: rec.metaHash,
          evidenceUri: rec.evidenceUri,
          evidenceHash: rec.evidenceHash,
          prevRecordHash: rec.prevRecordHash,
        },
        signature,
      ],
      account: this.account,
      chain: ARC_TESTNET,
    });
  }
}

// Helper to compute the path to deployments JSON.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolvePath(__dirname, "..", "..");
