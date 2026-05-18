// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault, IERC20} from "./CovenantVault.sol";

/// CovenantVault's IERC20 omits approve() because the vault never approves.
/// The inbox needs approve() to authorise vault.deposit() to pull USDC.
interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title CovenantInbox
/// @notice Bridge-friendly wrapper that lets a sender deposit USDC into a
///         CovenantVault on behalf of a designated recipient. The recipient
///         later withdraws via this contract.
///
///         Motivation: USDC arriving on Arc via CCTP V2 (Domain 26) lands in
///         the recipient's wallet directly. To one-shot the bridge + deposit
///         in a single user-side flow, the user can route the bridged USDC
///         through `CovenantInbox.depositInto(vault, recipient, amount)`,
///         which:
///           1. transfers USDC from the caller into the inbox,
///           2. approves the vault,
///           3. calls vault.deposit(amount) (inbox becomes the share holder
///              from the vault's perspective),
///           4. credits the resulting shares to `recipient` in the inbox's
///              internal ledger.
///
///         The recipient later calls `claim(vault, shares)` to convert their
///         inbox-ledger shares into USDC (the inbox calls vault.withdraw +
///         forwards the USDC out).
///
///         This contract is immutable. No admin, no upgrades.
contract CovenantInbox {
    /// inboxShares[vault][recipient]
    mapping(address => mapping(address => uint256)) public inboxShares;

    event Credited(
        address indexed vault,
        address indexed recipient,
        uint256 usdcIn,
        uint256 sharesMinted
    );
    event Claimed(
        address indexed vault,
        address indexed recipient,
        uint256 sharesBurned,
        uint256 usdcOut
    );

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientInboxShares();

    function depositInto(
        address vaultAddr,
        address recipient,
        uint256 amount
    ) external returns (uint256 sharesMinted) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        CovenantVault vault = CovenantVault(vaultAddr);
        IERC20 usdc = vault.usdc();

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert();
        if (!IERC20Approve(address(usdc)).approve(vaultAddr, amount)) revert();
        sharesMinted = vault.deposit(amount);

        inboxShares[vaultAddr][recipient] += sharesMinted;
        emit Credited(vaultAddr, recipient, amount, sharesMinted);
    }

    function claim(
        address vaultAddr,
        uint256 shares
    ) external returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();
        uint256 owned = inboxShares[vaultAddr][msg.sender];
        if (shares > owned) revert InsufficientInboxShares();

        CovenantVault vault = CovenantVault(vaultAddr);
        IERC20 usdc = vault.usdc();

        inboxShares[vaultAddr][msg.sender] = owned - shares;
        usdcOut = vault.withdraw(shares);

        if (!usdc.transfer(msg.sender, usdcOut)) revert();
        emit Claimed(vaultAddr, msg.sender, shares, usdcOut);
    }

    function sharesOf(address vaultAddr, address recipient) external view returns (uint256) {
        return inboxShares[vaultAddr][recipient];
    }
}
