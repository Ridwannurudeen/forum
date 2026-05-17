// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title CovenantVault
/// @notice Programmable USDC credit line for an autonomous trading agent.
///         Depositors put USDC in; the operator (agent owner) can only
///         draw capital up to `mandate.budgetUsdc` AND only while the vault
///         is `ACTIVE`. State transitions are driven by a permissionless
///         `RiskKernel` that evaluates four rule types against on-chain
///         receipts (drawdown, outstanding-vs-budget, freshness, expiry).
///
///         Forum's wedge: the agent never owns the funds. It only receives
///         constrained execution rights. Investors keep on-chain control:
///         pause is instant, slashing is automatic, withdraw works even
///         when paused.
///
///         Out-of-scope for v1:
///           - Allowed-venues bitmask (operator self-discipline + receipt audit)
///           - USYC parking (deferred to v1.1 pending USYC ABI probe)
///           - Multi-agent bidding for the same mandate
///
///         Composes with existing Forum primitives:
///           - mandate.botId  → TrackRecordV2 records (drawdown source)
///           - mandate.bondContract → SlashBond (operator collateral)
///           - mandate.riskKernel → RiskKernel (state transitions)
contract CovenantVault {
    struct Mandate {
        address operator;            // the bot owner
        bytes32 botId;               // links to TrackRecordV2
        uint128 budgetUsdc;          // max outstanding the operator can hold
        uint16 maxDrawdownBps;       // pause if pnl drops > this fraction of peak
        uint32 receiptFreshnessSec;  // pause if no record published within this window
        uint64 expiry;               // mandate dies at this unix ts (0 = never)
        uint16 perfFeeBps;           // operator perf fee above HWM
        address bondContract;        // SlashBond for this operator
        address riskKernel;          // who can call setState
        address trackRecordV2;       // record source for drawdown / freshness
    }

    enum State { ACTIVE, PAUSED }

    IERC20 public immutable usdc;
    Mandate public mandate;

    State public state;
    uint256 public totalShares;
    uint256 public depositTotalIdle;
    uint256 public operatorOutstanding;
    uint256 public highWaterMark;
    uint256 public operatorClaimable;
    uint64 public createdAt;

    uint256 private constant ONE = 1e18;

    mapping(address => uint256) public sharesOf;

    event Deposit(address indexed user, uint256 usdcIn, uint256 sharesMinted);
    event Withdraw(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    event CreditPulled(uint256 amount, uint256 outstandingAfter);
    event CapitalReturned(uint256 amount, uint256 outstandingAfter);
    event StateChanged(State previous, State current, bytes32 reason);
    event FeeCrystallised(uint256 perfFeeUsdc, uint256 newHwmPerShare1e18);
    event OperatorClaim(uint256 amount);

    error ZeroAmount();
    error NotOperator();
    error NotRiskKernel();
    error MandateNotActive();
    error MandateExpired();
    error BudgetExceeded();
    error InsufficientIdle();
    error InsufficientShares();

    modifier onlyOperator() {
        if (msg.sender != mandate.operator) revert NotOperator();
        _;
    }
    modifier onlyRiskKernel() {
        if (msg.sender != mandate.riskKernel) revert NotRiskKernel();
        _;
    }
    modifier onlyActive() {
        if (state != State.ACTIVE) revert MandateNotActive();
        if (mandate.expiry != 0 && block.timestamp >= mandate.expiry) revert MandateExpired();
        _;
    }

    constructor(IERC20 _usdc, Mandate memory _m) {
        require(_m.operator != address(0), "zero operator");
        require(_m.riskKernel != address(0), "zero risk kernel");
        require(_m.budgetUsdc > 0, "zero budget");
        require(_m.maxDrawdownBps <= 10_000, "bad drawdown bps");
        require(_m.perfFeeBps <= 5_000, "perf fee > 50%");
        usdc = _usdc;
        mandate = _m;
        state = State.ACTIVE;
        highWaterMark = ONE;
        createdAt = uint64(block.timestamp);
    }

    // ------------------------------------------------------------------
    // Depositor surface
    // ------------------------------------------------------------------

    function assets() public view returns (uint256) {
        return depositTotalIdle + operatorOutstanding;
    }

    function perSharePrice() public view returns (uint256) {
        if (totalShares == 0) return ONE;
        return (assets() * ONE) / totalShares;
    }

    function deposit(uint256 amount) external returns (uint256 sharesMinted) {
        if (amount == 0) revert ZeroAmount();
        if (totalShares == 0) {
            sharesMinted = amount;
        } else {
            sharesMinted = (amount * totalShares) / assets();
            if (sharesMinted == 0) revert ZeroAmount();
        }
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert();
        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        depositTotalIdle += amount;
        emit Deposit(msg.sender, amount, sharesMinted);
    }

    /// @notice Withdraw works in any state — depositors are never trapped.
    function withdraw(uint256 shares) external returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();
        uint256 userShares = sharesOf[msg.sender];
        if (shares > userShares) revert InsufficientShares();
        usdcOut = (shares * assets()) / totalShares;
        if (usdcOut > depositTotalIdle) revert InsufficientIdle();
        sharesOf[msg.sender] = userShares - shares;
        totalShares -= shares;
        depositTotalIdle -= usdcOut;
        if (!usdc.transfer(msg.sender, usdcOut)) revert();
        emit Withdraw(msg.sender, shares, usdcOut);
    }

    // ------------------------------------------------------------------
    // Operator credit-line surface
    // ------------------------------------------------------------------

    function availableCredit() public view returns (uint256) {
        if (operatorOutstanding >= mandate.budgetUsdc) return 0;
        uint256 budgetRemaining = uint256(mandate.budgetUsdc) - operatorOutstanding;
        uint256 idleCap = depositTotalIdle;
        return budgetRemaining < idleCap ? budgetRemaining : idleCap;
    }

    function pullCredit(uint256 amount) external onlyOperator onlyActive {
        if (amount == 0) revert ZeroAmount();
        uint256 avail = availableCredit();
        if (amount > avail) revert BudgetExceeded();
        depositTotalIdle -= amount;
        operatorOutstanding += amount;
        if (!usdc.transfer(mandate.operator, amount)) revert();
        emit CreditPulled(amount, operatorOutstanding);
    }

    function returnCapital(uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(mandate.operator, address(this), amount)) revert();
        depositTotalIdle += amount;
        if (amount >= operatorOutstanding) operatorOutstanding = 0;
        else operatorOutstanding -= amount;
        emit CapitalReturned(amount, operatorOutstanding);
    }

    function crystalliseFee() external {
        if (totalShares == 0) return;
        uint256 px = perSharePrice();
        if (px <= highWaterMark) return;
        uint256 profitPerShare1e18 = px - highWaterMark;
        uint256 perfFeeUsdc = (profitPerShare1e18 * totalShares * mandate.perfFeeBps) / (ONE * 10_000);
        if (perfFeeUsdc == 0) return;
        if (perfFeeUsdc > depositTotalIdle) perfFeeUsdc = depositTotalIdle;
        depositTotalIdle -= perfFeeUsdc;
        operatorClaimable += perfFeeUsdc;
        highWaterMark = perSharePrice();
        emit FeeCrystallised(perfFeeUsdc, highWaterMark);
    }

    function operatorClaim() external onlyOperator {
        uint256 amount = operatorClaimable;
        if (amount == 0) revert ZeroAmount();
        operatorClaimable = 0;
        if (!usdc.transfer(mandate.operator, amount)) revert();
        emit OperatorClaim(amount);
    }

    // ------------------------------------------------------------------
    // RiskKernel surface (state transitions)
    // ------------------------------------------------------------------

    function setState(State newState, bytes32 reason) external onlyRiskKernel {
        State prev = state;
        if (prev == newState) return;
        state = newState;
        emit StateChanged(prev, newState, reason);
    }
}
