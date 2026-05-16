"""Forum Arc SDK — public surface.

Full client implementations land on D3 once contracts are deployed.
D1 ships constants + types that adapter authors can import today.
"""

from typing import Literal, TypedDict

ARC_TESTNET = {
    "chain_id": 5042002,
    "rpc": "https://rpc.testnet.arc.network",
    "explorer": "https://testnet.arcscan.app",
}

BotKind = Literal["MAKER", "TAKER", "ARB", "OTHER"]

BOT_KIND_ENUM: dict[BotKind, int] = {
    "MAKER": 0,
    "TAKER": 1,
    "ARB": 2,
    "OTHER": 3,
}


class TrackRecord(TypedDict):
    ts: int
    pnl_micros: int
    fills: int
    meta_hash: bytes


class ForumAddresses(TypedDict):
    registry: str
    config: str
    track_record: str
    fee_distributor: str


__all__ = [
    "ARC_TESTNET",
    "BotKind",
    "BOT_KIND_ENUM",
    "TrackRecord",
    "ForumAddresses",
]

__version__ = "0.0.1"
