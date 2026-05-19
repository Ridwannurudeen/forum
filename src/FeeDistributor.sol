// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BuilderCodeRegistry} from "./BuilderCodeRegistry.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title FeeDistributor
/// @notice Splits USDC fees per builder code by an attribution table the code
///         owner sets. Pull-pattern claim (no push to recipient code), basis
///         points must sum to exactly 10_000.
contract FeeDistributor {
    struct Attribution {
        address[] recipients;
        uint16[] bps;
    }

    BuilderCodeRegistry public immutable registry;
    IERC20 public immutable usdc;

    mapping(bytes32 => Attribution) private _attr;
    mapping(address => uint256) public claimable;

    event AttributionSet(bytes32 indexed code, address[] recipients, uint16[] bps);
    event Distributed(bytes32 indexed code, uint256 total);
    event Claimed(address indexed who, uint256 amount);

    error NotCodeOwner();
    error LengthMismatch();
    error BpsMismatch();
    error NoAttribution();
    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();
    error NothingToClaim();

    constructor(BuilderCodeRegistry _registry, IERC20 _usdc) {
        registry = _registry;
        usdc = _usdc;
    }

    function setAttribution(bytes32 code, address[] calldata r, uint16[] calldata bps) external {
        if (registry.ownerOf(code) != msg.sender) revert NotCodeOwner();
        if (r.length != bps.length) revert LengthMismatch();
        uint256 sum;
        for (uint256 i; i < bps.length; ++i) {
            if (r[i] == address(0)) revert ZeroAddress();
            sum += bps[i];
        }
        if (sum != 10_000) revert BpsMismatch();
        _attr[code] = Attribution(r, bps);
        emit AttributionSet(code, r, bps);
    }

    function distribute(bytes32 code, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Attribution storage a = _attr[code];
        if (a.recipients.length == 0) revert NoAttribution();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 allocated;
        for (uint256 i = 1; i < a.recipients.length; ++i) {
            uint256 portion = (amount * a.bps[i]) / 10_000;
            claimable[a.recipients[i]] += portion;
            allocated += portion;
        }
        claimable[a.recipients[0]] += amount - allocated;
        emit Distributed(code, amount);
    }

    function claim() external {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    function attributionOf(bytes32 code) external view returns (Attribution memory) {
        return _attr[code];
    }
}
