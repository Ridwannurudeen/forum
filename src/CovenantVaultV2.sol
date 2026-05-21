// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";
import {IStrategyAdapter} from "./IStrategyAdapter.sol";

/// @notice The shared IERC20 omits approve(); the vault needs it to authorise a
///         strategy adapter to pull deployed USDC.
interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title CovenantVaultV2
/// @notice CovenantVault + vault-custodied strategy deployment. In V1 the
///         operator drew credit to its own EOA (it took custody). V2 closes
///         that: the operator can deploy idle vault USDC into a *governor-
///         approved* StrategyAdapter, and the funds move vault -> adapter, never
///         through the operator. The operator only triggers; it never holds the
///         capital. Recovered USDC (+ realized yield) returns to the vault.
///
///         Role separation:
///           - operator  draws credit (pullCredit) AND triggers strategy moves,
///                       but only into adapters the governor pre-approved.
///           - governor  curates the strategy allowlist (the trust boundary).
///           - riskKernel pauses/slashes per the mandate (unchanged from V1).
///
///         Accounting: assets() = idle + operatorOutstanding + strategyDeployed,
///         where strategyDeployed is the PRINCIPAL routed to strategies.
///         Realized yield (adapter returns more than principal on recall) lands
///         in idle and raises the per-share price; unrealized yield is not
///         marked up (conservative). Strategy-locked funds are not withdrawable
///         by depositors until recalled — same liquidity model as the router.
contract CovenantVaultV2 {
    struct Mandate {
        address operator;
        bytes32 botId;
        uint128 budgetUsdc;
        uint16 maxDrawdownBps;
        uint32 receiptFreshnessSec;
        uint64 expiry;
        uint16 perfFeeBps;
        address bondContract;
        address riskKernel;
        address trackRecordV2;
    }

    enum State {
        ACTIVE,
        PAUSED
    }

    IERC20 public immutable usdc;
    /// @notice Curates the strategy allowlist. Separate from the operator so a
    ///         compromised/greedy operator cannot route credit into a malicious
    ///         adapter — it can only use adapters the governor vetted.
    address public immutable governor;
    Mandate public mandate;

    State public state;
    uint256 public totalShares;
    uint256 public depositTotalIdle;
    uint256 public operatorOutstanding;
    uint256 public strategyDeployed; // principal routed to strategies
    uint256 public highWaterMark;
    uint256 public operatorClaimable;
    uint64 public createdAt;

    uint256 private constant ONE = 1e18;
    uint256 private _reentrancyGuard = 1;

    mapping(address => uint256) public sharesOf;
    mapping(address => bool) public allowedStrategy;
    mapping(address => uint256) public deployedTo; // per-adapter principal

    event Deposit(address indexed user, uint256 usdcIn, uint256 sharesMinted);
    event Withdraw(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    event CreditPulled(uint256 amount, uint256 outstandingAfter);
    event CapitalReturned(uint256 amount, uint256 outstandingAfter);
    event StateChanged(State previous, State current, bytes32 reason);
    event FeeCrystallised(uint256 perfFeeUsdc, uint256 newHwmPerShare1e18);
    event OperatorClaim(uint256 amount);
    event StrategyAllowed(address indexed adapter, bool allowed);
    event DeployedToStrategy(address indexed adapter, uint256 amount);
    event RecalledFromStrategy(address indexed adapter, uint256 principal, uint256 recovered);

    error ZeroAmount();
    error NotOperator();
    error NotGovernor();
    error NotRiskKernel();
    error MandateNotActive();
    error MandateExpired();
    error BudgetExceeded();
    error InsufficientIdle();
    error InsufficientShares();
    error StrategyNotAllowed();
    error AdapterMismatch();
    error Reentrancy();

    modifier onlyOperator() {
        if (msg.sender != mandate.operator) revert NotOperator();
        _;
    }
    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
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
    modifier nonReentrant() {
        if (_reentrancyGuard != 1) revert Reentrancy();
        _reentrancyGuard = 2;
        _;
        _reentrancyGuard = 1;
    }

    constructor(IERC20 _usdc, Mandate memory _m, address _governor) {
        require(_m.operator != address(0), "zero operator");
        require(_m.riskKernel != address(0), "zero risk kernel");
        require(_m.budgetUsdc > 0, "zero budget");
        require(_m.maxDrawdownBps <= 10_000, "bad drawdown bps");
        require(_m.perfFeeBps <= 5_000, "perf fee > 50%");
        require(_governor != address(0), "zero governor");
        usdc = _usdc;
        mandate = _m;
        governor = _governor;
        state = State.ACTIVE;
        highWaterMark = ONE;
        createdAt = uint64(block.timestamp);
    }

    // ------------------------------------------------------------------
    // Depositor surface
    // ------------------------------------------------------------------

    function assets() public view returns (uint256) {
        return depositTotalIdle + operatorOutstanding + strategyDeployed;
    }

    function perSharePrice() public view returns (uint256) {
        if (totalShares == 0) return ONE;
        return (assets() * ONE) / totalShares;
    }

    function deposit(uint256 amount) external nonReentrant returns (uint256 sharesMinted) {
        if (amount == 0) revert ZeroAmount();
        if (totalShares == 0) {
            sharesMinted = amount;
        } else {
            sharesMinted = (amount * totalShares) / assets();
            if (sharesMinted == 0) revert ZeroAmount();
        }
        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        depositTotalIdle += amount;
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert();
        emit Deposit(msg.sender, amount, sharesMinted);
    }

    /// @notice Withdraw works in any state — but only against idle liquidity.
    ///         Strategy-locked funds must be recalled first.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 usdcOut) {
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
        depositTotalIdle += amount;
        if (amount >= operatorOutstanding) operatorOutstanding = 0;
        else operatorOutstanding -= amount;
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert();
        emit CapitalReturned(amount, operatorOutstanding);
    }

    // ------------------------------------------------------------------
    // Vault-custodied strategy surface
    // ------------------------------------------------------------------

    /// @notice Governor curates which adapters the operator may route to.
    ///         On enable, the adapter must be bound to this vault + this USDC.
    function setStrategyAllowed(address adapter, bool ok) external onlyGovernor {
        if (ok) {
            if (IStrategyAdapter(adapter).asset() != address(usdc)) revert AdapterMismatch();
            if (IStrategyAdapter(adapter).vault() != address(this)) revert AdapterMismatch();
        }
        allowedStrategy[adapter] = ok;
        emit StrategyAllowed(adapter, ok);
    }

    /// @notice Deploy idle USDC into a governor-approved strategy. The USDC goes
    ///         vault -> adapter; the operator never holds it.
    function deployToStrategy(address adapter, uint256 amount)
        external
        onlyOperator
        onlyActive
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (!allowedStrategy[adapter]) revert StrategyNotAllowed();
        if (amount > depositTotalIdle) revert InsufficientIdle();
        depositTotalIdle -= amount;
        strategyDeployed += amount;
        deployedTo[adapter] += amount;
        if (!IERC20Approve(address(usdc)).approve(adapter, amount)) revert();
        IStrategyAdapter(adapter).deposit(amount);
        emit DeployedToStrategy(adapter, amount);
    }

    /// @notice Recall capital from a strategy. Allowed in ANY state and even if
    ///         the adapter was since de-allowed, so funds are never stuck.
    ///         `amount == type(uint256).max` recalls everything from the adapter.
    function recallFromStrategy(address adapter, uint256 amount)
        external
        onlyOperator
        nonReentrant
    {
        uint256 principal = deployedTo[adapter];
        if (principal == 0) revert ZeroAmount();
        uint256 recovered = IStrategyAdapter(adapter).withdraw(amount);
        uint256 principalCut = amount >= principal ? principal : amount;
        deployedTo[adapter] = principal - principalCut;
        strategyDeployed -= principalCut;
        depositTotalIdle += recovered;
        emit RecalledFromStrategy(adapter, principalCut, recovered);
    }

    // ------------------------------------------------------------------
    // Fees + state
    // ------------------------------------------------------------------

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

    function setState(State newState, bytes32 reason) external onlyRiskKernel {
        State prev = state;
        if (prev == newState) return;
        state = newState;
        emit StateChanged(prev, newState, reason);
    }
}
