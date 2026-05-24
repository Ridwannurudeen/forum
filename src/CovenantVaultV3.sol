// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault, IERC20} from "./CovenantVault.sol";

interface IBondBalance {
    function bondBalance() external view returns (uint256);
}

/// @title CovenantVaultV3
/// @notice CovenantVault that refuses to lend unless the operator's SlashBond
///         is collateralised to at least the full mandate budget. Closes the
///         "tiny bond, big budget" under-collateralisation gap: pullCredit
///         reverts UnderBonded() unless bondBalance >= budgetUsdc.
contract CovenantVaultV3 is CovenantVault {
    error UnderBonded();

    constructor(IERC20 _usdc, Mandate memory _m) CovenantVault(_usdc, _m) {}

    function pullCredit(uint256 amount) public override onlyOperator onlyActive {
        address b = mandate.bondContract;
        if (b == address(0) || IBondBalance(b).bondBalance() < mandate.budgetUsdc) {
            revert UnderBonded();
        }
        super.pullCredit(amount);
    }
}
