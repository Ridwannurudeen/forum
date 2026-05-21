// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";
import {IStrategyAdapter} from "./IStrategyAdapter.sol";

/// @notice Hashnote's USYC Teller: USDC <-> USYC at the fund's price.
interface ITeller {
    function buy(uint256 amount) external returns (uint256);
    function sell(uint256 amount) external returns (uint256);
}

/// @notice The shared IERC20 omits approve(); the adapter needs it to authorise
///         the Teller to pull USDC/USYC.
interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title UsycStrategyAdapter
/// @notice Real Treasury yield: deploys the vault's USDC into USYC (Circle's
///         tokenized U.S. Treasury fund, native to Arc) via Hashnote's Teller,
///         and redeems it back on withdraw. USDC and USYC are held by the
///         ADAPTER on the vault's behalf — the operator never custodies them.
///
///         Gating: the Teller is behind Circle's Entitlements allowlist; the
///         adapter contract address must be allowlisted before `buy` succeeds.
///         Until then `deposit` reverts and the vault should route to an
///         allowlist-free adapter (idle). `totalAssets` is reported
///         conservatively as the adapter's USDC + USYC base-unit balances; the
///         exact USDC value is realized on `withdraw` (Teller.sell).
contract UsycStrategyAdapter is IStrategyAdapter {
    IERC20 public immutable usdc;
    IERC20 public immutable usyc;
    address public immutable teller;
    address public immutable vault;

    error NotVault();
    error TransferFailed();
    error ApprovalFailed();

    constructor(IERC20 _usdc, IERC20 _usyc, address _teller, address _vault) {
        require(address(_usdc) != address(0), "zero usdc");
        require(address(_usyc) != address(0), "zero usyc");
        require(_teller != address(0), "zero teller");
        require(_vault != address(0), "zero vault");
        usdc = _usdc;
        usyc = _usyc;
        teller = _teller;
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
        return usyc.balanceOf(address(this)) + usdc.balanceOf(address(this));
    }

    function deposit(uint256 amount) external onlyVault returns (uint256) {
        if (!usdc.transferFrom(msg.sender, address(this), amount))
            revert TransferFailed();
        if (!IERC20Approve(address(usdc)).approve(teller, amount))
            revert ApprovalFailed();
        ITeller(teller).buy(amount); // mints USYC to this adapter
        return amount;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256) {
        uint256 usycBal = usyc.balanceOf(address(this));
        // USYC ~ USDC at 6 decimals; sell enough USYC to cover `amount` (or all).
        uint256 toSell = (amount >= usycBal) ? usycBal : amount;
        if (toSell > 0) {
            if (!IERC20Approve(address(usyc)).approve(teller, toSell))
                revert ApprovalFailed();
            ITeller(teller).sell(toSell); // burns USYC, returns USDC to this
        }
        uint256 bal = usdc.balanceOf(address(this));
        if (bal > 0 && !usdc.transfer(vault, bal)) revert TransferFailed();
        return bal;
    }
}
