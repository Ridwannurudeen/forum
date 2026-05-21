// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title SlashBond
/// @notice Operator-staked USDC collateral that auto-slashes if a referenced
///         agent's signer-attributable performance falls below a benchmark
///         threshold within a window. Slashed funds flow to a recipient
///         (typically the AgentPool depositors via the pool address) or
///         burned by sending to a zero-rated sink.
///
///         The slashing oracle is `attestor` — a trusted address that
///         monitors TrackRecordV2 + computes the verdict. In v1.1 this
///         becomes a permissionless on-chain rule driven by TrackRecordV2
///         records + an external price/benchmark oracle.
///
///         v1 keeps the model simple:
///           - Operator deposits USDC; can withdraw any amount NOT under
///             a pending slash window.
///           - Attestor can call `slash(amount, reason)` up to current
///             bond balance, transferring USDC to `recipient`.
///           - Operator can request unbond (1-day cooldown to detect
///             attestor's slash decisions).
contract SlashBond {
    IERC20 public immutable usdc;
    address public immutable operator;
    address public immutable attestor;
    address public immutable recipient;
    bytes32 public immutable botId;
    uint64 public immutable unbondDelay;

    uint256 public bondBalance;
    uint256 public unbondAmount;
    uint64 public unbondRequestedAt;
    uint256 public totalSlashed;

    event Bonded(uint256 amount, uint256 newBalance);
    event UnbondRequested(uint256 amount, uint64 requestedAt);
    event UnbondClaimed(uint256 amount);
    event UnbondCancelled();
    event Slashed(uint256 amount, bytes32 indexed reason, uint256 newBalance);

    error ZeroAmount();
    error NotOperator();
    error NotAttestor();
    error InsufficientBond();
    error UnbondInFlight();
    error CooldownActive();
    error NothingToUnbond();

    modifier onlyOperator() { if (msg.sender != operator) revert NotOperator(); _; }
    modifier onlyAttestor() { if (msg.sender != attestor) revert NotAttestor(); _; }

    constructor(
        IERC20 _usdc,
        address _operator,
        address _attestor,
        address _recipient,
        bytes32 _botId,
        uint64 _unbondDelaySeconds
    ) {
        usdc = _usdc;
        operator = _operator;
        attestor = _attestor;
        recipient = _recipient;
        botId = _botId;
        unbondDelay = _unbondDelaySeconds;
    }

    function bond(uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        bondBalance += amount;
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "usdc transferFrom failed");
        emit Bonded(amount, bondBalance);
    }

    function requestUnbond(uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (amount > bondBalance) revert InsufficientBond();
        if (unbondAmount != 0) revert UnbondInFlight();
        unbondAmount = amount;
        unbondRequestedAt = uint64(block.timestamp);
        emit UnbondRequested(amount, unbondRequestedAt);
    }

    function cancelUnbond() external onlyOperator {
        if (unbondAmount == 0) revert NothingToUnbond();
        unbondAmount = 0;
        unbondRequestedAt = 0;
        emit UnbondCancelled();
    }

    function claimUnbond() external onlyOperator {
        if (unbondAmount == 0) revert NothingToUnbond();
        if (block.timestamp < unbondRequestedAt + unbondDelay) revert CooldownActive();
        uint256 amount = unbondAmount;
        if (amount > bondBalance) amount = bondBalance; // covers slash-during-cooldown
        bondBalance -= amount;
        unbondAmount = 0;
        unbondRequestedAt = 0;
        bool ok = usdc.transfer(operator, amount);
        require(ok, "usdc transfer failed");
        emit UnbondClaimed(amount);
    }

    /// @notice Attestor slashes the bond. Amount is capped by bondBalance.
    ///         `reason` is a free-form bytes32 (typically keccak of a
    ///         human-readable justification or a TrackRecordV2 record hash).
    function slash(uint256 amount, bytes32 reason) external onlyAttestor {
        if (amount == 0) revert ZeroAmount();
        if (amount > bondBalance) amount = bondBalance;
        bondBalance -= amount;
        totalSlashed += amount;
        // Slashed funds may also reduce a pending unbond proportionally —
        // if unbond claims more than remaining bondBalance, claimUnbond
        // will clamp to what's left.
        bool ok = usdc.transfer(recipient, amount);
        require(ok, "usdc transfer failed");
        emit Slashed(amount, reason, bondBalance);
    }
}
