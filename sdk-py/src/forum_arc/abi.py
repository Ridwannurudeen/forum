"""ABIs for the four Forum operator-plane contracts on Arc.

Kept in sync with src/*.sol. Update both when contract surfaces change.
"""

from __future__ import annotations

BUILDER_CODE_REGISTRY_ABI = [
    {
        "type": "function",
        "name": "ownerOf",
        "stateMutability": "view",
        "inputs": [{"name": "code", "type": "bytes32"}],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "metadataUri",
        "stateMutability": "view",
        "inputs": [{"name": "code", "type": "bytes32"}],
        "outputs": [{"type": "string"}],
    },
    {
        "type": "function",
        "name": "claim",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "code", "type": "bytes32"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "transfer",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "code", "type": "bytes32"},
            {"name": "to", "type": "address"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "revoke",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "code", "type": "bytes32"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "setMetadata",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "code", "type": "bytes32"},
            {"name": "uri", "type": "string"},
        ],
        "outputs": [],
    },
    {
        "type": "event",
        "name": "Claimed",
        "anonymous": False,
        "inputs": [
            {"name": "code", "type": "bytes32", "indexed": True},
            {"name": "owner", "type": "address", "indexed": True},
        ],
    },
    {
        "type": "event",
        "name": "Transferred",
        "anonymous": False,
        "inputs": [
            {"name": "code", "type": "bytes32", "indexed": True},
            {"name": "from", "type": "address", "indexed": True},
            {"name": "to", "type": "address", "indexed": True},
        ],
    },
    {
        "type": "event",
        "name": "Revoked",
        "anonymous": False,
        "inputs": [
            {"name": "code", "type": "bytes32", "indexed": True},
            {"name": "by", "type": "address", "indexed": True},
        ],
    },
    {
        "type": "event",
        "name": "MetadataSet",
        "anonymous": False,
        "inputs": [
            {"name": "code", "type": "bytes32", "indexed": True},
            {"name": "uri", "type": "string", "indexed": False},
        ],
    },
]

KEEPER_CONFIG_ABI = [
    {
        "type": "function",
        "name": "setConfig",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {"name": "data", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "getConfig",
        "stateMutability": "view",
        "inputs": [
            {"name": "operator", "type": "address"},
            {"name": "botId", "type": "bytes32"},
        ],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "version", "type": "uint64"},
                    {"name": "updatedAt", "type": "uint64"},
                    {"name": "data", "type": "bytes"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "historyLength",
        "stateMutability": "view",
        "inputs": [
            {"name": "operator", "type": "address"},
            {"name": "botId", "type": "bytes32"},
        ],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "snapshotAt",
        "stateMutability": "view",
        "inputs": [
            {"name": "operator", "type": "address"},
            {"name": "botId", "type": "bytes32"},
            {"name": "idx", "type": "uint256"},
        ],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "version", "type": "uint64"},
                    {"name": "updatedAt", "type": "uint64"},
                    {"name": "data", "type": "bytes"},
                ],
            }
        ],
    },
    {
        "type": "event",
        "name": "ConfigUpdated",
        "anonymous": False,
        "inputs": [
            {"name": "operator", "type": "address", "indexed": True},
            {"name": "botId", "type": "bytes32", "indexed": True},
            {"name": "version", "type": "uint64", "indexed": False},
        ],
    },
]

TRACK_RECORD_ABI = [
    {
        "type": "function",
        "name": "DOMAIN_SEPARATOR",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "botKind",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "uint8"}],
    },
    {
        "type": "function",
        "name": "botSigner",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "registerBot",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {"name": "kind", "type": "uint8"},
            {"name": "signer", "type": "address"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "publish",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {
                "name": "r",
                "type": "tuple",
                "components": [
                    {"name": "ts", "type": "uint64"},
                    {"name": "pnlMicros", "type": "int128"},
                    {"name": "fills", "type": "uint64"},
                    {"name": "metaHash", "type": "bytes32"},
                ],
            },
            {"name": "signature", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "recordCount",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "recordAt",
        "stateMutability": "view",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {"name": "idx", "type": "uint256"},
        ],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "ts", "type": "uint64"},
                    {"name": "pnlMicros", "type": "int128"},
                    {"name": "fills", "type": "uint64"},
                    {"name": "metaHash", "type": "bytes32"},
                ],
            }
        ],
    },
    {
        "type": "event",
        "name": "BotRegistered",
        "anonymous": False,
        "inputs": [
            {"name": "botId", "type": "bytes32", "indexed": True},
            {"name": "kind", "type": "uint8", "indexed": False},
            {"name": "signer", "type": "address", "indexed": True},
        ],
    },
    {
        "type": "event",
        "name": "Published",
        "anonymous": False,
        "inputs": [
            {"name": "botId", "type": "bytes32", "indexed": True},
            {"name": "ts", "type": "uint64", "indexed": False},
            {"name": "pnlMicros", "type": "int128", "indexed": False},
            {"name": "fills", "type": "uint64", "indexed": False},
        ],
    },
]

FEE_DISTRIBUTOR_ABI = [
    {
        "type": "function",
        "name": "registry",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "usdc",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "setAttribution",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "code", "type": "bytes32"},
            {"name": "r", "type": "address[]"},
            {"name": "bps", "type": "uint16[]"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "distribute",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "code", "type": "bytes32"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "claim",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "claimable",
        "stateMutability": "view",
        "inputs": [{"name": "who", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "attributionOf",
        "stateMutability": "view",
        "inputs": [{"name": "code", "type": "bytes32"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "recipients", "type": "address[]"},
                    {"name": "bps", "type": "uint16[]"},
                ],
            }
        ],
    },
    {
        "type": "event",
        "name": "AttributionSet",
        "anonymous": False,
        "inputs": [
            {"name": "code", "type": "bytes32", "indexed": True},
            {"name": "recipients", "type": "address[]", "indexed": False},
            {"name": "bps", "type": "uint16[]", "indexed": False},
        ],
    },
    {
        "type": "event",
        "name": "Distributed",
        "anonymous": False,
        "inputs": [
            {"name": "code", "type": "bytes32", "indexed": True},
            {"name": "total", "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event",
        "name": "Claimed",
        "anonymous": False,
        "inputs": [
            {"name": "who", "type": "address", "indexed": True},
            {"name": "amount", "type": "uint256", "indexed": False},
        ],
    },
]

TRACK_RECORD_V2_ABI = [
    {
        "type": "function",
        "name": "botSigner",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "lastSeq",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "uint64"}],
    },
    {
        "type": "function",
        "name": "lastRecordHash",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "registerBot",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {"name": "kind", "type": "uint8"},
            {"name": "signer", "type": "address"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "publish",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {
                "name": "r",
                "type": "tuple",
                "components": [
                    {"name": "seq", "type": "uint64"},
                    {"name": "periodStart", "type": "uint64"},
                    {"name": "periodEnd", "type": "uint64"},
                    {"name": "pnlMicros", "type": "int128"},
                    {"name": "fills", "type": "uint64"},
                    {"name": "metaHash", "type": "bytes32"},
                    {"name": "evidenceUri", "type": "string"},
                    {"name": "evidenceHash", "type": "bytes32"},
                    {"name": "prevRecordHash", "type": "bytes32"},
                ],
            },
            {"name": "signature", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "recordCount",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "recordAt",
        "stateMutability": "view",
        "inputs": [
            {"name": "botId", "type": "bytes32"},
            {"name": "idx", "type": "uint256"},
        ],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "seq", "type": "uint64"},
                    {"name": "periodStart", "type": "uint64"},
                    {"name": "periodEnd", "type": "uint64"},
                    {"name": "pnlMicros", "type": "int128"},
                    {"name": "fills", "type": "uint64"},
                    {"name": "metaHash", "type": "bytes32"},
                    {"name": "evidenceUriHash", "type": "bytes32"},
                    {"name": "evidenceHash", "type": "bytes32"},
                    {"name": "recordHash", "type": "bytes32"},
                ],
            }
        ],
    },
]

COVENANT_VAULT_ABI = [
    {
        "type": "function",
        "name": "mandate",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "operator", "type": "address"},
            {"name": "botId", "type": "bytes32"},
            {"name": "budgetUsdc", "type": "uint128"},
            {"name": "maxDrawdownBps", "type": "uint16"},
            {"name": "receiptFreshnessSec", "type": "uint32"},
            {"name": "expiry", "type": "uint64"},
            {"name": "perfFeeBps", "type": "uint16"},
            {"name": "bondContract", "type": "address"},
            {"name": "riskKernel", "type": "address"},
            {"name": "trackRecordV2", "type": "address"},
        ],
    },
    {
        "type": "function",
        "name": "state",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint8"}],
    },
    {
        "type": "function",
        "name": "assets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "availableCredit",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "depositTotalIdle",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "operatorOutstanding",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalShares",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "highWaterMark",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "operatorClaimable",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "sharesOf",
        "stateMutability": "view",
        "inputs": [{"name": "user", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "deposit",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [{"name": "sharesMinted", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "withdraw",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "usdcOut", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "pullCredit",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "returnCapital",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
]

RISK_KERNEL_V2_ABI = [
    {
        "type": "function",
        "name": "evaluate",
        "stateMutability": "view",
        "inputs": [{"name": "vaultAddr", "type": "address"}],
        "outputs": [{"type": "uint8"}],
    },
    {
        "type": "function",
        "name": "enforce",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "vaultAddr", "type": "address"}],
        "outputs": [],
    },
]

SLASH_BOND_ABI = [
    {
        "type": "function",
        "name": "bondBalance",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalSlashed",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "bond",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "requestUnbond",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
]

AGENT_POOL_ABI = [
    {
        "type": "function",
        "name": "assets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "sharesOf",
        "stateMutability": "view",
        "inputs": [{"name": "user", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "deposit",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [{"name": "sharesMinted", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "withdraw",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "usdcOut", "type": "uint256"}],
    },
]

COVENANT_VAULT_FACTORY_ABI = [
    {
        "type": "function",
        "name": "createVault",
        "stateMutability": "nonpayable",
        "inputs": [
            {
                "name": "m",
                "type": "tuple",
                "components": [
                    {"name": "operator", "type": "address"},
                    {"name": "botId", "type": "bytes32"},
                    {"name": "budgetUsdc", "type": "uint128"},
                    {"name": "maxDrawdownBps", "type": "uint16"},
                    {"name": "receiptFreshnessSec", "type": "uint32"},
                    {"name": "expiry", "type": "uint64"},
                    {"name": "perfFeeBps", "type": "uint16"},
                    {"name": "bondContract", "type": "address"},
                    {"name": "riskKernel", "type": "address"},
                    {"name": "trackRecordV2", "type": "address"},
                ],
            },
        ],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "vaultCount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "allVaults",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address[]"}],
    },
    {
        "type": "function",
        "name": "vaultsByCreator",
        "stateMutability": "view",
        "inputs": [{"name": "creator", "type": "address"}],
        "outputs": [{"type": "address[]"}],
    },
    {
        "type": "function",
        "name": "vaultsByOperator",
        "stateMutability": "view",
        "inputs": [{"name": "operator", "type": "address"}],
        "outputs": [{"type": "address[]"}],
    },
    {
        "type": "function",
        "name": "vaultsByBotId",
        "stateMutability": "view",
        "inputs": [{"name": "botId", "type": "bytes32"}],
        "outputs": [{"type": "address[]"}],
    },
    {
        "type": "event",
        "name": "VaultCreated",
        "inputs": [
            {"name": "vault", "type": "address", "indexed": True},
            {"name": "creator", "type": "address", "indexed": True},
            {"name": "operator", "type": "address", "indexed": True},
            {"name": "botId", "type": "bytes32", "indexed": False},
            {"name": "budgetUsdc", "type": "uint128", "indexed": False},
            {"name": "createdAt", "type": "uint64", "indexed": False},
        ],
    },
]

COVENANT_INBOX_ABI = [
    {
        "type": "function",
        "name": "depositInto",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "vaultAddr", "type": "address"},
            {"name": "recipient", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"name": "sharesMinted", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "claim",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "vaultAddr", "type": "address"},
            {"name": "shares", "type": "uint256"},
        ],
        "outputs": [{"name": "usdcOut", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "sharesOf",
        "stateMutability": "view",
        "inputs": [
            {"name": "vaultAddr", "type": "address"},
            {"name": "recipient", "type": "address"},
        ],
        "outputs": [{"type": "uint256"}],
    },
]


CAPITAL_ROUTER_ABI = [
    {
        "type": "function",
        "name": "strategist",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "usdc",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "idleUsdc",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalShares",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "sharesOf",
        "stateMutability": "view",
        "inputs": [{"name": "u", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "assets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "targets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address[]"}],
    },
    {
        "type": "function",
        "name": "weights",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint16[]"}],
    },
    {
        "type": "function",
        "name": "setStrategy",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "vaults", "type": "address[]"},
            {"name": "weightsBps", "type": "uint16[]"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "deposit",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [{"name": "minted", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "withdraw",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "out", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "rebalance",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
]


SLASH_MARKET_ABI = [
    {
        "type": "function",
        "name": "usdc",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "marketCount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "createMarket",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "bond", "type": "address"},
            {"name": "expiryAt", "type": "uint64"},
        ],
        "outputs": [{"name": "id", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "stake",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "id", "type": "uint256"},
            {"name": "yesSide", "type": "bool"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "settle",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "id", "type": "uint256"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "claim",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "id", "type": "uint256"}],
        "outputs": [{"name": "paid", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "marketAt",
        "stateMutability": "view",
        "inputs": [{"name": "id", "type": "uint256"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "bond", "type": "address"},
                    {"name": "createdAt", "type": "uint64"},
                    {"name": "expiryAt", "type": "uint64"},
                    {"name": "slashedSnapshot", "type": "uint256"},
                    {"name": "yesStake", "type": "uint256"},
                    {"name": "noStake", "type": "uint256"},
                    {"name": "settled", "type": "bool"},
                    {"name": "didSlash", "type": "bool"},
                    {"name": "newSlashedAtSettle", "type": "uint256"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "stakeOf",
        "stateMutability": "view",
        "inputs": [
            {"name": "id", "type": "uint256"},
            {"name": "user", "type": "address"},
            {"name": "yesSide", "type": "bool"},
        ],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "claimed",
        "stateMutability": "view",
        "inputs": [
            {"name": "id", "type": "uint256"},
            {"name": "user", "type": "address"},
        ],
        "outputs": [{"type": "bool"}],
    },
]


SLASH_INSURANCE_ABI = [
    {
        "type": "function",
        "name": "usdc",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "bond",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "topUpRecipient",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "type": "function",
        "name": "totalPremium",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalPaidOut",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "lastSlashedSnapshot",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "contribOf",
        "stateMutability": "view",
        "inputs": [{"name": "u", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "poolBalance",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "payPremium",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "withdrawPremium",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "notifySlash",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [{"name": "paidOut", "type": "uint256"}],
    },
]
