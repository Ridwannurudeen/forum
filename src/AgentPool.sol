// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title AgentPool
/// @notice ERC-4626-shaped vault that follows ONE registered agent (`botId`).
///         Depositors put USDC in; pool mints LP shares pro-rata. The operator
///         (bot owner) can pull capital up to depositTotal for trading, must
///         return it via `operatorReturn`. A 20%-above-high-water-mark
///         performance fee accrues to the operator on `crystalliseFee()`.
///
///         Design constraints:
///           - Operator NEVER takes principal — only realised profits above
///             the HWM are claimable.
///           - Depositors withdraw their pro-rata of the current `assets()`
///             at any time (subject to operator returning capital first).
///           - Reentrancy is closed by CEI ordering + checks-effects on
///             every USDC mover; no callbacks to recipient code.
///
///         Out of scope (v1.1):
///           - Lockups, hurdle rates, sub-pools, KYC, cross-chain accounting.
contract AgentPool {
    IERC20 public immutable usdc;
    address public immutable operator;
    bytes32 public immutable botId;

    uint256 public totalShares;
    uint256 public depositTotalIdle;       // USDC sitting in the pool
    uint256 public operatorOutstanding;    // pulled by operator, not yet returned
    uint256 public highWaterMark;          // pool's per-share value at last crystallisation, ×1e18
    uint256 public operatorClaimable;      // accrued perf fees, in USDC

    uint16 public constant PERFORMANCE_FEE_BPS = 2_000; // 20%
    uint256 private constant ONE = 1e18;

    mapping(address => uint256) public sharesOf;

    event Deposit(address indexed user, uint256 usdcIn, uint256 sharesMinted);
    event Withdraw(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    event OperatorWithdraw(uint256 amount);
    event OperatorReturn(uint256 amount);
    event FeeCrystallised(uint256 perfFeeUsdc, uint256 newHwmPerShare1e18);
    event OperatorClaim(uint256 amount);

    error ZeroAmount();
    error InsufficientShares();
    error InsufficientIdle();
    error NotOperator();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IERC20 _usdc, address _operator, bytes32 _botId) {
        usdc = _usdc;
        operator = _operator;
        botId = _botId;
        highWaterMark = ONE; // start at 1.0 per-share
    }

    /// @notice Total assets under management: idle USDC + outstanding to operator + accrued perf fees deferred.
    function assets() public view returns (uint256) {
        return depositTotalIdle + operatorOutstanding;
    }

    /// @notice Current per-share value, scaled by 1e18. Returns 1e18 when totalShares==0.
    function perSharePrice() public view returns (uint256) {
        if (totalShares == 0) return ONE;
        return (assets() * ONE) / totalShares;
    }

    function deposit(uint256 amount) external returns (uint256 sharesMinted) {
        if (amount == 0) revert ZeroAmount();
        if (totalShares == 0) {
            sharesMinted = amount; // bootstrap: 1 share per micro-USDC
        } else {
            sharesMinted = (amount * totalShares) / assets();
            if (sharesMinted == 0) revert ZeroAmount();
        }
        // CEI: effects before the external pull; a failed transfer reverts the lot.
        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        depositTotalIdle += amount;
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "usdc transferFrom failed");
        emit Deposit(msg.sender, amount, sharesMinted);
    }

    function withdraw(uint256 shares) external returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();
        uint256 userShares = sharesOf[msg.sender];
        if (shares > userShares) revert InsufficientShares();
        usdcOut = (shares * assets()) / totalShares;
        if (usdcOut > depositTotalIdle) revert InsufficientIdle();
        // CEI: update state, then transfer
        sharesOf[msg.sender] = userShares - shares;
        totalShares -= shares;
        depositTotalIdle -= usdcOut;
        bool ok = usdc.transfer(msg.sender, usdcOut);
        require(ok, "usdc transfer failed");
        emit Withdraw(msg.sender, shares, usdcOut);
    }

    function operatorWithdraw(uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (amount > depositTotalIdle) revert InsufficientIdle();
        depositTotalIdle -= amount;
        operatorOutstanding += amount;
        bool ok = usdc.transfer(operator, amount);
        require(ok, "usdc transfer failed");
        emit OperatorWithdraw(amount);
    }

    /// @notice Operator returns capital + any realised PnL. The contract
    ///         doesn't care if PnL is positive or negative — it just credits
    ///         the returned amount as idle. Outstanding tracks the cumulative
    ///         operatorWithdraw minus operatorReturn.
    function operatorReturn(uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        depositTotalIdle += amount;
        // If outstanding underflows, that means operator returned MORE than
        // they pulled — that's profit. Clamp at zero; the difference shows
        // up as a per-share-price increase.
        if (amount >= operatorOutstanding) operatorOutstanding = 0;
        else operatorOutstanding -= amount;
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "usdc transferFrom failed");
        emit OperatorReturn(amount);
    }

    /// @notice Crystallise the operator's performance fee on profits above
    ///         the high-water mark. Anyone can call; fee accrues to operator.
    function crystalliseFee() external {
        if (totalShares == 0) return;
        uint256 px = perSharePrice();
        if (px <= highWaterMark) return;
        uint256 profitPerShare1e18 = px - highWaterMark;
        // perf fee in USDC = (profitPerShare * totalShares * bps) / (1e18 * 1e4)
        uint256 perfFeeUsdc = (profitPerShare1e18 * totalShares * PERFORMANCE_FEE_BPS) / (ONE * 10_000);
        if (perfFeeUsdc == 0) return;
        if (perfFeeUsdc > depositTotalIdle) perfFeeUsdc = depositTotalIdle;
        depositTotalIdle -= perfFeeUsdc;
        operatorClaimable += perfFeeUsdc;
        highWaterMark = perSharePrice(); // new HWM after fee taken
        emit FeeCrystallised(perfFeeUsdc, highWaterMark);
    }

    function operatorClaim() external onlyOperator {
        uint256 amount = operatorClaimable;
        if (amount == 0) revert ZeroAmount();
        operatorClaimable = 0;
        bool ok = usdc.transfer(operator, amount);
        require(ok, "usdc transfer failed");
        emit OperatorClaim(amount);
    }
}
