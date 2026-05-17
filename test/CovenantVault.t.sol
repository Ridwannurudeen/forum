// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
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

contract CovenantVaultTest is Test {
    MockUsdc usdc;
    CovenantVault vault;
    address operator = address(0x0BEC);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address riskKernel = address(0xCAFE);

    function setUp() public {
        usdc = new MockUsdc();
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator,
            botId: keccak256("agent-1"),
            budgetUsdc: 500e6,
            maxDrawdownBps: 500,        // 5%
            receiptFreshnessSec: 600,   // 10 min
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(0xBEEF),
            riskKernel: riskKernel,
            trackRecordV2: address(0x7AC2) // dummy; not exercised in this suite
        });
        vault = new CovenantVault(IERC20(address(usdc)), m);
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
        usdc.mint(operator, 10_000e6);
    }

    function _deposit(address u, uint256 a) internal returns (uint256) {
        vm.prank(u); usdc.approve(address(vault), a);
        vm.prank(u); return vault.deposit(a);
    }

    function test_first_deposit_mints_1to1() public {
        uint256 s = _deposit(alice, 100e6);
        assertEq(s, 100e6);
        assertEq(vault.totalShares(), 100e6);
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
    }

    function test_pullCredit_within_budget() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator);
        vault.pullCredit(400e6); // < 500e6 budget
        assertEq(vault.operatorOutstanding(), 400e6);
        assertEq(vault.depositTotalIdle(), 600e6);
        assertEq(usdc.balanceOf(operator), 10_000e6 + 400e6);
    }

    function test_pullCredit_at_budget_then_blocked() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); vault.pullCredit(500e6); // == budget
        assertEq(vault.availableCredit(), 0);
        vm.prank(operator);
        vm.expectRevert(CovenantVault.BudgetExceeded.selector);
        vault.pullCredit(1);
    }

    function test_pullCredit_above_budget_reverts() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator);
        vm.expectRevert(CovenantVault.BudgetExceeded.selector);
        vault.pullCredit(501e6);
    }

    function test_pullCredit_blocked_when_paused() public {
        _deposit(alice, 1_000e6);
        vm.prank(riskKernel);
        vault.setState(CovenantVault.State.PAUSED, bytes32("test-pause"));
        vm.prank(operator);
        vm.expectRevert(CovenantVault.MandateNotActive.selector);
        vault.pullCredit(100e6);
    }

    function test_returnCapital_works_when_paused() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); vault.pullCredit(400e6);
        vm.prank(riskKernel);
        vault.setState(CovenantVault.State.PAUSED, bytes32("test-pause"));
        // Operator must still be able to return capital even when paused
        vm.prank(operator); usdc.approve(address(vault), 400e6);
        vm.prank(operator); vault.returnCapital(400e6);
        assertEq(vault.operatorOutstanding(), 0);
    }

    function test_withdraw_works_when_paused() public {
        _deposit(alice, 500e6);
        vm.prank(riskKernel);
        vault.setState(CovenantVault.State.PAUSED, bytes32("test-pause"));
        // Depositor must always be able to exit
        uint256 before_ = usdc.balanceOf(alice);
        vm.prank(alice); vault.withdraw(500e6);
        assertEq(usdc.balanceOf(alice), before_ + 500e6);
    }

    function test_returnCapital_with_profit_raises_pershare_price() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); vault.pullCredit(500e6);
        vm.prank(operator); usdc.approve(address(vault), 550e6);
        vm.prank(operator); vault.returnCapital(550e6);
        // Per-share rose 1.0 → 1.05
        assertEq(vault.perSharePrice(), 1.05e18);
    }

    function test_crystalliseFee_takes_20pct_above_hwm() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); vault.pullCredit(500e6);
        vm.prank(operator); usdc.approve(address(vault), 700e6);
        vm.prank(operator); vault.returnCapital(700e6); // +200 profit on 500
        vault.crystalliseFee();
        // perf fee = 20% × (perShare - 1.0) × totalShares = 0.20 × 0.20 × 1000 = 40 USDC
        assertEq(vault.operatorClaimable(), 40e6);
    }

    function test_setState_only_riskKernel() public {
        vm.prank(alice);
        vm.expectRevert(CovenantVault.NotRiskKernel.selector);
        vault.setState(CovenantVault.State.PAUSED, bytes32("nope"));
    }

    function test_expired_blocks_pullCredit() public {
        // Re-deploy with expiry in the past
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator, botId: keccak256("x"), budgetUsdc: 500e6,
            maxDrawdownBps: 500, receiptFreshnessSec: 600, expiry: uint64(block.timestamp + 100),
            perfFeeBps: 2_000, bondContract: address(0xBEEF),
            riskKernel: riskKernel, trackRecordV2: address(0x7AC2)
        });
        CovenantVault v = new CovenantVault(IERC20(address(usdc)), m);
        vm.prank(alice); usdc.approve(address(v), 100e6);
        vm.prank(alice); v.deposit(100e6);
        vm.warp(block.timestamp + 200); // past expiry
        vm.prank(operator);
        vm.expectRevert(CovenantVault.MandateExpired.selector);
        v.pullCredit(50e6);
    }

    function test_constructor_rejects_bad_inputs() public {
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: address(0), botId: bytes32(0), budgetUsdc: 1e6,
            maxDrawdownBps: 500, receiptFreshnessSec: 600, expiry: 0,
            perfFeeBps: 2_000, bondContract: address(0), riskKernel: address(0x1),
            trackRecordV2: address(0)
        });
        vm.expectRevert(); new CovenantVault(IERC20(address(usdc)), m);

        m.operator = operator;
        m.riskKernel = address(0);
        vm.expectRevert(); new CovenantVault(IERC20(address(usdc)), m);

        m.riskKernel = riskKernel;
        m.budgetUsdc = 0;
        vm.expectRevert(); new CovenantVault(IERC20(address(usdc)), m);

        m.budgetUsdc = 100e6;
        m.perfFeeBps = 6_000; // > 50%
        vm.expectRevert(); new CovenantVault(IERC20(address(usdc)), m);
    }
}
