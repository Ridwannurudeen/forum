// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";

/// @title FeeRouterV1
/// @notice Phase 6 fee router. An operator (or anyone) creates a named
///         split — a list of (recipient, bps) summing to 10000 — then
///         pipes USDC fees into that split. Allocations accrue per
///         recipient and are claimed via a pull pattern.
///
///         Why this exists:
///         - `CovenantVault.operatorClaim()` already sweeps performance
///           fees to the operator wallet. That gives a single-recipient
///           payout; Forum needs to express operator + researcher +
///           referrer + protocol shares.
///         - `FeeDistributor.sol` already splits by `bytes32` builder
///           code, but the code-owner gate isn't right for the
///           per-vault case. FeeRouterV1 is the per-split equivalent.
///
///         How a typical flow looks:
///         1. Operator calls `createSplit([researcher, referrer, self], [3000, 1000, 6000])`.
///         2. Operator runs `crystalliseFee()` + `operatorClaim()` on
///            the CovenantVault (existing surface). USDC lands in the
///            operator EOA.
///         3. Operator approves FeeRouterV1, then calls
///            `pay(splitId, amount)`. The router transfers USDC in and
///            adds `(amount * bps[i] / 10000)` to each recipient's
///            `claimable`.
///         4. Each recipient calls `claim()` to pull their balance.
///
///         Properties:
///         - Immutable, no admin keys.
///         - `bps` must sum to exactly 10000 at create time. Rounding
///           dust from integer division is added to the FIRST recipient
///           so the running sum always equals what was paid in.
///         - A split is permanent — recipients/bps cannot be edited.
///           To change attribution, create a new split id.
///         - `pay` is permissionless: anyone can route to a split
///           (e.g. a fee-reconcile keeper that pays in on the
///           operator's behalf after they approve).
contract FeeRouterV1 {
    struct SplitView {
        address creator;
        address[] recipients;
        uint16[] bps;
        uint256 totalRouted;
        uint64 createdAt;
    }

    IERC20 public immutable usdc;

    address[] private _creators;
    uint64[] private _createdAts;
    uint256[] private _totalsRouted;
    // splitId -> recipients
    mapping(uint256 => address[]) private _recipients;
    // splitId -> bps (parallel to _recipients)
    mapping(uint256 => uint16[]) private _bps;
    // splitId -> recipient -> amount they may claim
    mapping(uint256 => mapping(address => uint256)) public claimableOf;
    // recipient -> running total across all splits (gas-cheap claim aggregator)
    mapping(address => uint256) public totalClaimableOf;

    event SplitCreated(uint256 indexed splitId, address indexed creator, address[] recipients, uint16[] bps);
    event Routed(uint256 indexed splitId, address indexed payer, uint256 amount);
    event Claimed(address indexed recipient, uint256 amount);

    error EmptyRecipients();
    error LengthMismatch();
    error BpsMismatch();
    error ZeroAmount();
    error ZeroAddress();
    error UnknownSplit();
    error TransferFailed();
    error NothingToClaim();

    constructor(IERC20 _usdc) {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        usdc = _usdc;
    }

    function splitCount() external view returns (uint256) {
        return _creators.length;
    }

    function createSplit(address[] calldata recipients, uint16[] calldata bps)
        external
        returns (uint256 splitId)
    {
        if (recipients.length == 0) revert EmptyRecipients();
        if (recipients.length != bps.length) revert LengthMismatch();
        uint256 sum;
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            sum += bps[i];
        }
        if (sum != 10_000) revert BpsMismatch();

        splitId = _creators.length;
        _creators.push(msg.sender);
        _createdAts.push(uint64(block.timestamp));
        _totalsRouted.push(0);
        for (uint256 i; i < recipients.length; ++i) {
            _recipients[splitId].push(recipients[i]);
            _bps[splitId].push(bps[i]);
        }
        emit SplitCreated(splitId, msg.sender, recipients, bps);
    }

    /// @notice Anyone may route USDC into a split they have approved.
    function pay(uint256 splitId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (splitId >= _creators.length) revert UnknownSplit();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        address[] storage recs = _recipients[splitId];
        uint16[] storage bps_ = _bps[splitId];
        uint256 allocated;
        // i >= 1 uses exact integer division; i == 0 absorbs rounding dust
        // so that sum(allocations) == amount and we don't strand wei in
        // the contract that nobody can claim.
        for (uint256 i = 1; i < recs.length; ++i) {
            uint256 portion = (amount * bps_[i]) / 10_000;
            claimableOf[splitId][recs[i]] += portion;
            totalClaimableOf[recs[i]] += portion;
            allocated += portion;
        }
        uint256 first = amount - allocated;
        claimableOf[splitId][recs[0]] += first;
        totalClaimableOf[recs[0]] += first;

        _totalsRouted[splitId] += amount;
        emit Routed(splitId, msg.sender, amount);
    }

    /// @notice Pull-pattern claim. Sweeps the caller's `totalClaimableOf`
    ///         across every split.
    function claim() external returns (uint256 amount) {
        amount = totalClaimableOf[msg.sender];
        if (amount == 0) revert NothingToClaim();
        totalClaimableOf[msg.sender] = 0;
        // Note: per-split `claimableOf` is NOT zeroed here. It is a
        // historical accounting view; what gates payout is
        // `totalClaimableOf`. A caller that wants the per-split breakdown
        // can read `claimableOf(splitId, recipient)` before/after.
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    function splitAt(uint256 splitId) external view returns (SplitView memory) {
        if (splitId >= _creators.length) revert UnknownSplit();
        return SplitView({
            creator: _creators[splitId],
            recipients: _recipients[splitId],
            bps: _bps[splitId],
            totalRouted: _totalsRouted[splitId],
            createdAt: _createdAts[splitId]
        });
    }
}
