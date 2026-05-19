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
  agentPoolAbi,
  builderCodeRegistryAbi,
  capitalRouterAbi,
  covenantInboxAbi,
  covenantVaultAbi,
  covenantVaultFactoryAbi,
  feeRouterV1Abi,
  keeperConfigAbi,
  trackRecordAbi,
  feeDistributorAbi,
  riskKernelV2Abi,
  slashBondAbi,
  slashInsuranceAbi,
  slashMarketAbi,
  trackRecordV2Abi,
} from "./abi.js";
import {
  BOT_KIND_ENUM,
  type BotKind,
  type CovenantMandate,
  type CovenantState,
  type ForumAddresses,
  type RiskVerdict,
  type TrackRecord,
  type TrackRecordV2Record,
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
  public readonly trackRecordV2: TrackRecordV2Client;
  public readonly covenantVault: CovenantVaultClient;
  public readonly riskKernel: RiskKernelClient;
  public readonly slashBond: SlashBondClient;
  public readonly agentPool: AgentPoolClient;
  public readonly covenantVaultFactory: CovenantVaultFactoryClient;
  public readonly covenantInbox: CovenantInboxClient;
  public readonly capitalRouter: CapitalRouterClient;
  public readonly slashMarket: SlashMarketClient;
  public readonly slashInsurance: SlashInsuranceClient;
  public readonly feeRouterV1: FeeRouterV1Client;

  constructor(opts: ForumClientOptions) {
    this.registry = new RegistryClient(opts);
    this.config = new ConfigClient(opts);
    this.trackRecord = new TrackRecordClient(opts);
    this.feeDistributor = new FeeDistributorClient(opts);
    this.trackRecordV2 = new TrackRecordV2Client(opts);
    this.covenantVault = new CovenantVaultClient(opts);
    this.riskKernel = new RiskKernelClient(opts);
    this.slashBond = new SlashBondClient(opts);
    this.agentPool = new AgentPoolClient(opts);
    this.covenantVaultFactory = new CovenantVaultFactoryClient(opts);
    this.covenantInbox = new CovenantInboxClient(opts);
    this.capitalRouter = new CapitalRouterClient(opts);
    this.slashMarket = new SlashMarketClient(opts);
    this.slashInsurance = new SlashInsuranceClient(opts);
    this.feeRouterV1 = new FeeRouterV1Client(opts);
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
  protected requireAddress(key: keyof ForumAddresses): Address {
    const addr = this.addresses[key];
    if (!addr) throw new Error(`ForumClient: addresses.${key} is required`);
    return addr;
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

const RECORD_V2_TYPEHASH = keccak256(
  toHex(
    "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)",
  ),
);

export interface TrackRecordV2PublishInput {
  seq: number;
  periodStart: number;
  periodEnd: number;
  pnlMicros: bigint;
  fills: number;
  metaHash: Hex;
  evidenceUri: string;
  evidenceHash: Hex;
  prevRecordHash: Hex;
}

export class TrackRecordV2Client extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("trackRecordV2");
  }

  async domainSeparator(): Promise<Hex> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "DOMAIN_SEPARATOR",
    })) as Hex;
  }

  async signer(botId: Hex): Promise<Address> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "botSigner",
      args: [botId],
    })) as Address;
  }

  async lastSeq(botId: Hex): Promise<number> {
    const seq = (await this.publicClient.readContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "lastSeq",
      args: [botId],
    })) as bigint;
    return Number(seq);
  }

  async lastRecordHash(botId: Hex): Promise<Hex> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "lastRecordHash",
      args: [botId],
    })) as Hex;
  }

  async registerBot(botId: Hex, kind: BotKind, signer: Address): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "registerBot",
      args: [botId, BOT_KIND_ENUM[kind], signer],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async recordCount(botId: Hex): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "recordCount",
      args: [botId],
    })) as bigint;
  }

  async recordAt(botId: Hex, idx: bigint): Promise<TrackRecordV2Record> {
    const r = (await this.publicClient.readContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "recordAt",
      args: [botId, idx],
    })) as {
      seq: bigint;
      periodStart: bigint;
      periodEnd: bigint;
      pnlMicros: bigint;
      fills: bigint;
      metaHash: Hex;
      evidenceUriHash: Hex;
      evidenceHash: Hex;
      recordHash: Hex;
    };
    return {
      seq: Number(r.seq),
      periodStart: Number(r.periodStart),
      periodEnd: Number(r.periodEnd),
      pnlMicros: r.pnlMicros,
      fills: Number(r.fills),
      metaHash: r.metaHash,
      evidenceUriHash: r.evidenceUriHash,
      evidenceHash: r.evidenceHash,
      recordHash: r.recordHash,
    };
  }

  structHash(botId: Hex, kind: BotKind, rec: TrackRecordV2PublishInput): Hex {
    const evidenceUriHash = keccak256(toHex(rec.evidenceUri));
    return keccak256(
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
          RECORD_V2_TYPEHASH,
          botId,
          BOT_KIND_ENUM[kind],
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
  }

  digest(domainSeparator: Hex, structHash: Hex): Hex {
    return keccak256(
      `0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex,
    );
  }

  async publish(
    botId: Hex,
    rec: TrackRecordV2PublishInput,
    signature: Hex,
  ): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: trackRecordV2Abi,
      functionName: "publish",
      args: [
        botId,
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
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

const COVENANT_STATE_NAMES: CovenantState[] = ["ACTIVE", "PAUSED"];
const RISK_VERDICT_NAMES: RiskVerdict[] = [
  "ALLOW",
  "PAUSE_DRAWDOWN",
  "PAUSE_OVERSUBSCRIBED",
  "PAUSE_STALE",
  "PAUSE_EXPIRED",
];

function covenantStateName(v: number): CovenantState {
  const name = COVENANT_STATE_NAMES[v];
  if (!name) throw new Error(`Unknown CovenantVault state: ${v}`);
  return name;
}

function riskVerdictName(v: number): RiskVerdict {
  const name = RISK_VERDICT_NAMES[v];
  if (!name) throw new Error(`Unknown RiskKernel verdict: ${v}`);
  return name;
}

function mandateFromTuple(m: readonly unknown[]): CovenantMandate {
  return {
    operator: m[0] as Address,
    botId: m[1] as Hex,
    budgetUsdc: m[2] as bigint,
    maxDrawdownBps: Number(m[3]),
    receiptFreshnessSec: Number(m[4]),
    expiry: m[5] as bigint,
    perfFeeBps: Number(m[6]),
    bondContract: m[7] as Address,
    riskKernel: m[8] as Address,
    trackRecordV2: m[9] as Address,
  };
}

export interface CovenantVaultSnapshot {
  state: CovenantState;
  mandate: CovenantMandate;
  assets: bigint;
  idle: bigint;
  operatorOutstanding: bigint;
  availableCredit: bigint;
  totalShares: bigint;
  highWaterMark: bigint;
  operatorClaimable: bigint;
}

export class CovenantVaultClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("covenantVault");
  }

  async mandate(): Promise<CovenantMandate> {
    const m = (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "mandate",
    })) as readonly unknown[];
    return mandateFromTuple(m);
  }

  async state(): Promise<CovenantState> {
    const state = (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "state",
    })) as number;
    return covenantStateName(Number(state));
  }

  async snapshot(): Promise<CovenantVaultSnapshot> {
    const [
      state,
      mandate,
      assets,
      idle,
      operatorOutstanding,
      availableCredit,
      totalShares,
      highWaterMark,
      operatorClaimable,
    ] = await Promise.all([
      this.state(),
      this.mandate(),
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "assets",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "depositTotalIdle",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "operatorOutstanding",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "availableCredit",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "totalShares",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "highWaterMark",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: covenantVaultAbi,
        functionName: "operatorClaimable",
      }) as Promise<bigint>,
    ]);
    return {
      state,
      mandate,
      assets,
      idle,
      operatorOutstanding,
      availableCredit,
      totalShares,
      highWaterMark,
      operatorClaimable,
    };
  }

  async sharesOf(user: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "sharesOf",
      args: [user],
    })) as bigint;
  }

  async deposit(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "deposit",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async withdraw(shares: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "withdraw",
      args: [shares],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async pullCredit(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "pullCredit",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async returnCapital(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantVaultAbi,
      functionName: "returnCapital",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export class RiskKernelClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("riskKernel");
  }

  async evaluate(vault?: Address): Promise<RiskVerdict> {
    const verdict = (await this.publicClient.readContract({
      address: this.address(),
      abi: riskKernelV2Abi,
      functionName: "evaluate",
      args: [vault ?? this.requireAddress("covenantVault")],
    })) as number;
    return riskVerdictName(Number(verdict));
  }

  async enforce(vault?: Address): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: riskKernelV2Abi,
      functionName: "enforce",
      args: [vault ?? this.requireAddress("covenantVault")],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export class SlashBondClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("slashBond");
  }

  async bondBalance(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashBondAbi,
      functionName: "bondBalance",
    })) as bigint;
  }

  async totalSlashed(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashBondAbi,
      functionName: "totalSlashed",
    })) as bigint;
  }

  async bond(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashBondAbi,
      functionName: "bond",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async requestUnbond(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashBondAbi,
      functionName: "requestUnbond",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export class AgentPoolClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("agentPool");
  }

  async assets(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: agentPoolAbi,
      functionName: "assets",
    })) as bigint;
  }

  async sharesOf(user: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: agentPoolAbi,
      functionName: "sharesOf",
      args: [user],
    })) as bigint;
  }

  async deposit(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: agentPoolAbi,
      functionName: "deposit",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async withdraw(shares: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: agentPoolAbi,
      functionName: "withdraw",
      args: [shares],
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

export class CovenantVaultFactoryClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("covenantVaultFactory");
  }

  async vaultCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultFactoryAbi,
      functionName: "vaultCount",
    })) as bigint;
  }

  async allVaults(): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultFactoryAbi,
      functionName: "allVaults",
    })) as Address[];
  }

  async vaultsByCreator(creator: Address): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultFactoryAbi,
      functionName: "vaultsByCreator",
      args: [creator],
    })) as Address[];
  }

  async vaultsByOperator(operator: Address): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultFactoryAbi,
      functionName: "vaultsByOperator",
      args: [operator],
    })) as Address[];
  }

  async vaultsByBotId(botId: Hex): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantVaultFactoryAbi,
      functionName: "vaultsByBotId",
      args: [botId],
    })) as Address[];
  }

  async createVault(mandate: CovenantMandate): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantVaultFactoryAbi,
      functionName: "createVault",
      args: [mandate],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export class CovenantInboxClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("covenantInbox");
  }

  async sharesOf(vault: Address, recipient: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: covenantInboxAbi,
      functionName: "sharesOf",
      args: [vault, recipient],
    })) as bigint;
  }

  async depositInto(
    vault: Address,
    recipient: Address,
    amount: bigint,
  ): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantInboxAbi,
      functionName: "depositInto",
      args: [vault, recipient, amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }

  async claim(vault: Address, shares: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: covenantInboxAbi,
      functionName: "claim",
      args: [vault, shares],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export interface CapitalRouterSnapshot {
  strategist: Address;
  idleUsdc: bigint;
  totalShares: bigint;
  assets: bigint;
  targets: Address[];
  weights: number[];
}

export class CapitalRouterClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("capitalRouter");
  }
  async snapshot(): Promise<CapitalRouterSnapshot> {
    const [strategist, idleUsdc, totalShares, assets, targets, weights] =
      await Promise.all([
        this.publicClient.readContract({
          address: this.address(),
          abi: capitalRouterAbi,
          functionName: "strategist",
        }) as Promise<Address>,
        this.publicClient.readContract({
          address: this.address(),
          abi: capitalRouterAbi,
          functionName: "idleUsdc",
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: this.address(),
          abi: capitalRouterAbi,
          functionName: "totalShares",
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: this.address(),
          abi: capitalRouterAbi,
          functionName: "assets",
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: this.address(),
          abi: capitalRouterAbi,
          functionName: "targets",
        }) as Promise<Address[]>,
        this.publicClient.readContract({
          address: this.address(),
          abi: capitalRouterAbi,
          functionName: "weights",
        }) as Promise<readonly number[]>,
      ]);
    return {
      strategist,
      idleUsdc,
      totalShares,
      assets,
      targets: [...targets],
      weights: [...weights],
    };
  }
  async sharesOf(user: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: capitalRouterAbi,
      functionName: "sharesOf",
      args: [user],
    })) as bigint;
  }
  async setStrategy(vaults: Address[], weightsBps: number[]): Promise<Hex> {
    if (vaults.length !== weightsBps.length)
      throw new Error("ForumClient: vaults/weightsBps length mismatch");
    const sum = weightsBps.reduce((a, b) => a + b, 0);
    if (sum !== 10_000)
      throw new Error(`ForumClient: weightsBps must sum to 10000 (got ${sum})`);
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: capitalRouterAbi,
      functionName: "setStrategy",
      args: [vaults, weightsBps],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async deposit(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: capitalRouterAbi,
      functionName: "deposit",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async withdraw(shares: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: capitalRouterAbi,
      functionName: "withdraw",
      args: [shares],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async rebalance(): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: capitalRouterAbi,
      functionName: "rebalance",
      args: [],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export interface SlashMarketSnapshot {
  bond: Address;
  createdAt: bigint;
  expiryAt: bigint;
  slashedSnapshot: bigint;
  yesStake: bigint;
  noStake: bigint;
  settled: boolean;
  didSlash: boolean;
  newSlashedAtSettle: bigint;
}

export class SlashMarketClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("slashMarket");
  }
  async marketCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "marketCount",
    })) as bigint;
  }
  async marketAt(id: bigint): Promise<SlashMarketSnapshot> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "marketAt",
      args: [id],
    })) as SlashMarketSnapshot;
  }
  async stakeOf(id: bigint, user: Address, yesSide: boolean): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "stakeOf",
      args: [id, user, yesSide],
    })) as bigint;
  }
  async claimed(id: bigint, user: Address): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "claimed",
      args: [id, user],
    })) as boolean;
  }
  async createMarket(bond: Address, expiryAt: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "createMarket",
      args: [bond, expiryAt],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async stake(id: bigint, yesSide: boolean, amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "stake",
      args: [id, yesSide, amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async settle(id: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "settle",
      args: [id],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async claim(id: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashMarketAbi,
      functionName: "claim",
      args: [id],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export interface SlashInsuranceSnapshot {
  bond: Address;
  topUpRecipient: Address;
  totalPremium: bigint;
  totalPaidOut: bigint;
  lastSlashedSnapshot: bigint;
  poolBalance: bigint;
}

export class SlashInsuranceClient extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("slashInsurance");
  }
  async snapshot(): Promise<SlashInsuranceSnapshot> {
    const [
      bond,
      topUpRecipient,
      totalPremium,
      totalPaidOut,
      lastSlashedSnapshot,
      poolBalance,
    ] = await Promise.all([
      this.publicClient.readContract({
        address: this.address(),
        abi: slashInsuranceAbi,
        functionName: "bond",
      }) as Promise<Address>,
      this.publicClient.readContract({
        address: this.address(),
        abi: slashInsuranceAbi,
        functionName: "topUpRecipient",
      }) as Promise<Address>,
      this.publicClient.readContract({
        address: this.address(),
        abi: slashInsuranceAbi,
        functionName: "totalPremium",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: slashInsuranceAbi,
        functionName: "totalPaidOut",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: slashInsuranceAbi,
        functionName: "lastSlashedSnapshot",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.address(),
        abi: slashInsuranceAbi,
        functionName: "poolBalance",
      }) as Promise<bigint>,
    ]);
    return {
      bond,
      topUpRecipient,
      totalPremium,
      totalPaidOut,
      lastSlashedSnapshot,
      poolBalance,
    };
  }
  async contribOf(user: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: slashInsuranceAbi,
      functionName: "contribOf",
      args: [user],
    })) as bigint;
  }
  async payPremium(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashInsuranceAbi,
      functionName: "payPremium",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async withdrawPremium(amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashInsuranceAbi,
      functionName: "withdrawPremium",
      args: [amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async notifySlash(): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: slashInsuranceAbi,
      functionName: "notifySlash",
      args: [],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}

export interface FeeRouterSplit {
  creator: Address;
  recipients: Address[];
  bps: number[];
  totalRouted: bigint;
  createdAt: bigint;
}

export class FeeRouterV1Client extends BaseSubClient {
  private address(): Address {
    return this.requireAddress("feeRouterV1");
  }
  async splitCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "splitCount",
    })) as bigint;
  }
  async splitAt(splitId: bigint): Promise<FeeRouterSplit> {
    const s = (await this.publicClient.readContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "splitAt",
      args: [splitId],
    })) as {
      creator: Address;
      recipients: readonly Address[];
      bps: readonly number[];
      totalRouted: bigint;
      createdAt: bigint;
    };
    return {
      creator: s.creator,
      recipients: [...s.recipients],
      bps: [...s.bps],
      totalRouted: s.totalRouted,
      createdAt: s.createdAt,
    };
  }
  async claimableOf(splitId: bigint, recipient: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "claimableOf",
      args: [splitId, recipient],
    })) as bigint;
  }
  async totalClaimableOf(recipient: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "totalClaimableOf",
      args: [recipient],
    })) as bigint;
  }
  async createSplit(recipients: Address[], bps: number[]): Promise<Hex> {
    if (recipients.length !== bps.length)
      throw new Error("ForumClient: recipients/bps length mismatch");
    const sum = bps.reduce((a, b) => a + b, 0);
    if (sum !== 10_000)
      throw new Error(`ForumClient: bps must sum to 10000 (got ${sum})`);
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "createSplit",
      args: [recipients, bps],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async pay(splitId: bigint, amount: bigint): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "pay",
      args: [splitId, amount],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
  async claim(): Promise<Hex> {
    const w = this.requireWallet();
    return w.writeContract({
      address: this.address(),
      abi: feeRouterV1Abi,
      functionName: "claim",
      args: [],
      account: this.account(),
      chain: w.chain ?? null,
    });
  }
}
