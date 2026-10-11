// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";
import {TrackRecordV2} from "./TrackRecordV2.sol";

interface IERC20Allowance {
    function allowance(address, address) external view returns (uint256);
}

/// @title PolicyVault
/// @notice Non-custodial spend-control vault. The owner pays each payee directly
///         through `transferFrom`; this contract never holds USDC.
/// @dev Every `Paid` event has exactly one TrackRecordV2 record, bound by
///      `recordSeq`. The converse does not hold: `publish` is permissionless,
///      so the agent can publish a payment-shaped record without a payment.
///      `Paid` is the payment ledger; records are the agent's signed claims.
///
///      This bot is registered as `BotKind.OTHER`. Here, `pnlMicros` means the
///      signed cash-flow impact on the owner's wallet: `-amount` for a payment
///      and zero for a refusal or deferral. `fills` is the number of payments
///      in the record: one for a payment and zero otherwise. It does not mean
///      trading profit and loss in this spend-policy context.
contract PolicyVault {
    uint64 public constant PAYEE_COOLING_SEC = 86_400;
    uint64 public constant EPOCH_SEC = 30 days;
    // The -int128(amount) cast is safe only because amount <= perTxCap <= this
    // ceiling; the ceiling must not be removed.
    uint128 public constant MAX_EPOCH_BUDGET = 1_000e6;
    bytes32 private constant PAYMENT_META_TAG = keccak256("ForumPolicyVault.Payment.v1");

    IERC20 public immutable usdc;
    TrackRecordV2 public immutable trackRecord;
    address public immutable owner;
    bytes32 public immutable botId;
    uint64 public immutable createdAt;

    address public agent;
    bool public paused;
    uint256 public totalPaidUsdc;
    uint64 public paymentCount;
    uint256 private _reentrancyGuard = 1;

    struct Payee {
        address account;
        uint64 registeredAt;
        uint128 dailyCap;
        bool active;
    }

    struct Category {
        uint128 epochBudget;
        uint128 perTxCap;
        uint128 perDayCap;
        bool exists;
    }

    mapping(bytes32 => Payee) public payees;
    mapping(bytes32 => Category) public categories;
    mapping(bytes32 => mapping(uint64 => uint128)) public categoryEpochSpent;
    mapping(bytes32 => mapping(uint64 => uint128)) public categoryDaySpent;
    mapping(bytes32 => mapping(uint64 => uint128)) public payeeDaySpent;

    error NotOwner();
    error NotAgent();
    error Paused();
    error ZeroAmount();
    error ZeroAddress();
    error PayeeExists();
    error PayeeUnknown();
    error PayeeInactive();
    error PayeeCooling();
    error CategoryUnknown();
    error BudgetTooLarge();
    error CapOrder();
    error OverPerTxCap();
    error OverDayCap();
    error OverPayeeDayCap();
    error OverEpochBudget();
    error RecordMismatch();
    error TransferFailed();
    error Reentrancy();

    event AgentChanged(address indexed previous, address indexed current);
    event PausedSet(bool paused);
    event PayeeRegistered(bytes32 indexed payeeId, address account, uint128 dailyCap, uint64 registeredAt, uint64 payableFrom);
    event PayeeDeactivated(bytes32 indexed payeeId);
    event CategorySet(bytes32 indexed categoryId, uint128 epochBudget, uint128 perTxCap, uint128 perDayCap);
    event Paid(
        bytes32 indexed payeeId,
        bytes32 indexed categoryId,
        address indexed account,
        uint128 amount,
        bytes32 recordMeta,
        uint64 recordSeq,
        uint64 paymentIndex
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyGuard != 1) revert Reentrancy();
        _reentrancyGuard = 2;
        _;
        _reentrancyGuard = 1;
    }

    constructor(IERC20 _usdc, TrackRecordV2 _tr, address _owner, address _agent, bytes32 _botId) {
        if (address(_usdc) == address(0) || address(_tr) == address(0) || _owner == address(0)
            || _agent == address(0)) revert ZeroAddress();
        if (_tr.botSigner(_botId) == address(0)) revert ZeroAddress();
        usdc = _usdc;
        trackRecord = _tr;
        owner = _owner;
        agent = _agent;
        botId = _botId;
        createdAt = uint64(block.timestamp);
    }

    /// @notice Rotates caller authority only. TrackRecordV2 fixes the signer
    ///         at `registerBot` and rejects re-registration with
    ///         `AlreadyRegistered`; a new agent can call `pay` only when the
    ///         original key signs its records. Rotating the signer requires a
    ///         new vault and `botId`, and every payee must cool again.
    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        address previous = agent;
        agent = newAgent;
        emit AgentChanged(previous, newAgent);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Payee accounts cannot be edited in place. Use a new payee ID
    ///         after deactivation so an account change cools again.
    function registerPayee(bytes32 payeeId, address account, uint128 dailyCap) external onlyOwner {
        if (payees[payeeId].account != address(0)) revert PayeeExists();
        if (account == address(0) || account == address(this)) revert ZeroAddress();
        if (dailyCap == 0) revert ZeroAmount();
        uint64 registeredAt = uint64(block.timestamp);
        payees[payeeId] = Payee({account: account, registeredAt: registeredAt, dailyCap: dailyCap, active: true});
        emit PayeeRegistered(payeeId, account, dailyCap, registeredAt, registeredAt + PAYEE_COOLING_SEC);
    }

    function deactivatePayee(bytes32 payeeId) external onlyOwner {
        if (payees[payeeId].account == address(0)) revert PayeeUnknown();
        payees[payeeId].active = false;
        emit PayeeDeactivated(payeeId);
    }

    function setCategory(bytes32 categoryId, uint128 epochBudget, uint128 perTxCap, uint128 perDayCap)
        external
        onlyOwner
    {
        if (epochBudget > MAX_EPOCH_BUDGET) revert BudgetTooLarge();
        if (epochBudget == 0 || perTxCap == 0) revert ZeroAmount();
        if (perTxCap > perDayCap || perDayCap > epochBudget) revert CapOrder();
        categories[categoryId] = Category({
            epochBudget: epochBudget,
            perTxCap: perTxCap,
            perDayCap: perDayCap,
            exists: true
        });
        emit CategorySet(categoryId, epochBudget, perTxCap, perDayCap);
    }

    /// @notice The record periodEnd must not exceed block time; payments are limited to one per distinct timestamp second per bot. Keepers must use the latest block timestamp, never local wall-clock.
    function pay(
        bytes32 payeeId,
        bytes32 categoryId,
        uint128 amount,
        TrackRecordV2.Record calldata rec,
        bytes calldata recSig
    ) external onlyAgent whenNotPaused nonReentrant returns (uint64 paymentIndex) {
        if (amount == 0) revert ZeroAmount();
        if (payees[payeeId].account == address(0)) revert PayeeUnknown();
        if (!payees[payeeId].active) revert PayeeInactive();
        if (block.timestamp < payees[payeeId].registeredAt + PAYEE_COOLING_SEC) revert PayeeCooling();
        if (!categories[categoryId].exists) revert CategoryUnknown();
        if (amount > categories[categoryId].perTxCap) revert OverPerTxCap();
        {
            uint64 dayIndex = uint64(block.timestamp / 86_400);
            if (uint256(payeeDaySpent[payeeId][dayIndex]) + amount > payees[payeeId].dailyCap) {
                revert OverPayeeDayCap();
            }
            if (uint256(categoryDaySpent[categoryId][dayIndex]) + amount > categories[categoryId].perDayCap) {
                revert OverDayCap();
            }
        }
        {
            uint64 epochIndex = currentEpochIndex();
            if (uint256(categoryEpochSpent[categoryId][epochIndex]) + amount > categories[categoryId].epochBudget) {
                revert OverEpochBudget();
            }
        }
        bytes32 meta = _paymentMeta(payeeId, categoryId, amount);
        if (rec.metaHash != meta) revert RecordMismatch();
        if (rec.pnlMicros != -int128(amount) || rec.fills != 1) revert RecordMismatch();
        // At most one payment per distinct timestamp second per bot. Keepers must use the latest block timestamp for periodEnd, never local wall-clock.
        if (rec.periodEnd > block.timestamp) revert RecordMismatch();
        trackRecord.publish(botId, rec, recSig);
        payeeDaySpent[payeeId][uint64(block.timestamp / 86_400)] += amount;
        categoryDaySpent[categoryId][uint64(block.timestamp / 86_400)] += amount;
        categoryEpochSpent[categoryId][currentEpochIndex()] += amount;
        totalPaidUsdc += amount;
        paymentIndex = ++paymentCount;
        if (!usdc.transferFrom(owner, payees[payeeId].account, amount)) revert TransferFailed();
        emit Paid(payeeId, categoryId, payees[payeeId].account, amount, meta, rec.seq, paymentIndex);
    }

    function paymentMeta(bytes32 payeeId, bytes32 categoryId, uint128 amount) external view returns (bytes32) {
        return _paymentMeta(payeeId, categoryId, amount);
    }

    /// @notice Necessary but not sufficient: this cannot observe a signer mismatch, desynced record chain, or runtime blocklist. The sufficient check is an eth_call preflight of the exact pay() calldata.
    /// @dev Refusal codes: 1 paused, 2 unknown payee, 3 inactive payee, 4 cooling, 5 unknown category, 6 zero/over-transaction amount, 7 payee day cap, 8 category day cap, 9 epoch budget, 10 owner spendable, 11 bot not registered.
    function canPay(bytes32 payeeId, bytes32 categoryId, uint128 amount)
        external
        view
        returns (bool ok, uint8 code)
    {
        if (trackRecord.botSigner(botId) == address(0)) return (false, 11);
        if (paused) return (false, 1);
        if (payees[payeeId].account == address(0)) return (false, 2);
        if (!payees[payeeId].active) return (false, 3);
        if (block.timestamp < payees[payeeId].registeredAt + PAYEE_COOLING_SEC) return (false, 4);
        if (!categories[categoryId].exists) return (false, 5);
        if (amount == 0 || amount > categories[categoryId].perTxCap) return (false, 6);
        if (uint256(payeeDaySpent[payeeId][uint64(block.timestamp / 86_400)]) + amount
            > payees[payeeId].dailyCap) return (false, 7);
        if (uint256(categoryDaySpent[categoryId][uint64(block.timestamp / 86_400)]) + amount
            > categories[categoryId].perDayCap) return (false, 8);
        if (uint256(categoryEpochSpent[categoryId][currentEpochIndex()]) + amount
            > categories[categoryId].epochBudget) return (false, 9);
        if (ownerSpendable() < amount) return (false, 10);
        return (true, 0);
    }

    function remainingEpochBudget(bytes32 categoryId) external view returns (uint128) {
        if (!categories[categoryId].exists) return 0;
        uint128 budget = categories[categoryId].epochBudget;
        uint128 spent = categoryEpochSpent[categoryId][currentEpochIndex()];
        return spent >= budget ? 0 : budget - spent;
    }

    function remainingDayCap(bytes32 categoryId) external view returns (uint128) {
        if (!categories[categoryId].exists) return 0;
        uint128 cap = categories[categoryId].perDayCap;
        uint128 spent = categoryDaySpent[categoryId][uint64(block.timestamp / 86_400)];
        return spent >= cap ? 0 : cap - spent;
    }

    function remainingPayeeDayCap(bytes32 payeeId) external view returns (uint128) {
        if (payees[payeeId].account == address(0)) return 0;
        uint128 cap = payees[payeeId].dailyCap;
        uint128 spent = payeeDaySpent[payeeId][uint64(block.timestamp / 86_400)];
        return spent >= cap ? 0 : cap - spent;
    }

    function payeePayableFrom(bytes32 payeeId) external view returns (uint64) {
        return payees[payeeId].account == address(0)
            ? 0
            : payees[payeeId].registeredAt + PAYEE_COOLING_SEC;
    }

    function ownerSpendable() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(owner);
        uint256 approved = IERC20Allowance(address(usdc)).allowance(owner, address(this));
        return balance < approved ? balance : approved;
    }

    function currentEpochIndex() public view returns (uint64) {
        return uint64((block.timestamp - createdAt) / EPOCH_SEC);
    }

    function _paymentMeta(bytes32 payeeId, bytes32 categoryId, uint128 amount)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(PAYMENT_META_TAG, block.chainid, address(this), payeeId, categoryId, amount));
    }
}
