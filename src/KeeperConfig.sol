// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title KeeperConfig
/// @notice Append-only per-(operator, botId) config history. Operators write
///         their own; anyone can read. Bots poll the latest snapshot.
///         Config payload is opaque bytes — each bot defines its own schema.
contract KeeperConfig {
    struct Snapshot {
        uint64 version;
        uint64 updatedAt;
        bytes data;
    }

    mapping(address => mapping(bytes32 => Snapshot[])) private _history;

    event ConfigUpdated(address indexed operator, bytes32 indexed botId, uint64 version);

    error NoConfig();

    function setConfig(bytes32 botId, bytes calldata data) external {
        Snapshot[] storage h = _history[msg.sender][botId];
        uint64 nextVersion = uint64(h.length + 1);
        h.push(Snapshot({version: nextVersion, updatedAt: uint64(block.timestamp), data: data}));
        emit ConfigUpdated(msg.sender, botId, nextVersion);
    }

    function getConfig(address operator, bytes32 botId) external view returns (Snapshot memory) {
        Snapshot[] storage h = _history[operator][botId];
        if (h.length == 0) revert NoConfig();
        return h[h.length - 1];
    }

    function historyLength(address operator, bytes32 botId) external view returns (uint256) {
        return _history[operator][botId].length;
    }

    function snapshotAt(address operator, bytes32 botId, uint256 idx)
        external
        view
        returns (Snapshot memory)
    {
        return _history[operator][botId][idx];
    }
}
