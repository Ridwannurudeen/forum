// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SlashBond, IERC20} from "../src/SlashBond.sol";

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

contract SlashBondTest is Test {
    MockUsdc usdc;
    SlashBond bond;
    address operator = address(0x0BEC);
    address attestor = address(0xCAFE);
    address recipient = address(0xBEEF);
    address randomUser = address(0xDEAD);
    bytes32 constant BOT = keccak256("slash-bond-test");
    uint64 constant UNBOND_DELAY = 86400; // 1 day

    function setUp() public {
        usdc = new MockUsdc();
        bond = new SlashBond(
            IERC20(address(usdc)), operator, attestor, recipient, BOT, UNBOND_DELAY
        );
        usdc.mint(operator, 10_000e6);
    }

    function _bond(uint256 amount) internal {
        vm.prank(operator); usdc.approve(address(bond), amount);
        vm.prank(operator); bond.bond(amount);
    }

    function test_bond_increases_balance() public {
        _bond(500e6);
        assertEq(bond.bondBalance(), 500e6);
        assertEq(usdc.balanceOf(address(bond)), 500e6);
    }

    function test_bond_only_operator() public {
        vm.prank(randomUser); usdc.approve(address(bond), 100e6);
        vm.prank(randomUser);
        vm.expectRevert(SlashBond.NotOperator.selector);
        bond.bond(100e6);
    }

    function test_bond_zero_amount_reverts() public {
        vm.prank(operator);
        vm.expectRevert(SlashBond.ZeroAmount.selector);
        bond.bond(0);
    }

    function test_requestUnbond_starts_cooldown() public {
        _bond(500e6);
        vm.prank(operator); bond.requestUnbond(300e6);
        assertEq(bond.unbondAmount(), 300e6);
        assertEq(bond.unbondRequestedAt(), uint64(block.timestamp));
    }

    function test_requestUnbond_above_balance_reverts() public {
        _bond(500e6);
        vm.prank(operator);
        vm.expectRevert(SlashBond.InsufficientBond.selector);
        bond.requestUnbond(501e6);
    }

    function test_requestUnbond_while_pending_reverts() public {
        _bond(500e6);
        vm.prank(operator); bond.requestUnbond(100e6);
        vm.prank(operator);
        vm.expectRevert(SlashBond.UnbondInFlight.selector);
        bond.requestUnbond(50e6);
    }

    function test_cancelUnbond_clears_state() public {
        _bond(500e6);
        vm.prank(operator); bond.requestUnbond(200e6);
        vm.prank(operator); bond.cancelUnbond();
        assertEq(bond.unbondAmount(), 0);
        assertEq(bond.unbondRequestedAt(), 0);
    }

    function test_claimUnbond_before_cooldown_reverts() public {
        _bond(500e6);
        vm.prank(operator); bond.requestUnbond(200e6);
        vm.prank(operator);
        vm.expectRevert(SlashBond.CooldownActive.selector);
        bond.claimUnbond();
    }

    function test_claimUnbond_after_cooldown_returns_funds() public {
        _bond(500e6);
        vm.prank(operator); bond.requestUnbond(200e6);
        vm.warp(block.timestamp + UNBOND_DELAY + 1);
        uint256 before_ = usdc.balanceOf(operator);
        vm.prank(operator); bond.claimUnbond();
        assertEq(usdc.balanceOf(operator) - before_, 200e6);
        assertEq(bond.bondBalance(), 300e6);
        assertEq(bond.unbondAmount(), 0);
    }

    function test_slash_only_attestor() public {
        _bond(500e6);
        vm.prank(operator);
        vm.expectRevert(SlashBond.NotAttestor.selector);
        bond.slash(100e6, bytes32("test"));
    }

    function test_slash_transfers_to_recipient() public {
        _bond(500e6);
        uint256 before_ = usdc.balanceOf(recipient);
        vm.prank(attestor); bond.slash(100e6, bytes32("test-violation"));
        assertEq(usdc.balanceOf(recipient) - before_, 100e6);
        assertEq(bond.bondBalance(), 400e6);
        assertEq(bond.totalSlashed(), 100e6);
    }

    function test_slash_caps_at_balance() public {
        _bond(500e6);
        vm.prank(attestor); bond.slash(1_000e6, bytes32("over-slash")); // > bond
        assertEq(bond.bondBalance(), 0);
        assertEq(bond.totalSlashed(), 500e6);
        assertEq(usdc.balanceOf(recipient), 500e6);
    }

    function test_slash_during_unbond_cooldown_reduces_claimable() public {
        _bond(500e6);
        vm.prank(operator); bond.requestUnbond(400e6);
        vm.prank(attestor); bond.slash(200e6, bytes32("slash-during-unbond"));
        // bondBalance: 300, unbondAmount still 400 (claimUnbond will clamp)
        vm.warp(block.timestamp + UNBOND_DELAY + 1);
        uint256 before_ = usdc.balanceOf(operator);
        vm.prank(operator); bond.claimUnbond();
        // Operator only gets what's left in the bond (300), not the requested 400
        assertEq(usdc.balanceOf(operator) - before_, 300e6);
        assertEq(bond.bondBalance(), 0);
    }
}
