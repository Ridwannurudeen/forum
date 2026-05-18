// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault, IERC20} from "./CovenantVault.sol";

/// @title CovenantVaultFactory
/// @notice Self-serve creation of Covenant Accounts. Anyone can call
///         `createVault(mandate)` and get a fresh, immutable `CovenantVault`
///         bound to the given mandate. USDC is fixed at factory deploy time
///         (per chain), so the caller never has to know the predeploy
///         address.
///
///         The factory emits a `VaultCreated` event with `vault`, `creator`,
///         and `operator` indexed (the three event-indexing slots), so the
///         Forum indexer can subscribe once and pick up every new vault
///         without redeploying. `botId` lives in event data plus the
///         `vaultsByBotId` view for direct lookup.
///
///         The factory is immutable — no admin, no upgrade path, no
///         pausing. It is a thin discovery layer over `CovenantVault`'s
///         constructor.
contract CovenantVaultFactory {
    IERC20 public immutable usdc;

    address[] private _allVaults;
    mapping(address => address[]) private _vaultsByCreator;
    mapping(address => address[]) private _vaultsByOperator;
    mapping(bytes32 => address[]) private _vaultsByBotId;

    event VaultCreated(
        address indexed vault,
        address indexed creator,
        address indexed operator,
        bytes32 botId,
        uint128 budgetUsdc,
        uint64 createdAt
    );

    constructor(IERC20 _usdc) {
        require(address(_usdc) != address(0), "zero usdc");
        usdc = _usdc;
    }

    function createVault(CovenantVault.Mandate memory m) external returns (address vault) {
        // Constructor of CovenantVault validates the mandate (operator != 0,
        // budget > 0, drawdownBps <= 10000, perfFeeBps <= 5000, etc.) so we
        // do not duplicate those checks here.
        CovenantVault deployed = new CovenantVault(usdc, m);
        vault = address(deployed);

        _allVaults.push(vault);
        _vaultsByCreator[msg.sender].push(vault);
        _vaultsByOperator[m.operator].push(vault);
        _vaultsByBotId[m.botId].push(vault);

        emit VaultCreated(vault, msg.sender, m.operator, m.botId, m.budgetUsdc, uint64(block.timestamp));
    }

    function vaultCount() external view returns (uint256) {
        return _allVaults.length;
    }

    function vaultAt(uint256 idx) external view returns (address) {
        return _allVaults[idx];
    }

    function allVaults() external view returns (address[] memory) {
        return _allVaults;
    }

    function vaultsByCreator(address creator) external view returns (address[] memory) {
        return _vaultsByCreator[creator];
    }

    function vaultsByOperator(address operator) external view returns (address[] memory) {
        return _vaultsByOperator[operator];
    }

    function vaultsByBotId(bytes32 botId) external view returns (address[] memory) {
        return _vaultsByBotId[botId];
    }
}
