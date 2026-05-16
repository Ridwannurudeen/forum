"""Forum Arc SDK — Python.

Wraps the Forum operator-plane contracts on Arc testnet/mainnet.
"""

from .abi import (
    BUILDER_CODE_REGISTRY_ABI,
    FEE_DISTRIBUTOR_ABI,
    KEEPER_CONFIG_ABI,
    TRACK_RECORD_ABI,
)
from .client import (
    BOT_KIND_ENUM,
    Attribution,
    ConfigClient,
    ConfigSnapshot,
    FeeDistributorClient,
    ForumAddresses,
    ForumClient,
    RegistryClient,
    TrackRecordClient,
    TrackRecordEntry,
)

ARC_TESTNET = {
    "chain_id": 5042002,
    "rpc": "https://rpc.testnet.arc.network",
    "explorer": "https://testnet.arcscan.app",
}

__all__ = [
    "ARC_TESTNET",
    "BOT_KIND_ENUM",
    "BUILDER_CODE_REGISTRY_ABI",
    "FEE_DISTRIBUTOR_ABI",
    "KEEPER_CONFIG_ABI",
    "TRACK_RECORD_ABI",
    "Attribution",
    "ConfigClient",
    "ConfigSnapshot",
    "FeeDistributorClient",
    "ForumAddresses",
    "ForumClient",
    "RegistryClient",
    "TrackRecordClient",
    "TrackRecordEntry",
]
__version__ = "0.0.1"
