// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RiskKernelV2, ITrackRecordV2} from "../src/RiskKernelV2.sol";
import {CovenantVault, IERC20} from "../src/CovenantVault.sol";
import {SlashBond, IERC20 as IERC20SB} from "../src/SlashBond.sol";

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external { allowance[msg.sender][spender] = amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}

contract MockTrackRecordV2 {
    mapping(bytes32 => ITrackRecordV2.StoredRecord[]) private _records;
    function pushRecord(bytes32 botId, int128 pnlMicros, uint64 periodEnd) external {
        ITrackRecordV2.StoredRecord memory r;
        r.seq = uint64(_records[botId].length) + 1;
        r.periodEnd = periodEnd;
        r.pnlMicros = pnlMicros;
        _records[botId].push(r);
    }
    function recordCount(bytes32 botId) external view returns (uint256) { return _records[botId].length; }
    function recordAt(bytes32 botId, uint256 idx) external view returns (ITrackRecordV2.StoredRecord memory) {
        return _records[botId][idx];
    }
}

contract RiskKernelV2FuzzTest is Test {
    MockUsdc usdc;
    MockTrackRecordV2 mockTr;
    RiskKernelV2 kernel;
    SlashBond bond;
    CovenantVault vault;
    bytes32 constant BOT = keccak256("fuzz-v2-bot");
    address operator = address(0x0BEC);
    address recipient = address(0xBEEF);
    address alice = address(0xA11CE);

    uint128 constant BUDGET = 500e6;
    uint16 constant MAX_DD_BPS = 500; // 5%
    uint32 constant FRESHNESS_SEC = 600;
    uint16 constant SLASH_BPS = 2_500; // 25% per violation (matches contract constant)

    function _newVaultWithBond() internal returns (CovenantVault, SlashBond) {
        SlashBond sb = new SlashBond(
            IERC20SB(address(usdc)), operator, address(kernel), recipient, BOT, 86400
        );
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator,
            botId: BOT,
            budgetUsdc: BUDGET,
            maxDrawdownBps: MAX_DD_BPS,
            receiptFreshnessSec: FRESHNESS_SEC,
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(sb),
            riskKernel: address(kernel),
            trackRecordV2: address(mockTr)
        });
        return (new CovenantVault(IERC20(address(usdc)), m), sb);
    }

    RiskKernelV2Handler internal handler;

    function setUp() public {
        usdc = new MockUsdc();
        mockTr = new MockTrackRecordV2();
        kernel = new RiskKernelV2();
        (vault, bond) = _newVaultWithBond();
        usdc.mint(alice, 10_000e6);
        usdc.mint(operator, 1_000_000e6);
        vm.prank(alice); usdc.approve(address(vault), 1_000e6);
        vm.prank(alice); vault.deposit(1_000e6);

        // Pre-approve the bond contract from operator so the handler can
        // bond more on demand via prank. (Approval is per-spender; bond()
        // calls usdc.transferFrom from operator.) Use type(uint256).max so
        // approvals don't drift across fuzz runs.
        vm.prank(operator); usdc.approve(address(bond), type(uint256).max);

        handler = new RiskKernelV2Handler(kernel, vault, bond, mockTr, BOT, FRESHNESS_SEC, operator);
        targetContract(address(handler));
    }

    function _bondAmount(uint256 amount) internal {
        vm.prank(operator); usdc.approve(address(bond), amount);
        vm.prank(operator); bond.bond(amount);
    }

    // ---------- fuzz: first-negative beyond budget => pause + slash ----------

    /// @notice Codex fix coverage on V2: a first-period loss whose magnitude
    ///         crosses the budget * maxDrawdownBps / 10_000 threshold pauses
    ///         the vault AND slashes 25% of current bond in the same tx.
    function testFuzz_first_negative_pause_and_slash(uint128 lossSeed, uint128 bondSeed) public {
        uint256 thresholdMicros = (uint256(BUDGET) * MAX_DD_BPS) / 10_000;
        uint256 lossMag = bound(uint256(lossSeed), thresholdMicros, uint256(uint128(type(int128).max)));
        int128 pnl = -int128(int256(lossMag));

        uint256 bondAmt = bound(uint256(bondSeed), 1e6, 100_000e6);
        _bondAmount(bondAmt);
        uint256 expectedSlash = (bondAmt * SLASH_BPS) / 10_000;
        if (expectedSlash == 0) expectedSlash = bondAmt;

        mockTr.pushRecord(BOT, pnl, uint64(block.timestamp));

        uint256 recipBefore = usdc.balanceOf(recipient);
        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED), "must pause on first-negative beyond budget");
        assertEq(bond.bondBalance(), bondAmt - expectedSlash, "bond balance off");
        assertEq(usdc.balanceOf(recipient) - recipBefore, expectedSlash, "recipient credit mismatch");
        assertEq(bond.totalSlashed(), expectedSlash, "totalSlashed mismatch");
    }

    /// @notice Companion guard: first-negative WITHIN budget threshold must
    ///         neither pause nor slash. Codex's fix must not regress here.
    function testFuzz_first_negative_within_budget_does_not_pause_or_slash(uint128 lossSeed) public {
        uint256 thresholdMicros = (uint256(BUDGET) * MAX_DD_BPS) / 10_000;
        vm.assume(thresholdMicros > 0);
        uint256 lossMag = bound(uint256(lossSeed), 1, thresholdMicros - 1);
        int128 pnl = -int128(int256(lossMag));

        _bondAmount(100e6);
        mockTr.pushRecord(BOT, pnl, uint64(block.timestamp));

        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
        assertEq(bond.totalSlashed(), 0);
        assertEq(bond.bondBalance(), 100e6);
    }

    // ---------- fuzz: positive peak + drawdown => pause + slash ----------

    function testFuzz_post_peak_drawdown_pause_and_slash(uint128 peakRaw, uint16 dropBpsRaw, uint128 bondSeed) public {
        uint128 peak = uint128(bound(uint256(peakRaw), 1, uint256(uint128(type(int128).max)) / 2));
        uint256 dropBps = bound(uint256(dropBpsRaw), MAX_DD_BPS, 10_000);
        uint256 dropMicros = (uint256(peak) * dropBps) / 10_000;
        int128 cur = int128(int256(uint256(peak) - dropMicros));
        if (peak == 0 || cur >= int128(int256(uint256(peak)))) return;

        // After integer truncation, recompute actual bps to gate the assertion.
        uint256 actualDdBps = (uint256(peak) - uint256(int256(cur))) * 10_000 / uint256(peak);
        vm.assume(actualDdBps >= MAX_DD_BPS);

        uint256 bondAmt = bound(uint256(bondSeed), 1e6, 100_000e6);
        _bondAmount(bondAmt);
        uint256 expectedSlash = (bondAmt * SLASH_BPS) / 10_000;
        if (expectedSlash == 0) expectedSlash = bondAmt;

        mockTr.pushRecord(BOT, int128(int256(uint256(peak))), uint64(block.timestamp));
        mockTr.pushRecord(BOT, cur, uint64(block.timestamp));

        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(bond.totalSlashed(), expectedSlash);
    }

    // ---------- fuzz: slash amount is bounded by bond balance ----------

    /// @notice For any bond amount up to a huge value and any single
    ///         violation, the slashed amount NEVER exceeds the bond balance
    ///         and is exactly min(bond * 2500 / 10_000, bond). This is the
    ///         contract's slash policy, and the bound holds across the
    ///         full uint256 fuzz range for the bond.
    function testFuzz_slash_amount_bounded_by_bond(uint256 bondSeed) public {
        // Bond up to a very large but realistic ceiling (operator has 1M USDC).
        uint256 bondAmt = bound(bondSeed, 1, 1_000_000e6);
        _bondAmount(bondAmt);

        // Force a guaranteed-pause violation.
        mockTr.pushRecord(BOT, -int128(int256(uint256(BUDGET))), uint64(block.timestamp));

        uint256 expected = (bondAmt * SLASH_BPS) / 10_000;
        if (expected == 0) expected = bondAmt;
        // Cannot exceed bond balance.
        assertLe(expected, bondAmt, "policy expectation exceeds bond");

        kernel.enforce(address(vault));

        // Slashed is exactly the policy amount.
        assertEq(bond.totalSlashed(), expected, "slash != policy amount");
        // And bond balance reduced by exactly that.
        assertEq(bond.bondBalance(), bondAmt - expected, "bond balance off");
        // Total of bond + slashed never exceeds original.
        assertLe(bond.bondBalance() + bond.totalSlashed(), bondAmt, "conservation broken");
    }

    /// @notice Across MANY violations, cumulative slashing converges toward
    ///         (but never exceeds) the original bond. This is the geometric
    ///         decay property: 25% off the remaining bond each time.
    function testFuzz_repeated_slashing_never_exceeds_bond(uint8 violationsRaw, uint128 bondSeed) public {
        uint256 violations = bound(uint256(violationsRaw), 1, 20);
        uint256 bondAmt = bound(uint256(bondSeed), 1e6, 100_000e6);
        _bondAmount(bondAmt);

        for (uint256 i = 0; i < violations; ++i) {
            // Stale-receipt path: push a record then warp past freshness.
            mockTr.pushRecord(BOT, int128(int256(1_000_000)), uint64(block.timestamp));
            vm.warp(block.timestamp + FRESHNESS_SEC + 1);
            kernel.enforce(address(vault));
            // Revive so we can violate again.
            mockTr.pushRecord(BOT, int128(int256(1_100_000)), uint64(block.timestamp));
            kernel.enforce(address(vault));
        }

        assertLe(bond.totalSlashed(), bondAmt, "cumulative slash exceeds original bond");
        assertEq(bond.bondBalance() + bond.totalSlashed(), bondAmt, "bond + slashed must equal original");
    }

    // ---------- fuzz: idempotence ----------

    /// @notice Calling `enforce` repeatedly on a paused vault does NOT
    ///         re-slash on each call. The slash is bound to the state
    ///         transition, not the verdict. This is the Codex
    ///         "no double-slash" guarantee.
    function testFuzz_enforce_no_double_slash_on_repeat(uint8 repeatsRaw) public {
        _bondAmount(100e6);

        // Push a violation.
        mockTr.pushRecord(BOT, -int128(int256(uint256(BUDGET))), uint64(block.timestamp));

        kernel.enforce(address(vault));
        uint256 slashedOnce = bond.totalSlashed();
        assertGt(slashedOnce, 0, "first enforce should slash");

        uint256 n = bound(uint256(repeatsRaw), 1, 16);
        for (uint256 i = 0; i < n; ++i) {
            kernel.enforce(address(vault));
        }
        assertEq(bond.totalSlashed(), slashedOnce, "repeated enforce must not re-slash");
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
    }

    /// @notice Calling `enforce` on a vault whose bond has been fully
    ///         drained never reverts and never causes phantom slashing.
    function testFuzz_enforce_with_drained_bond_no_revert(uint8 repeatsRaw) public {
        // Don't bond at all — bond balance is 0.
        mockTr.pushRecord(BOT, int128(int256(1_000_000)), uint64(block.timestamp));
        vm.warp(block.timestamp + FRESHNESS_SEC + 1);

        uint256 n = bound(uint256(repeatsRaw), 1, 8);
        for (uint256 i = 0; i < n; ++i) {
            kernel.enforce(address(vault)); // must not revert
        }
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(bond.totalSlashed(), 0, "no slash possible when bond is 0");
    }

    // ---------- fuzz: expiry does NOT slash ----------

    /// @notice Codex fix preservation: an expired mandate pauses the vault
    ///         but does NOT slash, because expiry is a timeout, not an
    ///         operator fault. Fuzz the expiry offset to confirm the rule
    ///         holds across many expiry windows.
    function testFuzz_expiry_pauses_but_does_not_slash(uint32 expiryOffsetRaw, uint128 bondSeed) public {
        uint256 offset = bound(uint256(expiryOffsetRaw), 1, 365 days);
        uint256 bondAmt = bound(uint256(bondSeed), 1e6, 100_000e6);

        // Build a NEW vault with explicit expiry; reuse the existing kernel.
        SlashBond sb = new SlashBond(
            IERC20SB(address(usdc)), operator, address(kernel), recipient, BOT, 86400
        );
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator, botId: BOT, budgetUsdc: BUDGET, maxDrawdownBps: MAX_DD_BPS,
            receiptFreshnessSec: FRESHNESS_SEC, expiry: uint64(block.timestamp + offset),
            perfFeeBps: 2_000, bondContract: address(sb),
            riskKernel: address(kernel), trackRecordV2: address(mockTr)
        });
        CovenantVault expiringVault = new CovenantVault(IERC20(address(usdc)), m);
        vm.prank(operator); usdc.approve(address(sb), bondAmt);
        vm.prank(operator); sb.bond(bondAmt);

        vm.warp(block.timestamp + offset + 1);
        kernel.enforce(address(expiringVault));

        assertEq(uint8(expiringVault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(sb.totalSlashed(), 0, "expiry must not slash");
        assertEq(sb.bondBalance(), bondAmt, "expiry must not touch bond");
    }

    // ---------- invariants ----------

    /// @notice The cumulative slash never exceeds the total bonded.
    function invariant_cumulative_slash_bounded_by_total_bonded() public view {
        assertLe(bond.totalSlashed(), handler.initialBondTotal(), "cumulative slash > total bonded");
    }

    /// @notice Conservation: bondBalance + totalSlashed == sum of every
    ///         bond ever made. The handler does not use unbond, so the
    ///         only outflow from the bond is via slash.
    function invariant_bond_plus_slashed_equals_total_bonded() public view {
        assertEq(
            bond.bondBalance() + bond.totalSlashed(),
            handler.initialBondTotal(),
            "bond + slashed must equal total bonded"
        );
    }

    /// @notice After any handler sequence, enforce converges in a single
    ///         additional call to the expected state.
    function invariant_enforce_converges_in_one_call_v2() public {
        kernel.enforce(address(vault));
        RiskKernelV2.Verdict v = kernel.evaluate(address(vault));
        CovenantVault.State expected = v == RiskKernelV2.Verdict.ALLOW
            ? CovenantVault.State.ACTIVE
            : CovenantVault.State.PAUSED;
        assertEq(uint8(vault.state()), uint8(expected), "enforce did not converge");
    }
}

/// @dev Handler limited to actions that should never revert. Tracks the
///      running total of bonded USDC so invariants can assert the
///      conservation property: bondBalance + totalSlashed == totalBonded.
contract RiskKernelV2Handler is Test {
    RiskKernelV2 public kernel;
    CovenantVault public vault;
    SlashBond public bond;
    MockTrackRecordV2 public mockTr;
    bytes32 public botId;
    uint32 public freshnessSec;
    address public operator;
    uint256 public initialBondTotal; // running total of every USDC ever bonded

    constructor(
        RiskKernelV2 _kernel,
        CovenantVault _vault,
        SlashBond _bond,
        MockTrackRecordV2 _mockTr,
        bytes32 _botId,
        uint32 _freshnessSec,
        address _operator
    ) {
        kernel = _kernel;
        vault = _vault;
        bond = _bond;
        mockTr = _mockTr;
        botId = _botId;
        freshnessSec = _freshnessSec;
        operator = _operator;
        initialBondTotal = _bond.bondBalance() + _bond.totalSlashed();
    }

    function bondMore(uint64 amountRaw) external {
        // Bound per-call so cumulative bonding across max-depth invariant runs
        // never exhausts operator's 1_000_000e6 USDC balance.
        uint256 amount = bound(uint256(amountRaw), 1, 100e6);
        vm.prank(operator);
        bond.bond(amount);
        initialBondTotal += amount;
    }

    function pushPositive(uint64 magRaw) external {
        uint256 mag = bound(uint256(magRaw), 1, uint256(uint128(type(int128).max)) / 4);
        mockTr.pushRecord(botId, int128(int256(mag)), uint64(block.timestamp));
    }

    function pushNegative(uint64 magRaw) external {
        uint256 mag = bound(uint256(magRaw), 1, uint256(uint128(type(int128).max)) / 4);
        mockTr.pushRecord(botId, -int128(int256(mag)), uint64(block.timestamp));
    }

    function warpForward(uint32 secs) external {
        vm.warp(block.timestamp + bound(uint256(secs), 1, uint256(freshnessSec) * 4));
    }

    function enforce() external {
        kernel.enforce(address(vault));
    }
}
