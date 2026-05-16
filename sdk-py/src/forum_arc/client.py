"""ForumClient — Python wrapper over the four Forum operator-plane contracts.

Symmetric to the TypeScript SDK. Built on web3.py + eth-account.

Usage:
    from web3 import Web3
    from eth_account import Account
    from forum_arc import ForumClient, ForumAddresses, ARC_TESTNET

    w3 = Web3(Web3.HTTPProvider(ARC_TESTNET["rpc"]))
    acct = Account.from_key(open("/home/user/.forum-keys/deployer.key").read().strip())

    forum = ForumClient(
        w3=w3,
        addresses=ForumAddresses(
            registry="0x...",
            config="0x...",
            track_record="0x...",
            fee_distributor="0x...",
        ),
        account=acct,
    )
    forum.registry.claim(bytes.fromhex("ab" * 32))
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3
from web3.contract import Contract

from .abi import (
    BUILDER_CODE_REGISTRY_ABI,
    FEE_DISTRIBUTOR_ABI,
    KEEPER_CONFIG_ABI,
    TRACK_RECORD_ABI,
)


@dataclass(frozen=True)
class ForumAddresses:
    registry: str
    config: str
    track_record: str
    fee_distributor: str


# Bot kinds match Solidity enum order in TrackRecord.sol
BOT_KIND_ENUM = {"MAKER": 0, "TAKER": 1, "ARB": 2, "OTHER": 3}


class _SubClient:
    def __init__(self, w3: Web3, contract: Contract, account: Account | None) -> None:
        self._w3 = w3
        self._c = contract
        self._account = account

    def _require_account(self) -> Account:
        if self._account is None:
            raise RuntimeError("ForumClient: account required for write call")
        return self._account

    def _send(self, fn_name: str, *args: Any) -> str:
        acct = self._require_account()
        fn = getattr(self._c.functions, fn_name)(*args)
        tx = fn.build_transaction(
            {
                "from": acct.address,
                "nonce": self._w3.eth.get_transaction_count(acct.address),
                "chainId": self._w3.eth.chain_id,
            }
        )
        signed = acct.sign_transaction(tx)
        return "0x" + self._w3.eth.send_raw_transaction(signed.raw_transaction).hex()


class RegistryClient(_SubClient):
    def owner_of(self, code: bytes) -> str:
        return self._c.functions.ownerOf(code).call()

    def metadata_uri(self, code: bytes) -> str:
        return self._c.functions.metadataUri(code).call()

    def claim(self, code: bytes) -> str:
        return self._send("claim", code)

    def transfer(self, code: bytes, to: str) -> str:
        return self._send("transfer", code, Web3.to_checksum_address(to))

    def revoke(self, code: bytes) -> str:
        return self._send("revoke", code)

    def set_metadata(self, code: bytes, uri: str) -> str:
        return self._send("setMetadata", code, uri)


@dataclass(frozen=True)
class ConfigSnapshot:
    version: int
    updated_at: int
    data: bytes


class ConfigClient(_SubClient):
    def set_config(self, bot_id: bytes, data: bytes) -> str:
        return self._send("setConfig", bot_id, data)

    def get_config(self, operator: str, bot_id: bytes) -> ConfigSnapshot:
        v, ts, d = self._c.functions.getConfig(
            Web3.to_checksum_address(operator), bot_id
        ).call()
        return ConfigSnapshot(version=v, updated_at=ts, data=bytes(d))

    def history_length(self, operator: str, bot_id: bytes) -> int:
        return self._c.functions.historyLength(
            Web3.to_checksum_address(operator), bot_id
        ).call()

    def snapshot_at(self, operator: str, bot_id: bytes, idx: int) -> ConfigSnapshot:
        v, ts, d = self._c.functions.snapshotAt(
            Web3.to_checksum_address(operator), bot_id, idx
        ).call()
        return ConfigSnapshot(version=v, updated_at=ts, data=bytes(d))


@dataclass(frozen=True)
class TrackRecordEntry:
    ts: int
    pnl_micros: int
    fills: int
    meta_hash: bytes


class TrackRecordClient(_SubClient):
    def domain_separator(self) -> bytes:
        return bytes(self._c.functions.DOMAIN_SEPARATOR().call())

    def kind(self, bot_id: bytes) -> str:
        k = self._c.functions.botKind(bot_id).call()
        for name, v in BOT_KIND_ENUM.items():
            if v == k:
                return name
        raise ValueError(f"Unknown bot kind enum: {k}")

    def signer(self, bot_id: bytes) -> str:
        return self._c.functions.botSigner(bot_id).call()

    def register_bot(self, bot_id: bytes, kind: str, signer: str) -> str:
        return self._send(
            "registerBot", bot_id, BOT_KIND_ENUM[kind], Web3.to_checksum_address(signer)
        )

    def record_count(self, bot_id: bytes) -> int:
        return self._c.functions.recordCount(bot_id).call()

    def record_at(self, bot_id: bytes, idx: int) -> TrackRecordEntry:
        ts, pnl, fills, meta = self._c.functions.recordAt(bot_id, idx).call()
        return TrackRecordEntry(
            ts=ts, pnl_micros=pnl, fills=fills, meta_hash=bytes(meta)
        )

    def sign_record(
        self,
        bot_id: bytes,
        kind: str,
        record: TrackRecordEntry,
        signer_key: bytes,
        chain_id: int,
        verifying_contract: str,
    ) -> bytes:
        """Produce an EIP-712 signature for a TrackRecord entry.

        The signer_key must correspond to the address registered via register_bot.
        """
        typed_data = {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "Record": [
                    {"name": "botId", "type": "bytes32"},
                    {"name": "kind", "type": "uint8"},
                    {"name": "ts", "type": "uint64"},
                    {"name": "pnlMicros", "type": "int128"},
                    {"name": "fills", "type": "uint64"},
                    {"name": "metaHash", "type": "bytes32"},
                ],
            },
            "primaryType": "Record",
            "domain": {
                "name": "ForumTrackRecord",
                "version": "1",
                "chainId": chain_id,
                "verifyingContract": Web3.to_checksum_address(verifying_contract),
            },
            "message": {
                "botId": bot_id,
                "kind": BOT_KIND_ENUM[kind],
                "ts": record.ts,
                "pnlMicros": record.pnl_micros,
                "fills": record.fills,
                "metaHash": record.meta_hash,
            },
        }
        encoded = encode_typed_data(full_message=typed_data)
        signed = Account.from_key(signer_key).sign_message(encoded)
        return bytes(signed.signature)

    def publish(self, bot_id: bytes, record: TrackRecordEntry, signature: bytes) -> str:
        return self._send(
            "publish",
            bot_id,
            (record.ts, record.pnl_micros, record.fills, record.meta_hash),
            signature,
        )


@dataclass(frozen=True)
class Attribution:
    recipients: list[str]
    bps: list[int]


class FeeDistributorClient(_SubClient):
    def claimable(self, who: str) -> int:
        return self._c.functions.claimable(Web3.to_checksum_address(who)).call()

    def attribution_of(self, code: bytes) -> Attribution:
        recipients, bps = self._c.functions.attributionOf(code).call()
        return Attribution(recipients=list(recipients), bps=list(bps))

    def set_attribution(
        self, code: bytes, recipients: list[str], bps: list[int]
    ) -> str:
        if len(recipients) != len(bps):
            raise ValueError("recipients/bps length mismatch")
        if sum(bps) != 10_000:
            raise ValueError(f"bps must sum to 10000 (got {sum(bps)})")
        return self._send(
            "setAttribution",
            code,
            [Web3.to_checksum_address(r) for r in recipients],
            bps,
        )

    def distribute(self, code: bytes, amount: int) -> str:
        return self._send("distribute", code, amount)

    def claim(self) -> str:
        return self._send("claim")


class ForumClient:
    def __init__(
        self,
        w3: Web3,
        addresses: ForumAddresses,
        account: Account | None = None,
    ) -> None:
        self._w3 = w3
        self._addresses = addresses
        registry_c = w3.eth.contract(
            address=Web3.to_checksum_address(addresses.registry),
            abi=BUILDER_CODE_REGISTRY_ABI,
        )
        config_c = w3.eth.contract(
            address=Web3.to_checksum_address(addresses.config), abi=KEEPER_CONFIG_ABI
        )
        track_c = w3.eth.contract(
            address=Web3.to_checksum_address(addresses.track_record),
            abi=TRACK_RECORD_ABI,
        )
        fee_c = w3.eth.contract(
            address=Web3.to_checksum_address(addresses.fee_distributor),
            abi=FEE_DISTRIBUTOR_ABI,
        )
        self.registry = RegistryClient(w3, registry_c, account)
        self.config = ConfigClient(w3, config_c, account)
        self.track_record = TrackRecordClient(w3, track_c, account)
        self.fee_distributor = FeeDistributorClient(w3, fee_c, account)
