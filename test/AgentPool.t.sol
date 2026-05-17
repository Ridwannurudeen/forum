// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AgentPool, IERC20} from "../src/AgentPool.sol";

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

contract AgentPoolTest is Test {
    MockUsdc usdc;
    AgentPool pool;
    bytes32 constant BOT = keccak256("agent-pool-test");
    address operator = address(0x0BEC);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        usdc = new MockUsdc();
        pool = new AgentPool(IERC20(address(usdc)), operator, BOT);
        usdc.mint(alice, 1_000e6);
        usdc.mint(bob, 1_000e6);
        usdc.mint(operator, 10_000e6);
    }

    function _deposit(address user, uint256 amount) internal returns (uint256) {
        vm.prank(user); usdc.approve(address(pool), amount);
        vm.prank(user); return pool.deposit(amount);
    }

    function test_first_deposit_mints_1to1() public {
        uint256 shares = _deposit(alice, 100e6);
        assertEq(shares, 100e6);
        assertEq(pool.totalShares(), 100e6);
        assertEq(pool.depositTotalIdle(), 100e6);
    }

    function test_second_deposit_mints_proportional() public {
        _deposit(alice, 100e6);
        uint256 bobShares = _deposit(bob, 50e6);
        assertEq(bobShares, 50e6); // no price change yet
        assertEq(pool.totalShares(), 150e6);
    }

    function test_withdraw_returns_prorata() public {
        _deposit(alice, 100e6);
        _deposit(bob, 100e6);
        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 out = pool.withdraw(100e6); // alice's full share
        assertEq(out, 100e6);
        assertEq(usdc.balanceOf(alice), aliceBalBefore + 100e6);
        assertEq(pool.totalShares(), 100e6);
    }

    function test_operator_withdraw_then_return_profit() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); pool.operatorWithdraw(500e6);
        assertEq(pool.operatorOutstanding(), 500e6);
        assertEq(pool.depositTotalIdle(), 500e6);

        // Operator earns 50 USDC profit on the 500 — returns 550
        vm.prank(operator); usdc.approve(address(pool), 550e6);
        vm.prank(operator); pool.operatorReturn(550e6);
        assertEq(pool.operatorOutstanding(), 0);
        assertEq(pool.depositTotalIdle(), 1_050e6);
        // per-share price rose: 1_050 / 1_000 = 1.05
        assertEq(pool.perSharePrice(), 1.05e18);
    }

    function test_crystallise_takes_20pct_above_hwm() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); pool.operatorWithdraw(1_000e6);
        // operator returns 1200 (20% profit)
        vm.prank(operator); usdc.approve(address(pool), 1_200e6);
        vm.prank(operator); pool.operatorReturn(1_200e6);
        assertEq(pool.perSharePrice(), 1.2e18);

        // crystallise: 20% of 200 USDC profit = 40 USDC fee → operator
        pool.crystalliseFee();
        assertEq(pool.operatorClaimable(), 40e6);
        // idle drops by 40
        assertEq(pool.depositTotalIdle(), 1_160e6);
        // hwm rises to new per-share price (1.16)
        assertEq(pool.highWaterMark(), 1.16e18);
    }

    function test_no_fee_below_hwm() public {
        _deposit(alice, 1_000e6);
        // No operator activity — px stays at 1.0, hwm at 1.0
        pool.crystalliseFee();
        assertEq(pool.operatorClaimable(), 0);
    }

    function test_operator_claim_pulls_accrued_fees() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator); pool.operatorWithdraw(1_000e6);
        vm.prank(operator); usdc.approve(address(pool), 1_200e6);
        vm.prank(operator); pool.operatorReturn(1_200e6);
        pool.crystalliseFee();
        uint256 before = usdc.balanceOf(operator);
        vm.prank(operator); pool.operatorClaim();
        assertEq(usdc.balanceOf(operator) - before, 40e6);
        assertEq(pool.operatorClaimable(), 0);
    }

    function test_nonoperator_cannot_withdraw_capital() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(AgentPool.NotOperator.selector);
        pool.operatorWithdraw(50e6);
    }
}
