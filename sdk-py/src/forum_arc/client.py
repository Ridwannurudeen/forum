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
    AGENT_POOL_ABI,
    BUILDER_CODE_REGISTRY_ABI,
    COVENANT_INBOX_ABI,
    COVENANT_VAULT_ABI,
    COVENANT_VAULT_FACTORY_ABI,
    FEE_DISTRIBUTOR_ABI,
    KEEPER_CONFIG_ABI,
    RISK_KERNEL_V2_ABI,
    SLASH_BOND_ABI,
    TRACK_RECORD_ABI,
    TRACK_RECORD_V2_ABI,
)


@dataclass(frozen=True)
class ForumAddresses:
    registry: str
    config: str
    track_record: str
    fee_distributor: str
    track_record_v2: str | None = None
    agent_pool: str | None = None
    slash_bond: str | None = None
    risk_kernel: str | None = None
    covenant_vault: str | None = None
    covenant_vault_factory: str | None = None
    covenant_inbox: str | None = None


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
class TrackRecordV2Entry:
    seq: int
    period_start: int
    period_end: int
    pnl_micros: int
    fills: int
    meta_hash: bytes
    evidence_uri_hash: bytes
    evidence_hash: bytes
    record_hash: bytes


@dataclass(frozen=True)
class TrackRecordV2Publish:
    seq: int
    period_start: int
    period_end: int
    pnl_micros: int
    fills: int
    meta_hash: bytes
    evidence_uri: str
    evidence_hash: bytes
    prev_record_hash: bytes


class TrackRecordV2Client(_SubClient):
    def signer(self, bot_id: bytes) -> str:
        return self._c.functions.botSigner(bot_id).call()

    def last_seq(self, bot_id: bytes) -> int:
        return self._c.functions.lastSeq(bot_id).call()

    def last_record_hash(self, bot_id: bytes) -> bytes:
        return bytes(self._c.functions.lastRecordHash(bot_id).call())

    def register_bot(self, bot_id: bytes, kind: str, signer: str) -> str:
        return self._send(
            "registerBot", bot_id, BOT_KIND_ENUM[kind], Web3.to_checksum_address(signer)
        )

    def record_count(self, bot_id: bytes) -> int:
        return self._c.functions.recordCount(bot_id).call()

    def record_at(self, bot_id: bytes, idx: int) -> TrackRecordV2Entry:
        (
            seq,
            period_start,
            period_end,
            pnl,
            fills,
            meta_hash,
            evidence_uri_hash,
            evidence_hash,
            record_hash,
        ) = self._c.functions.recordAt(bot_id, idx).call()
        return TrackRecordV2Entry(
            seq=seq,
            period_start=period_start,
            period_end=period_end,
            pnl_micros=pnl,
            fills=fills,
            meta_hash=bytes(meta_hash),
            evidence_uri_hash=bytes(evidence_uri_hash),
            evidence_hash=bytes(evidence_hash),
            record_hash=bytes(record_hash),
        )

    def publish(
        self, bot_id: bytes, record: TrackRecordV2Publish, signature: bytes
    ) -> str:
        return self._send(
            "publish",
            bot_id,
            (
                record.seq,
                record.period_start,
                record.period_end,
                record.pnl_micros,
                record.fills,
                record.meta_hash,
                record.evidence_uri,
                record.evidence_hash,
                record.prev_record_hash,
            ),
            signature,
        )


@dataclass(frozen=True)
class CovenantMandate:
    operator: str
    bot_id: bytes
    budget_usdc: int
    max_drawdown_bps: int
    receipt_freshness_sec: int
    expiry: int
    perf_fee_bps: int
    bond_contract: str
    risk_kernel: str
    track_record_v2: str


@dataclass(frozen=True)
class CovenantVaultSnapshot:
    state: str
    mandate: CovenantMandate
    assets: int
    idle: int
    operator_outstanding: int
    available_credit: int
    total_shares: int
    high_water_mark: int
    operator_claimable: int


STATE_NAMES = ["ACTIVE", "PAUSED"]
VERDICT_NAMES = [
    "ALLOW",
    "PAUSE_DRAWDOWN",
    "PAUSE_OVERSUBSCRIBED",
    "PAUSE_STALE",
    "PAUSE_EXPIRED",
]


def _state_name(value: int) -> str:
    try:
        return STATE_NAMES[value]
    except IndexError as exc:
        raise ValueError(f"unknown CovenantVault state: {value}") from exc


def _verdict_name(value: int) -> str:
    try:
        return VERDICT_NAMES[value]
    except IndexError as exc:
        raise ValueError(f"unknown RiskKernel verdict: {value}") from exc


def _mandate(values: tuple[Any, ...]) -> CovenantMandate:
    return CovenantMandate(
        operator=values[0],
        bot_id=bytes(values[1]),
        budget_usdc=values[2],
        max_drawdown_bps=values[3],
        receipt_freshness_sec=values[4],
        expiry=values[5],
        perf_fee_bps=values[6],
        bond_contract=values[7],
        risk_kernel=values[8],
        track_record_v2=values[9],
    )


class CovenantVaultClient(_SubClient):
    def mandate(self) -> CovenantMandate:
        return _mandate(self._c.functions.mandate().call())

    def state(self) -> str:
        return _state_name(self._c.functions.state().call())

    def snapshot(self) -> CovenantVaultSnapshot:
        return CovenantVaultSnapshot(
            state=self.state(),
            mandate=self.mandate(),
            assets=self._c.functions.assets().call(),
            idle=self._c.functions.depositTotalIdle().call(),
            operator_outstanding=self._c.functions.operatorOutstanding().call(),
            available_credit=self._c.functions.availableCredit().call(),
            total_shares=self._c.functions.totalShares().call(),
            high_water_mark=self._c.functions.highWaterMark().call(),
            operator_claimable=self._c.functions.operatorClaimable().call(),
        )

    def shares_of(self, user: str) -> int:
        return self._c.functions.sharesOf(Web3.to_checksum_address(user)).call()

    def deposit(self, amount: int) -> str:
        return self._send("deposit", amount)

    def withdraw(self, shares: int) -> str:
        return self._send("withdraw", shares)

    def pull_credit(self, amount: int) -> str:
        return self._send("pullCredit", amount)

    def return_capital(self, amount: int) -> str:
        return self._send("returnCapital", amount)


class RiskKernelClient(_SubClient):
    def evaluate(self, vault: str) -> str:
        return _verdict_name(
            self._c.functions.evaluate(Web3.to_checksum_address(vault)).call()
        )

    def enforce(self, vault: str) -> str:
        return self._send("enforce", Web3.to_checksum_address(vault))


class SlashBondClient(_SubClient):
    def bond_balance(self) -> int:
        return self._c.functions.bondBalance().call()

    def total_slashed(self) -> int:
        return self._c.functions.totalSlashed().call()

    def bond(self, amount: int) -> str:
        return self._send("bond", amount)

    def request_unbond(self, amount: int) -> str:
        return self._send("requestUnbond", amount)


class AgentPoolClient(_SubClient):
    def assets(self) -> int:
        return self._c.functions.assets().call()

    def shares_of(self, user: str) -> int:
        return self._c.functions.sharesOf(Web3.to_checksum_address(user)).call()

    def deposit(self, amount: int) -> str:
        return self._send("deposit", amount)

    def withdraw(self, shares: int) -> str:
        return self._send("withdraw", shares)


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
        self.track_record_v2 = (
            TrackRecordV2Client(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.track_record_v2),
                    abi=TRACK_RECORD_V2_ABI,
                ),
                account,
            )
            if addresses.track_record_v2
            else None
        )
        self.covenant_vault = (
            CovenantVaultClient(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.covenant_vault),
                    abi=COVENANT_VAULT_ABI,
                ),
                account,
            )
            if addresses.covenant_vault
            else None
        )
        self.risk_kernel = (
            RiskKernelClient(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.risk_kernel),
                    abi=RISK_KERNEL_V2_ABI,
                ),
                account,
            )
            if addresses.risk_kernel
            else None
        )
        self.slash_bond = (
            SlashBondClient(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.slash_bond),
                    abi=SLASH_BOND_ABI,
                ),
                account,
            )
            if addresses.slash_bond
            else None
        )
        self.agent_pool = (
            AgentPoolClient(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.agent_pool),
                    abi=AGENT_POOL_ABI,
                ),
                account,
            )
            if addresses.agent_pool
            else None
        )

        self.covenant_vault_factory = (
            CovenantVaultFactoryClient(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.covenant_vault_factory),
                    abi=COVENANT_VAULT_FACTORY_ABI,
                ),
                account,
            )
            if addresses.covenant_vault_factory
            else None
        )
        self.covenant_inbox = (
            CovenantInboxClient(
                w3,
                w3.eth.contract(
                    address=Web3.to_checksum_address(addresses.covenant_inbox),
                    abi=COVENANT_INBOX_ABI,
                ),
                account,
            )
            if addresses.covenant_inbox
            else None
        )


class CovenantVaultFactoryClient(_SubClient):
    """Self-serve creation of CovenantVault instances."""

    def vault_count(self) -> int:
        return int(self._c.functions.vaultCount().call())

    def all_vaults(self) -> list[str]:
        return [str(a) for a in self._c.functions.allVaults().call()]

    def vaults_by_creator(self, creator: str) -> list[str]:
        return [
            str(a)
            for a in self._c.functions.vaultsByCreator(
                Web3.to_checksum_address(creator)
            ).call()
        ]

    def vaults_by_operator(self, operator: str) -> list[str]:
        return [
            str(a)
            for a in self._c.functions.vaultsByOperator(
                Web3.to_checksum_address(operator)
            ).call()
        ]

    def vaults_by_bot_id(self, bot_id: bytes) -> list[str]:
        return [str(a) for a in self._c.functions.vaultsByBotId(bot_id).call()]

    def create_vault(self, mandate: CovenantMandate) -> str:
        """Submit a factory.createVault(mandate) tx; returns the tx hash."""
        account = self._require_account()
        tup = (
            Web3.to_checksum_address(mandate.operator),
            mandate.bot_id,
            int(mandate.budget_usdc),
            int(mandate.max_drawdown_bps),
            int(mandate.receipt_freshness_sec),
            int(mandate.expiry),
            int(mandate.perf_fee_bps),
            Web3.to_checksum_address(mandate.bond_contract),
            Web3.to_checksum_address(mandate.risk_kernel),
            Web3.to_checksum_address(mandate.track_record_v2),
        )
        tx = self._c.functions.createVault(tup).build_transaction(
            {
                "from": account.address,
                "nonce": self._w3.eth.get_transaction_count(account.address),
            }
        )
        signed = account.sign_transaction(tx)
        return self._w3.eth.send_raw_transaction(signed.raw_transaction).hex()


class CovenantInboxClient(_SubClient):
    """Bridge-friendly USDC deposit wrapper for Covenant Accounts."""

    def shares_of(self, vault: str, recipient: str) -> int:
        return int(
            self._c.functions.sharesOf(
                Web3.to_checksum_address(vault),
                Web3.to_checksum_address(recipient),
            ).call()
        )

    def deposit_into(self, vault: str, recipient: str, amount: int) -> str:
        account = self._require_account()
        tx = self._c.functions.depositInto(
            Web3.to_checksum_address(vault),
            Web3.to_checksum_address(recipient),
            int(amount),
        ).build_transaction(
            {
                "from": account.address,
                "nonce": self._w3.eth.get_transaction_count(account.address),
            }
        )
        signed = account.sign_transaction(tx)
        return self._w3.eth.send_raw_transaction(signed.raw_transaction).hex()

    def claim(self, vault: str, shares: int) -> str:
        account = self._require_account()
        tx = self._c.functions.claim(
            Web3.to_checksum_address(vault),
            int(shares),
        ).build_transaction(
            {
                "from": account.address,
                "nonce": self._w3.eth.get_transaction_count(account.address),
            }
        )
        signed = account.sign_transaction(tx)
        return self._w3.eth.send_raw_transaction(signed.raw_transaction).hex()
