import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  encodeAbiParameters,
  keccak256,
  toHex,
} from "viem";
import {
  builderCodeRegistryAbi,
  keeperConfigAbi,
  trackRecordAbi,
  feeDistributorAbi,
} from "./abi.js";
import {
  BOT_KIND_ENUM,
  type BotKind,
  type ForumAddresses,
  type TrackRecord,
} from "./types.js";

export interface ForumClientOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  addresses: ForumAddresses;
}

export class ForumClient {
  public readonly registry: RegistryClient;
  public readonly config: ConfigClient;
  public readonly trackRecord: TrackRecordClient;
  public readonly feeDistributor: FeeDistributorClient;

  constructor(opts: ForumClientOptions) {
    this.registry = new RegistryClient(opts);
    this.config = new ConfigClient(opts);
    this.trackRecord = new TrackRecordClient(opts);
    this.feeDistributor = new FeeDistributorClient(opts);
  }
}

abstract class BaseSubClient {
  protected readonly publicClient: PublicClient;
  protected readonly walletClient: WalletClient | undefined;
  protected readonly addresses: ForumAddresses;
  constructor(opts: ForumClientOptions) {
    this.publicClient = opts.publicClient;
    this.walletClient = opts.walletClient;
    this.addresses = opts.addresses;
  }
  protected requireWallet(): WalletClient {
    if (!this.walletClient)
      throw new Error("ForumClient: walletClient required for write call");
    return this.walletClient;
  }
  protected account(): Account {
    const w = this.requireWallet();
    if (!w.account) throw new Error("ForumClient: walletClient has no account");
    return w.account;
  }
}

export class RegistryClient extends BaseSubClient {
  async ownerOf(code: Hex): Promise<Address> {
    return (await this.publicClient.readContract({
      address: this.addresses.registry,
      abi: builderCodeRegistryAbi,
      functionName: "ownerOf",
      args: [code],
    })) as Address;
  }
  async metadataUri(code: Hex): Promise<string> {
    return (await this.publicClient.readContract({
      address: this.addresses.registry,
      abi: builderCodeRegistryAbi,
      functionName: "metadataUri",
      args: [code],
    })) as string;
  }
  async claim(code: Hex): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.registry,
      abi: builderCodeRegistryAbi,
      functionName: "claim",
      args: [code],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async transfer(code: Hex, to: Address): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.registry,
      abi: builderCodeRegistryAbi,
      functionName: "transfer",
      args: [code, to],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async revoke(code: Hex): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.registry,
      abi: builderCodeRegistryAbi,
      functionName: "revoke",
      args: [code],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async setMetadata(code: Hex, uri: string): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.registry,
      abi: builderCodeRegistryAbi,
      functionName: "setMetadata",
      args: [code, uri],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export interface ConfigSnapshot {
  version: bigint;
  updatedAt: bigint;
  data: Hex;
}

export class ConfigClient extends BaseSubClient {
  async setConfig(botId: Hex, data: Hex): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.config,
      abi: keeperConfigAbi,
      functionName: "setConfig",
      args: [botId, data],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async getConfig(operator: Address, botId: Hex): Promise<ConfigSnapshot> {
    const s = (await this.publicClient.readContract({
      address: this.addresses.config,
      abi: keeperConfigAbi,
      functionName: "getConfig",
      args: [operator, botId],
    })) as { version: bigint; updatedAt: bigint; data: Hex };
    return s;
  }
  async historyLength(operator: Address, botId: Hex): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.addresses.config,
      abi: keeperConfigAbi,
      functionName: "historyLength",
      args: [operator, botId],
    })) as bigint;
  }
  async snapshotAt(
    operator: Address,
    botId: Hex,
    idx: bigint,
  ): Promise<ConfigSnapshot> {
    const s = (await this.publicClient.readContract({
      address: this.addresses.config,
      abi: keeperConfigAbi,
      functionName: "snapshotAt",
      args: [operator, botId, idx],
    })) as { version: bigint; updatedAt: bigint; data: Hex };
    return s;
  }
}

const RECORD_TYPEHASH = keccak256(
  toHex(
    "Record(bytes32 botId,uint8 kind,uint64 ts,int128 pnlMicros,uint64 fills,bytes32 metaHash)",
  ),
);

export class TrackRecordClient extends BaseSubClient {
  async domainSeparator(): Promise<Hex> {
    return (await this.publicClient.readContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "DOMAIN_SEPARATOR",
    })) as Hex;
  }
  async kind(botId: Hex): Promise<BotKind> {
    const k = (await this.publicClient.readContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "botKind",
      args: [botId],
    })) as number;
    const lookup = (Object.entries(BOT_KIND_ENUM) as [BotKind, number][]).find(
      ([, v]) => v === k,
    );
    if (!lookup) throw new Error(`Unknown bot kind enum: ${k}`);
    return lookup[0];
  }
  async signer(botId: Hex): Promise<Address> {
    return (await this.publicClient.readContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "botSigner",
      args: [botId],
    })) as Address;
  }
  async registerBot(botId: Hex, kind: BotKind, signer: Address): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "registerBot",
      args: [botId, BOT_KIND_ENUM[kind], signer],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async recordCount(botId: Hex): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "recordCount",
      args: [botId],
    })) as bigint;
  }
  async recordAt(botId: Hex, idx: bigint): Promise<TrackRecord> {
    const r = (await this.publicClient.readContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "recordAt",
      args: [botId, idx],
    })) as { ts: bigint; pnlMicros: bigint; fills: bigint; metaHash: Hex };
    return {
      ts: Number(r.ts),
      pnlMicros: r.pnlMicros,
      fills: Number(r.fills),
      metaHash: r.metaHash,
    };
  }

  /** Returns the EIP-712 struct hash for a record. Sign with the bot's signer key. */
  structHash(botId: Hex, kind: BotKind, rec: TrackRecord): Hex {
    return keccak256(
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
          botId,
          BOT_KIND_ENUM[kind],
          BigInt(rec.ts),
          rec.pnlMicros,
          BigInt(rec.fills),
          rec.metaHash,
        ],
      ),
    );
  }

  /** Compose the final EIP-712 digest given a domain separator. */
  digest(domainSeparator: Hex, structHash: Hex): Hex {
    return keccak256(
      `0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex,
    );
  }

  async publish(botId: Hex, rec: TrackRecord, signature: Hex): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.trackRecord,
      abi: trackRecordAbi,
      functionName: "publish",
      args: [
        botId,
        {
          ts: BigInt(rec.ts),
          pnlMicros: rec.pnlMicros,
          fills: BigInt(rec.fills),
          metaHash: rec.metaHash,
        },
        signature,
      ],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export interface Attribution {
  recipients: Address[];
  bps: number[];
}

export class FeeDistributorClient extends BaseSubClient {
  async claimable(who: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "claimable",
      args: [who],
    })) as bigint;
  }
  async attributionOf(code: Hex): Promise<Attribution> {
    const a = (await this.publicClient.readContract({
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "attributionOf",
      args: [code],
    })) as { recipients: Address[]; bps: readonly number[] };
    return { recipients: [...a.recipients], bps: [...a.bps] };
  }
  async setAttribution(
    code: Hex,
    recipients: Address[],
    bps: number[],
  ): Promise<Hex> {
    if (recipients.length !== bps.length)
      throw new Error("ForumClient: recipients/bps length mismatch");
    const sum = bps.reduce((a, b) => a + b, 0);
    if (sum !== 10_000)
      throw new Error(`ForumClient: bps must sum to 10000 (got ${sum})`);
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "setAttribution",
      args: [code, recipients, bps],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async distribute(code: Hex, amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "distribute",
      args: [code, amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async claim(): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "claim",
      args: [],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}
