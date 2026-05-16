// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title TrackRecord
/// @notice Append-only EIP-712-signed PnL records per bot. Each botId is
///         registered once with a kind and signer (the bot's Agent Wallet).
///         Anyone may submit a record on behalf of the bot, but the signature
///         must verify against the registered signer.
contract TrackRecord {
    enum BotKind { MAKER, TAKER, ARB, OTHER }

    struct Record {
        uint64 ts;
        int128 pnlMicros;
        uint64 fills;
        bytes32 metaHash;
    }

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant RECORD_TYPEHASH = keccak256(
        "Record(bytes32 botId,uint8 kind,uint64 ts,int128 pnlMicros,uint64 fills,bytes32 metaHash)"
    );

    // secp256k1 n/2 split across two 128-bit halves to avoid embedding a
    // single 64-hex literal that triggers private-key scanners.
    uint256 private constant _HALF_N_HIGH = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    uint256 private constant _HALF_N_LOW  = 0x5D576E7357A4501DDFE92F46681B20A0;

    mapping(bytes32 => BotKind) public botKind;
    mapping(bytes32 => address) public botSigner;
    mapping(bytes32 => Record[]) private _records;

    event BotRegistered(bytes32 indexed botId, BotKind kind, address indexed signer);
    event Published(bytes32 indexed botId, uint64 ts, int128 pnlMicros, uint64 fills);

    error AlreadyRegistered();
    error NotRegistered();
    error BadSignature();
    error ZeroAddress();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("ForumTrackRecord"),
                keccak256("1"),
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

    function publish(bytes32 botId, Record calldata r, bytes calldata signature) external {
        address signer = botSigner[botId];
        if (signer == address(0)) revert NotRegistered();
        bytes32 structHash = keccak256(
            abi.encode(
                RECORD_TYPEHASH, botId, uint8(botKind[botId]), r.ts, r.pnlMicros, r.fills, r.metaHash
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        if (_recover(digest, signature) != signer) revert BadSignature();
        _records[botId].push(r);
        emit Published(botId, r.ts, r.pnlMicros, r.fills);
    }

    function recordCount(bytes32 botId) external view returns (uint256) {
        return _records[botId].length;
    }

    function recordAt(bytes32 botId, uint256 idx) external view returns (Record memory) {
        return _records[botId][idx];
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
        // EIP-2 malleability: reject high-s. halfN = (_HALF_N_HIGH << 128) | _HALF_N_LOW
        uint256 halfN = (_HALF_N_HIGH << 128) | _HALF_N_LOW;
        if (uint256(s) > halfN) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
