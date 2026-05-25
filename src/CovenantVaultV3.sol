// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault, IERC20} from "./CovenantVault.sol";

interface IBondIdentity {
    function bondBalance() external view returns (uint256);
    function operator() external view returns (address);
    function attestor() external view returns (address);
    function botId() external view returns (bytes32);
}

/// @title CovenantVaultV3
/// @notice CovenantVault that refuses to lend unless the operator's SlashBond
///         is collateralised to at least the full mandate budget. Closes the
///         "tiny bond, big budget" under-collateralisation gap: pullCredit
///         reverts UnderBonded() unless bondBalance >= budgetUsdc.
contract CovenantVaultV3 is CovenantVault {
    error UnderBonded();
    error BondMismatch();

    constructor(IERC20 _usdc, Mandate memory _m) CovenantVault(_usdc, _m) {}

    function pullCredit(uint256 amount) public override onlyOperator onlyActive {
        address b = mandate.bondContract;
        if (b == address(0)) revert UnderBonded();
        IBondIdentity bond = IBondIdentity(b);
        if (
            bond.operator() != mandate.operator ||
            bond.attestor() != mandate.riskKernel ||
            bond.botId() != mandate.botId
        ) {
            revert BondMismatch();
        }
        if (bond.bondBalance() < mandate.budgetUsdc) {
            revert UnderBonded();
        }
        super.pullCredit(amount);
    }
}
