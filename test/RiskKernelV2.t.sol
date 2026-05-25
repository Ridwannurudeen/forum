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

contract RiskKernelV2Test is Test {
    MockUsdc usdc;
    MockTrackRecordV2 mockTr;
    RiskKernelV2 kernel;
    SlashBond bond;
    CovenantVault vault;
    bytes32 constant BOT = keccak256("v2-bot");
    address operator = address(0x0BEC);
    address victim = address(0x51C7);
    address recipient = address(0xBEEF);
    address alice = address(0xA11CE);

    function _newVaultWithBond(uint32 freshnessSec) internal returns (CovenantVault, SlashBond) {
        // SlashBond's attestor MUST be the kernel for auto-slash to work.
        SlashBond sb = new SlashBond(
            IERC20SB(address(usdc)), operator, address(kernel), recipient, BOT, 86400
        );
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator,
            botId: BOT,
            budgetUsdc: 500e6,
            maxDrawdownBps: 500,
            receiptFreshnessSec: freshnessSec,
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(sb),
            riskKernel: address(kernel),
            trackRecordV2: address(mockTr)
        });
        return (new CovenantVault(IERC20(address(usdc)), m), sb);
    }

    function setUp() public {
        usdc = new MockUsdc();
        mockTr = new MockTrackRecordV2();
        kernel = new RiskKernelV2();
        (vault, bond) = _newVaultWithBond(600);
        usdc.mint(alice, 10_000e6);
        usdc.mint(operator, 10_000e6);
        usdc.mint(victim, 10_000e6);
        vm.prank(alice); usdc.approve(address(vault), 1_000e6);
        vm.prank(alice); vault.deposit(1_000e6);
        // Operator bonds 100 USDC so slashing has something to grab.
        vm.prank(operator); usdc.approve(address(bond), 100e6);
        vm.prank(operator); bond.bond(100e6);
    }

    function test_evaluate_allow_when_no_records() public {
        assertEq(uint8(kernel.evaluate(address(vault))), uint8(RiskKernelV2.Verdict.ALLOW));
    }

    function test_enforce_stale_triggers_pause_and_slash() public {
        mockTr.pushRecord(BOT, 1_000_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 700);
        uint256 recipBefore = usdc.balanceOf(recipient);
        uint256 bondBefore = bond.bondBalance();

        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        // 25% of 100 USDC = 25 USDC slashed in same tx
        assertEq(bond.bondBalance(), bondBefore - 25e6);
        assertEq(usdc.balanceOf(recipient) - recipBefore, 25e6);
        assertEq(bond.totalSlashed(), 25e6);
    }

    function test_enforce_does_not_slash_unrelated_bond() public {
        SlashBond victimBond = new SlashBond(
            IERC20SB(address(usdc)), victim, address(kernel), recipient, BOT, 86400
        );
        vm.prank(victim); usdc.approve(address(victimBond), 100e6);
        vm.prank(victim); victimBond.bond(100e6);

        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator, botId: BOT, budgetUsdc: 500e6, maxDrawdownBps: 500,
            receiptFreshnessSec: 600, expiry: 0, perfFeeBps: 2_000,
            bondContract: address(victimBond), riskKernel: address(kernel), trackRecordV2: address(mockTr)
        });
        CovenantVault attackerVault = new CovenantVault(IERC20(address(usdc)), m);

        mockTr.pushRecord(BOT, 1_000_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 700);
        kernel.enforce(address(attackerVault));

        assertEq(uint8(attackerVault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(victimBond.bondBalance(), 100e6);
        assertEq(victimBond.totalSlashed(), 0);
    }

    function test_enforce_drawdown_triggers_pause_and_slash() public {
        mockTr.pushRecord(BOT, 500_000_000, uint64(block.timestamp));
        mockTr.pushRecord(BOT, 1_000_000_000, uint64(block.timestamp));
        mockTr.pushRecord(BOT, 900_000_000, uint64(block.timestamp)); // 10% drawdown > 5% threshold

        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(bond.totalSlashed(), 25e6);
    }

    function test_enforce_first_negative_loss_triggers_pause_and_slash() public {
        // No positive peak yet. A 30 USDC loss is 6% of the 500 USDC budget,
        // so the 5% max drawdown mandate should still pause and slash.
        mockTr.pushRecord(BOT, -30e6, uint64(block.timestamp));

        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(bond.totalSlashed(), 25e6);
    }

    function test_enforce_first_negative_loss_within_budget_allows() public {
        // No positive peak yet. A 10 USDC loss is 2% of the 500 USDC budget.
        mockTr.pushRecord(BOT, -10e6, uint64(block.timestamp));

        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
        assertEq(bond.totalSlashed(), 0);
    }

    function test_enforce_expired_pauses_but_does_not_slash() public {
        // Mandate has expiry=0 by default — build a vault with explicit expiry here.
        SlashBond sb3 = new SlashBond(
            IERC20SB(address(usdc)), operator, address(kernel), recipient, BOT, 86400
        );
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator, botId: BOT, budgetUsdc: 500e6, maxDrawdownBps: 500,
            receiptFreshnessSec: 600, expiry: uint64(block.timestamp + 100),
            perfFeeBps: 2_000, bondContract: address(sb3),
            riskKernel: address(kernel), trackRecordV2: address(mockTr)
        });
        CovenantVault expiringVault = new CovenantVault(IERC20(address(usdc)), m);
        vm.prank(operator); usdc.approve(address(sb3), 100e6);
        vm.prank(operator); sb3.bond(100e6);

        vm.warp(block.timestamp + 200);
        uint256 before_ = sb3.bondBalance();
        kernel.enforce(address(expiringVault));

        assertEq(uint8(expiringVault.state()), uint8(CovenantVault.State.PAUSED));
        // Expiry is timeout, NOT operator fault — bond is NOT slashed
        assertEq(sb3.bondBalance(), before_);
        assertEq(sb3.totalSlashed(), 0);
    }

    function test_enforce_allow_does_not_slash() public {
        mockTr.pushRecord(BOT, 1_000_000, uint64(block.timestamp));
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
        assertEq(bond.totalSlashed(), 0);
    }

    function test_enforce_can_revive_from_paused_without_extra_slash() public {
        mockTr.pushRecord(BOT, 1_000_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 700);
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(bond.totalSlashed(), 25e6);

        // Fresh receipt → ACTIVE again. State transition happens, but reviving is not a slash event.
        mockTr.pushRecord(BOT, 1_100_000, uint64(block.timestamp));
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
        assertEq(bond.totalSlashed(), 25e6); // unchanged
    }

    function test_enforce_repeated_violations_compound_slash() public {
        mockTr.pushRecord(BOT, 1_000_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 700);

        // Violation 1: 100 → 75
        kernel.enforce(address(vault));
        assertEq(bond.bondBalance(), 75e6);

        // Revive
        mockTr.pushRecord(BOT, 1_100_000, uint64(block.timestamp));
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));

        // Violation 2: 75 → 56.25 (= 75 * 0.75)
        vm.warp(block.timestamp + 700);
        kernel.enforce(address(vault));
        assertEq(bond.bondBalance(), 56_250_000);
        assertEq(bond.totalSlashed(), 43_750_000);
    }

    function test_enforce_handles_zero_bond_gracefully() public {
        // Drain bond first
        vm.prank(operator); bond.requestUnbond(100e6);
        vm.warp(block.timestamp + 86401);
        vm.prank(operator); bond.claimUnbond();
        assertEq(bond.bondBalance(), 0);

        mockTr.pushRecord(BOT, 1_000_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 700);
        kernel.enforce(address(vault));
        // Vault still pauses; slash attempt is a no-op
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(bond.totalSlashed(), 0);
    }
}
