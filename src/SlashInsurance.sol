// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";

interface ISlashBond {
    function totalSlashed() external view returns (uint256);
    function bondBalance() external view returns (uint256);
}

interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title SlashInsurance
/// @notice Phase 9 continuous-premium insurance pool, complementary to the
///         binary SlashMarket prediction product. An operator (or any
///         backer) deposits USDC premiums into a per-bond pool; when the
///         bond gets slashed, anyone calls `notifySlash()` and the pool
///         transfers the slash delta out to the bond's `recipient`
///         (via the SlashBond's own bonding interface — see note below).
///
///         v0 design (honest):
///         - Pool is per-`SlashBond`. One contract per (insurance product,
///           bond) — strategist can deploy many.
///         - Anyone funds via `payPremium(amount)` — typically the
///           operator who wants to self-insure, but could be a third
///           party paid by the operator off-chain.
///         - `notifySlash()` reads `bond.totalSlashed()` against the last
///           snapshot. If it grew, the pool calls a `topUp` callback to
///           the recipient — for the canonical case (recipient = the
///           CovenantVault) the recipient pulls USDC; for the original
///           SlashBondV1.1 where recipient = deployer EOA, the pool
///           transfers USDC directly to the recipient address.
///         - Funder can `withdrawPremium(amount)` of their UNPAID-OUT
///           contribution. Once a slash payout happens, that USDC is gone
///           from their share — pro-rata burn-down.
///
///         What this gives the system:
///         - Depositors of the CovenantVault recipient get topped-up
///           coverage beyond the bond itself.
///         - Operator can advertise "this bond is also insured up to X"
///           which counts toward AgentScore v1's bond-coverage bonus.
///         - Third parties can underwrite an operator's reputation
///           cheaply — a credit-default-swap-shaped exposure.
///
///         Out-of-scope for v0:
///         - Premium pricing oracle (operator/funder sets premium amount
///           manually; market discovery via SlashMarket gives the YES
///           probability as a price hint)
///         - Multi-bond tranches
///         - Claims arbitration (the slash event itself is the trigger;
///           no off-chain claim adjusters)
///
///         Immutable. No admin keys.
contract SlashInsurance {
    IERC20 public immutable usdc;
    ISlashBond public immutable bond;
    /// @notice Address that receives slash-triggered top-up USDC. Should
    ///         be either the bond contract (to auto-replenish operator
    ///         skin-in-the-game) or the bond's recipient (to compensate
    ///         the entity that took the loss). Set at deploy time.
    address public immutable topUpRecipient;

    uint256 public totalPremium;          // running sum of unpaid contributions
    uint256 public totalPaidOut;
    uint256 public lastSlashedSnapshot;   // bond.totalSlashed() at last notifySlash

    mapping(address => uint256) public contribOf;

    event PremiumPaid(address indexed funder, uint256 amount, uint256 newTotal);
    event PremiumWithdrawn(address indexed funder, uint256 amount, uint256 newTotal);
    event SlashCovered(uint256 slashDelta, uint256 paidOut, uint256 newSnapshot);

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientShare();
    error TransferFailed();

    constructor(IERC20 _usdc, ISlashBond _bond, address _topUpRecipient) {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        if (address(_bond) == address(0)) revert ZeroAddress();
        if (_topUpRecipient == address(0)) revert ZeroAddress();
        usdc = _usdc;
        bond = _bond;
        topUpRecipient = _topUpRecipient;
        lastSlashedSnapshot = _bond.totalSlashed();
    }

    function payPremium(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        contribOf[msg.sender] += amount;
        totalPremium += amount;
        emit PremiumPaid(msg.sender, amount, totalPremium);
    }

    /// @notice Anyone may withdraw their UNPAID-OUT contribution. If the
    ///         pool has paid out, withdrawals shrink pro-rata (you only
    ///         get back what's still in the pool times your share).
    function withdrawPremium(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 share = contribOf[msg.sender];
        if (share == 0 || amount > share) revert InsufficientShare();
        uint256 pool = usdc.balanceOf(address(this));
        // proportional payout from current pool
        uint256 payout = (amount * pool) / totalPremium;
        contribOf[msg.sender] = share - amount;
        totalPremium -= amount;
        if (payout > 0) {
            if (!usdc.transfer(msg.sender, payout)) revert TransferFailed();
        }
        emit PremiumWithdrawn(msg.sender, payout, totalPremium);
    }

    /// @notice Read the bond's totalSlashed and, if it grew since the last
    ///         snapshot, transfer the slash delta (capped at pool balance)
    ///         to the configured top-up recipient. Permissionless.
    function notifySlash() external returns (uint256 paidOut) {
        uint256 nowSlashed = bond.totalSlashed();
        if (nowSlashed <= lastSlashedSnapshot) {
            // no new slash since last call
            return 0;
        }
        uint256 delta = nowSlashed - lastSlashedSnapshot;
        uint256 pool = usdc.balanceOf(address(this));
        paidOut = delta < pool ? delta : pool;
        lastSlashedSnapshot = nowSlashed;
        if (paidOut > 0) {
            totalPaidOut += paidOut;
            if (!usdc.transfer(topUpRecipient, paidOut)) revert TransferFailed();
        }
        emit SlashCovered(delta, paidOut, nowSlashed);
    }

    function poolBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
