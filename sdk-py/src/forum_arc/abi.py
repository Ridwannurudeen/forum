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
