// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";
import {IStrategyAdapter} from "./IStrategyAdapter.sol";

/// @title IdleStrategyAdapter
/// @notice Zero-yield strategy: the adapter simply custodies the vault's USDC
///         and returns it on request. The dependency-free deployment target
///         that proves the vault-custodied deploy/recall path on-chain today,
///         while real-yield adapters (USYC) are allowlist-gated. Crucially the
///         USDC sits in the ADAPTER, not the operator — so the "agent never
///         owns the funds" invariant holds even for the idle path.
contract IdleStrategyAdapter is IStrategyAdapter {
    IERC20 public immutable usdc;
    address public immutable vault;

    error NotVault();
    error TransferFailed();

    constructor(IERC20 _usdc, address _vault) {
        require(address(_usdc) != address(0), "zero usdc");
        require(_vault != address(0), "zero vault");
        usdc = _usdc;
        vault = _vault;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function deposit(uint256 amount) external onlyVault returns (uint256) {
        if (!usdc.transferFrom(msg.sender, address(this), amount))
            revert TransferFailed();
        return amount;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        uint256 amt = amount > bal ? bal : amount; // max() => withdraw all
        if (amt > 0 && !usdc.transfer(vault, amt)) revert TransferFailed();
        return amt;
    }
}
