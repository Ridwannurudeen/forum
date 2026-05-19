// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RiskKernel, ITrackRecordV2} from "../src/RiskKernel.sol";
import {CovenantVault, IERC20} from "../src/CovenantVault.sol";

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

    function recordCount(bytes32 botId) external view returns (uint256) {
        return _records[botId].length;
    }
    function recordAt(bytes32 botId, uint256 idx) external view returns (ITrackRecordV2.StoredRecord memory) {
        return _records[botId][idx];
    }
}

contract RiskKernelFuzzTest is Test {
    MockUsdc usdc;
    MockTrackRecordV2 mockTr;
    RiskKernel kernel;
    CovenantVault vault;
    bytes32 constant BOT = keccak256("fuzz-risk-bot");
    address operator = address(0x0BEC);
    address alice = address(0xA11CE);

    uint128 constant BUDGET = 500e6;
    uint16 constant MAX_DD_BPS = 500; // 5%
    uint32 constant FRESHNESS_SEC = 600;

    function _newVault() internal returns (CovenantVault) {
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator,
            botId: BOT,
            budgetUsdc: BUDGET,
            maxDrawdownBps: MAX_DD_BPS,
            receiptFreshnessSec: FRESHNESS_SEC,
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(0xBEEF),
            riskKernel: address(kernel),
            trackRecordV2: address(mockTr)
        });
        return new CovenantVault(IERC20(address(usdc)), m);
    }

    RiskKernelHandler internal handler;

    function setUp() public {
        usdc = new MockUsdc();
        mockTr = new MockTrackRecordV2();
        kernel = new RiskKernel();
        vault = _newVault();
        usdc.mint(alice, 10_000e6);
        vm.prank(alice); usdc.approve(address(vault), 1_000e6);
        vm.prank(alice); vault.deposit(1_000e6);

        handler = new RiskKernelHandler(kernel, vault, mockTr, BOT);
        targetContract(address(handler));
    }

    // ---------- fuzz: first-negative PnL beyond budget threshold => PAUSE ----------

    /// @notice Codex fix coverage: with no positive peak yet, any first-period
    ///         negative pnlMicros whose magnitude crosses
    ///         budget * maxDrawdownBps / 10_000 must produce PAUSE_DRAWDOWN
    ///         and `enforce` must flip vault state to PAUSED.
    function testFuzz_first_negative_pnl_beyond_budget_pauses(uint128 lossMagRaw) public {
        // Threshold loss in pnlMicros = budget * maxDrawdownBps / 10_000
        // = 500e6 * 500 / 10_000 = 25e6.
        uint256 thresholdMicros = (uint256(BUDGET) * MAX_DD_BPS) / 10_000;
        // Loss must be >= threshold AND fit in int128 positive range.
        uint256 lossMag = bound(uint256(lossMagRaw), thresholdMicros, uint256(uint128(type(int128).max)));
        int128 pnl = -int128(int256(lossMag));

        mockTr.pushRecord(BOT, pnl, uint64(block.timestamp));

        assertEq(
            uint8(kernel.evaluate(address(vault))),
            uint8(RiskKernel.Verdict.PAUSE_DRAWDOWN),
            "expected PAUSE_DRAWDOWN for first-negative beyond budget"
        );

        // Sanity: enforce flips the vault to PAUSED.
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
    }

    /// @notice Companion property: when the first-period loss is STRICTLY
    ///         within budget threshold, the kernel must ALLOW. This guards
    ///         against the Codex fix being too aggressive.
    function testFuzz_first_negative_pnl_within_budget_allows(uint128 lossMagRaw) public {
        uint256 thresholdMicros = (uint256(BUDGET) * MAX_DD_BPS) / 10_000;
        // Loss strictly less than threshold (>= triggers pause).
        vm.assume(thresholdMicros > 0);
        uint256 lossMag = bound(uint256(lossMagRaw), 1, thresholdMicros - 1);
        int128 pnl = -int128(int256(lossMag));

        mockTr.pushRecord(BOT, pnl, uint64(block.timestamp));

        assertEq(
            uint8(kernel.evaluate(address(vault))),
            uint8(RiskKernel.Verdict.ALLOW),
            "expected ALLOW for first-negative within budget"
        );
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
    }

    // ---------- fuzz: post-peak drawdown still pauses ----------

    /// @notice Regression check on the Codex fix: a positive peak followed by
    ///         any drop greater-or-equal than maxDrawdownBps must pause.
    function testFuzz_post_peak_drawdown_pauses(uint128 peakRaw, uint16 dropBpsRaw) public {
        // Peak: 1..(int128 max / 2) for safe int math.
        uint128 peak = uint128(bound(uint256(peakRaw), 1, uint256(uint128(type(int128).max)) / 2));
        // Drop bps: anywhere from MAX_DD_BPS (=500) up to 10_000.
        uint256 dropBps = bound(uint256(dropBpsRaw), MAX_DD_BPS, 10_000);
        // Current = peak - peak * dropBps / 10_000
        uint256 dropMicros = (uint256(peak) * dropBps) / 10_000;
        // Make sure current is representable as int128 (it always is since 0 <= drop <= peak).
        int128 cur = int128(int256(uint256(peak) - dropMicros));

        mockTr.pushRecord(BOT, int128(int256(uint256(peak))), uint64(block.timestamp));
        mockTr.pushRecord(BOT, cur, uint64(block.timestamp));

        // Note: with integer truncation, (peak * dropBps) / 10_000 can yield a slightly smaller
        // drop than dropBps; recompute the bps the kernel will see and only assert PAUSE when
        // recomputed bps >= MAX_DD_BPS. Otherwise (truncation case) assert ALLOW.
        if (peak == 0 || cur >= int128(int256(uint256(peak)))) {
            // degenerate — skip
            return;
        }
        uint256 actualDdBps = (uint256(peak) - uint256(int256(cur))) * 10_000 / uint256(peak);
        if (actualDdBps >= MAX_DD_BPS) {
            assertEq(
                uint8(kernel.evaluate(address(vault))),
                uint8(RiskKernel.Verdict.PAUSE_DRAWDOWN),
                "expected PAUSE_DRAWDOWN after peak drop >= maxDdBps"
            );
        } else {
            assertEq(
                uint8(kernel.evaluate(address(vault))),
                uint8(RiskKernel.Verdict.ALLOW),
                "expected ALLOW after sub-threshold peak drop"
            );
        }
    }

    // ---------- fuzz: enforce idempotence ----------

    /// @notice Calling `enforce` repeatedly on the same vault must converge to
    ///         the expected state and never revert, regardless of the verdict.
    ///         RiskKernel v1 has no slash side-effect, so repeated enforce is
    ///         a pure setState idempotence check.
    function testFuzz_enforce_idempotent_under_pause(uint8 callsRaw, uint128 lossSeed) public {
        // Force a pause condition: loss >= threshold.
        uint256 thresholdMicros = (uint256(BUDGET) * MAX_DD_BPS) / 10_000;
        // Build a negative pnl whose magnitude is in [threshold, threshold + 1_000_000].
        uint256 mag = thresholdMicros + (uint256(lossSeed) % 1_000_000);
        int128 pnl = -int128(int256(mag));
        mockTr.pushRecord(BOT, pnl, uint64(block.timestamp));

        uint256 n = bound(uint256(callsRaw), 1, 16);
        for (uint256 i = 0; i < n; ++i) {
            kernel.enforce(address(vault));
            assertEq(
                uint8(vault.state()),
                uint8(CovenantVault.State.PAUSED),
                "vault must stay PAUSED across repeated enforce calls"
            );
        }
    }

    /// @notice After a vault has been paused and revived, repeated enforce
    ///         calls on the ACTIVE side are also idempotent.
    function testFuzz_enforce_idempotent_under_allow(uint8 callsRaw) public {
        // No records at all => ALLOW.
        uint256 n = bound(uint256(callsRaw), 1, 16);
        for (uint256 i = 0; i < n; ++i) {
            kernel.enforce(address(vault));
            assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE), "vault must stay ACTIVE");
        }
    }

    // ---------- invariants ----------

    /// @notice After any sequence of handler actions, `enforce` always
    ///         converges in a single call: vault.state matches what
    ///         kernel.evaluate currently expects.
    function invariant_enforce_converges_in_one_call() public {
        kernel.enforce(address(vault));
        RiskKernel.Verdict v = kernel.evaluate(address(vault));
        CovenantVault.State expected = v == RiskKernel.Verdict.ALLOW
            ? CovenantVault.State.ACTIVE
            : CovenantVault.State.PAUSED;
        assertEq(uint8(vault.state()), uint8(expected), "enforce did not converge");
    }

    /// @notice The kernel never returns an out-of-range verdict.
    function invariant_evaluate_returns_known_verdict() public view {
        uint8 v = uint8(kernel.evaluate(address(vault)));
        assertLe(v, uint8(RiskKernel.Verdict.PAUSE_EXPIRED));
    }
}

/// @dev Handler exposes a tiny surface of state-mutating actions that the
///      Foundry invariant runner can call randomly: push records of varying
///      sign and freshness, then call enforce. No reverts allowed.
contract RiskKernelHandler is Test {
    RiskKernel public kernel;
    CovenantVault public vault;
    MockTrackRecordV2 public mockTr;
    bytes32 public botId;

    constructor(RiskKernel _kernel, CovenantVault _vault, MockTrackRecordV2 _mockTr, bytes32 _botId) {
        kernel = _kernel;
        vault = _vault;
        mockTr = _mockTr;
        botId = _botId;
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
        vm.warp(block.timestamp + bound(uint256(secs), 1, 2_000));
    }

    function enforce() external {
        kernel.enforce(address(vault));
    }
}
