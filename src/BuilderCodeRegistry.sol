// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title BuilderCodeRegistry
/// @notice First-claim-wins binding from a bytes32 builder code to an owner
///         address. Mirrors the bytes32 builder field on Polymarket V2 signed
///         orders. No fees, no admin, no upgradability.
contract BuilderCodeRegistry {
    mapping(bytes32 => address) public ownerOf;
    mapping(bytes32 => string) public metadataUri;

    event Claimed(bytes32 indexed code, address indexed owner);
    event Transferred(bytes32 indexed code, address indexed from, address indexed to);
    event Revoked(bytes32 indexed code, address indexed by);
    event MetadataSet(bytes32 indexed code, string uri);

    error AlreadyClaimed();
    error NotOwner();
    error ZeroAddress();

    function claim(bytes32 code) external {
        if (ownerOf[code] != address(0)) revert AlreadyClaimed();
        ownerOf[code] = msg.sender;
        emit Claimed(code, msg.sender);
    }

    function transfer(bytes32 code, address to) external {
        if (ownerOf[code] != msg.sender) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        ownerOf[code] = to;
        emit Transferred(code, msg.sender, to);
    }

    function revoke(bytes32 code) external {
        if (ownerOf[code] != msg.sender) revert NotOwner();
        ownerOf[code] = address(0);
        emit Revoked(code, msg.sender);
    }

    function setMetadata(bytes32 code, string calldata uri) external {
        if (ownerOf[code] != msg.sender) revert NotOwner();
        metadataUri[code] = uri;
        emit MetadataSet(code, uri);
    }
}
