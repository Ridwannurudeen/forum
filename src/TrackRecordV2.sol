// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title TrackRecordV2
/// @notice Recomputable performance ledger per bot. Each record is EIP-712
///         signed by the bot's registered signer (Agent Wallet) AND must
///         satisfy four hard constraints checked on-chain:
///
///           (1) Strict sequence:   seq == lastSeq + 1
///           (2) Monotonic time:    periodEnd >= periodStart > lastPeriodEnd
///           (3) Hash chain:        prevRecordHash == storedLastRecordHash
///           (4) Replay protection: recordHash not previously seen
///
///         Records also commit to an evidenceUri + evidenceHash so the
///         underlying source data (order book snapshots, fills, balances,
///         PnL formula version, model decision trace) is REACHABLE and
///         RECOMPUTABLE off-chain. Without that, on-chain attestation is
///         signer-attribution but not falsifiability. With it, any third
///         party can verify the claim.
///
///         Designed to deploy ALONGSIDE the original TrackRecord (which
///         remains immutable). New bots register here; old bots continue
///         publishing to v1 until migration.
contract TrackRecordV2 {
    enum BotKind { MAKER, TAKER, ARB, OTHER }

    struct Record {
        uint64 seq;
        uint64 periodStart;
        uint64 periodEnd;
        int128 pnlMicros;
        uint64 fills;
        bytes32 metaHash;
        string evidenceUri;
        bytes32 evidenceHash;
        bytes32 prevRecordHash;
    }

    /// @dev Compact on-chain storage form — `evidenceUri` lives in calldata
    ///      and the event; we keep its keccak in storage for replay checks.
    struct StoredRecord {
        uint64 seq;
        uint64 periodStart;
        uint64 periodEnd;
        int128 pnlMicros;
        uint64 fills;
        bytes32 metaHash;
        bytes32 evidenceUriHash;
        bytes32 evidenceHash;
        bytes32 recordHash;
    }

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant RECORD_TYPEHASH = keccak256(
        "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)"
    );

    uint256 private constant _HALF_N_HIGH = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    uint256 private constant _HALF_N_LOW  = 0x5D576E7357A4501DDFE92F46681B20A0;

    mapping(bytes32 => BotKind) public botKind;
    mapping(bytes32 => address) public botSigner;
    mapping(bytes32 => StoredRecord[]) private _records;
    mapping(bytes32 => bytes32) public lastRecordHash; // per bot
    mapping(bytes32 => uint64) public lastSeq;          // per bot
    mapping(bytes32 => uint64) public lastPeriodEnd;    // per bot
    mapping(bytes32 => bool) public seenRecordHash;     // global replay set

    event BotRegistered(bytes32 indexed botId, BotKind kind, address indexed signer);
    event Published(
        bytes32 indexed botId,
        uint64 indexed seq,
        bytes32 indexed recordHash,
        uint64 periodStart,
        uint64 periodEnd,
        int128 pnlMicros,
        uint64 fills,
        string evidenceUri
    );

    error AlreadyRegistered();
    error NotRegistered();
    error BadSignature();
    error ZeroAddress();
    error BadSequence();
    error BadTimeWindow();
    error BadHashChain();
    error Replay();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("ForumTrackRecordV2"),
                keccak256("2"),
                block.chainid,
                address(this)
            )
        );
    }

    function registerBot(bytes32 botId, BotKind kind, address signer) external {
        if (botSigner[botId] != address(0)) revert AlreadyRegistered();
        if (signer == address(0)) revert ZeroAddress();
        botKind[botId] = kind;
        botSigner[botId] = signer;
        emit BotRegistered(botId, kind, signer);
    }

    /// @notice Publish a new record. Caller doesn't have to be the signer —
    ///         a relayer (e.g. the Forum indexer service) may submit on
    ///         behalf of the bot as long as the signature is valid.
    function publish(bytes32 botId, Record calldata r, bytes calldata signature) external {
        address signer = botSigner[botId];
        if (signer == address(0)) revert NotRegistered();

        // (1) strict sequence
        if (r.seq != lastSeq[botId] + 1) revert BadSequence();
        // (2) monotonic time
        if (r.periodStart <= lastPeriodEnd[botId] && lastSeq[botId] != 0) revert BadTimeWindow();
        if (r.periodEnd < r.periodStart) revert BadTimeWindow();
        // (3) hash chain
        if (r.prevRecordHash != lastRecordHash[botId]) revert BadHashChain();

        bytes32 evidenceUriHash = keccak256(bytes(r.evidenceUri));
        bytes32 digest = _digest(botId, uint8(botKind[botId]), r, evidenceUriHash);
        if (_recover(digest, signature) != signer) revert BadSignature();

        // (4) replay protection — the digest itself doubles as the canonical record hash
        if (seenRecordHash[digest]) revert Replay();
        seenRecordHash[digest] = true;

        _records[botId].push(StoredRecord({
            seq: r.seq,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            pnlMicros: r.pnlMicros,
            fills: r.fills,
            metaHash: r.metaHash,
            evidenceUriHash: evidenceUriHash,
            evidenceHash: r.evidenceHash,
            recordHash: digest
        }));
        lastSeq[botId] = r.seq;
        lastPeriodEnd[botId] = r.periodEnd;
        lastRecordHash[botId] = digest;

        emit Published(botId, r.seq, digest, r.periodStart, r.periodEnd, r.pnlMicros, r.fills, r.evidenceUri);
    }

    function recordCount(bytes32 botId) external view returns (uint256) {
        return _records[botId].length;
    }

    function recordAt(bytes32 botId, uint256 idx) external view returns (StoredRecord memory) {
        return _records[botId][idx];
    }

    function _digest(
        bytes32 botId,
        uint8 kind,
        Record calldata r,
        bytes32 evidenceUriHash
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                RECORD_TYPEHASH,
                botId,
                kind,
                r.seq,
                r.periodStart,
                r.periodEnd,
                r.pnlMicros,
                r.fills,
                r.metaHash,
                evidenceUriHash,
                r.evidenceHash,
                r.prevRecordHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        uint256 halfN = (_HALF_N_HIGH << 128) | _HALF_N_LOW;
        if (uint256(s) > halfN) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
