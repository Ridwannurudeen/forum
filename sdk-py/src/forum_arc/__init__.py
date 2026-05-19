"""Forum Arc SDK — Python.

Wraps the Forum operator-plane contracts on Arc testnet/mainnet.
"""

from .abi import (
    AGENT_POOL_ABI,
    BUILDER_CODE_REGISTRY_ABI,
    COVENANT_VAULT_ABI,
    FEE_DISTRIBUTOR_ABI,
    KEEPER_CONFIG_ABI,
    RISK_KERNEL_V2_ABI,
    SLASH_BOND_ABI,
    TRACK_RECORD_ABI,
    TRACK_RECORD_V2_ABI,
)
from .client import (
    AgentPoolClient,
    BOT_KIND_ENUM,
    Attribution,
    CovenantMandate,
    CovenantVaultClient,
    CovenantVaultSnapshot,
    ConfigClient,
    ConfigSnapshot,
    FeeDistributorClient,
    ForumAddresses,
    ForumClient,
    RegistryClient,
    RiskKernelClient,
    SlashBondClient,
    TrackRecordClient,
    TrackRecordEntry,
    TrackRecordV2Client,
    TrackRecordV2Entry,
    TrackRecordV2Publish,
)
from .indexer import HealthResponse, IndexerClient

ARC_TESTNET = {
    "chain_id": 5042002,
    "rpc": "https://rpc.testnet.arc.network",
    "explorer": "https://testnet.arcscan.app",
}

__all__ = [
    "ARC_TESTNET",
    "AGENT_POOL_ABI",
    "BOT_KIND_ENUM",
    "BUILDER_CODE_REGISTRY_ABI",
    "COVENANT_VAULT_ABI",
    "FEE_DISTRIBUTOR_ABI",
    "KEEPER_CONFIG_ABI",
    "RISK_KERNEL_V2_ABI",
    "SLASH_BOND_ABI",
    "TRACK_RECORD_ABI",
    "TRACK_RECORD_V2_ABI",
    "AgentPoolClient",
    "Attribution",
    "CovenantMandate",
    "CovenantVaultClient",
    "CovenantVaultSnapshot",
    "ConfigClient",
    "ConfigSnapshot",
    "FeeDistributorClient",
    "ForumAddresses",
    "ForumClient",
    "RegistryClient",
    "RiskKernelClient",
    "SlashBondClient",
    "TrackRecordClient",
    "TrackRecordEntry",
    "TrackRecordV2Client",
    "TrackRecordV2Entry",
    "TrackRecordV2Publish",
    "IndexerClient",
    "HealthResponse",
]
__version__ = "0.0.1"
