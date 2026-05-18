// Minimal ABIs for the four Forum operator-plane contracts on Arc.
// Generated from src/*.sol. Keep in sync if contract surfaces change.

export const builderCodeRegistryAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "code", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "metadataUri",
    stateMutability: "view",
    inputs: [{ name: "code", type: "bytes32" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "code", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "code", type: "bytes32" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "code", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setMetadata",
    stateMutability: "nonpayable",
    inputs: [
      { name: "code", type: "bytes32" },
      { name: "uri", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "code", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Transferred",
    inputs: [
      { name: "code", type: "bytes32", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Revoked",
    inputs: [
      { name: "code", type: "bytes32", indexed: true },
      { name: "by", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "MetadataSet",
    inputs: [
      { name: "code", type: "bytes32", indexed: true },
      { name: "uri", type: "string", indexed: false },
    ],
  },
] as const;

export const keeperConfigAbi = [
  {
    type: "function",
    name: "setConfig",
    stateMutability: "nonpayable",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getConfig",
    stateMutability: "view",
    inputs: [
      { name: "operator", type: "address" },
      { name: "botId", type: "bytes32" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "historyLength",
    stateMutability: "view",
    inputs: [
      { name: "operator", type: "address" },
      { name: "botId", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "snapshotAt",
    stateMutability: "view",
    inputs: [
      { name: "operator", type: "address" },
      { name: "botId", type: "bytes32" },
      { name: "idx", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "ConfigUpdated",
    inputs: [
      { name: "operator", type: "address", indexed: true },
      { name: "botId", type: "bytes32", indexed: true },
      { name: "version", type: "uint64", indexed: false },
    ],
  },
] as const;

export const trackRecordAbi = [
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "botKind",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "botSigner",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
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
  {
    type: "function",
    name: "recordCount",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recordAt",
    stateMutability: "view",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "idx", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "ts", type: "uint64" },
          { name: "pnlMicros", type: "int128" },
          { name: "fills", type: "uint64" },
          { name: "metaHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "BotRegistered",
    inputs: [
      { name: "botId", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: false },
      { name: "signer", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Published",
    inputs: [
      { name: "botId", type: "bytes32", indexed: true },
      { name: "ts", type: "uint64", indexed: false },
      { name: "pnlMicros", type: "int128", indexed: false },
      { name: "fills", type: "uint64", indexed: false },
    ],
  },
] as const;

export const feeDistributorAbi = [
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "setAttribution",
    stateMutability: "nonpayable",
    inputs: [
      { name: "code", type: "bytes32" },
      { name: "r", type: "address[]" },
      { name: "bps", type: "uint16[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "distribute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "code", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "attributionOf",
    stateMutability: "view",
    inputs: [{ name: "code", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "recipients", type: "address[]" },
          { name: "bps", type: "uint16[]" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "AttributionSet",
    inputs: [
      { name: "code", type: "bytes32", indexed: true },
      { name: "recipients", type: "address[]", indexed: false },
      { name: "bps", type: "uint16[]", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Distributed",
    inputs: [
      { name: "code", type: "bytes32", indexed: true },
      { name: "total", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "who", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const trackRecordV2Abi = [
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "botKind",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "botSigner",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "lastSeq",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "lastRecordHash",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
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
  {
    type: "function",
    name: "recordCount",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recordAt",
    stateMutability: "view",
    inputs: [
      { name: "botId", type: "bytes32" },
      { name: "idx", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "seq", type: "uint64" },
          { name: "periodStart", type: "uint64" },
          { name: "periodEnd", type: "uint64" },
          { name: "pnlMicros", type: "int128" },
          { name: "fills", type: "uint64" },
          { name: "metaHash", type: "bytes32" },
          { name: "evidenceUriHash", type: "bytes32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "recordHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

export const covenantVaultAbi = [
  {
    type: "function",
    name: "mandate",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "operator", type: "address" },
      { name: "botId", type: "bytes32" },
      { name: "budgetUsdc", type: "uint128" },
      { name: "maxDrawdownBps", type: "uint16" },
      { name: "receiptFreshnessSec", type: "uint32" },
      { name: "expiry", type: "uint64" },
      { name: "perfFeeBps", type: "uint16" },
      { name: "bondContract", type: "address" },
      { name: "riskKernel", type: "address" },
      { name: "trackRecordV2", type: "address" },
    ],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "perSharePrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "availableCredit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "depositTotalIdle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorOutstanding",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "highWaterMark",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorClaimable",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "pullCredit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "returnCapital",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "crystalliseFee",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "operatorClaim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

export const riskKernelV2Abi = [
  {
    type: "function",
    name: "SLASH_BPS_PER_VIOLATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "evaluate",
    stateMutability: "view",
    inputs: [{ name: "vaultAddr", type: "address" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "enforce",
    stateMutability: "nonpayable",
    inputs: [{ name: "vaultAddr", type: "address" }],
    outputs: [],
  },
] as const;

export const slashBondAbi = [
  {
    type: "function",
    name: "bondBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSlashed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondRequestedAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "bond",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "requestUnbond",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelUnbond",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claimUnbond",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

export const agentPoolAbi = [
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "perSharePrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "depositTotalIdle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorOutstanding",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorClaimable",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "operatorReturn",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "crystalliseFee",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "operatorClaim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
