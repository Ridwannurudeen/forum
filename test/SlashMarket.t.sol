// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SlashMarket} from "../src/SlashMarket.sol";
import {IERC20} from "../src/CovenantVault.sol";

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}

/// @dev Stand-in for a real SlashBond. We only need the totalSlashed view.
contract MockBond {
    uint256 public totalSlashed;
    function setTotalSlashed(uint256 v) external { totalSlashed = v; }
}

contract SlashMarketTest is Test {
    MockUsdc usdc;
    SlashMarket market;
    MockBond bond;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address creator = address(0xCAFE);
    uint64 constant WINDOW = 1 days;

    function setUp() public {
        usdc = new MockUsdc();
        market = new SlashMarket(IERC20(address(usdc)));
        bond = new MockBond();
        usdc.mint(alice, 1000e6);
        usdc.mint(bob, 1000e6);
    }

    function _create(uint64 windowSec) internal returns (uint256 id) {
        vm.prank(creator);
        id = market.createMarket(address(bond), uint64(block.timestamp + windowSec));
    }

    function _stake(address user, uint256 id, bool yesSide, uint256 amount) internal {
        vm.prank(user); usdc.approve(address(market), amount);
        vm.prank(user); market.stake(id, yesSide, amount);
    }

    // -- Constructor ---------------------------------------------------------

    function test_constructor_zero_usdc_reverts() public {
        vm.expectRevert(SlashMarket.ZeroAddress.selector);
        new SlashMarket(IERC20(address(0)));
    }

    // -- createMarket --------------------------------------------------------

    function test_createMarket_records_snapshot() public {
        bond.setTotalSlashed(123_456);
        uint256 id = _create(WINDOW);
        SlashMarket.Market memory m = market.marketAt(id);
        assertEq(m.bond, address(bond));
        assertEq(m.slashedSnapshot, 123_456);
        assertEq(m.expiryAt, uint64(block.timestamp + WINDOW));
        assertEq(m.yesStake, 0);
        assertEq(m.noStake, 0);
        assertEq(m.settled, false);
    }

    function test_createMarket_past_expiry_reverts() public {
        vm.expectRevert(SlashMarket.InvalidExpiry.selector);
        market.createMarket(address(bond), uint64(block.timestamp));
    }

    function test_createMarket_zero_bond_reverts() public {
        vm.expectRevert(SlashMarket.ZeroAddress.selector);
        market.createMarket(address(0), uint64(block.timestamp + WINDOW));
    }

    // -- stake ---------------------------------------------------------------

    function test_stake_yes_and_no_independently() public {
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6);
        _stake(bob, id, false, 200e6);
        (uint256 ya, uint256 na) = market.stakeOf(id, alice);
        (uint256 yb, uint256 nb) = market.stakeOf(id, bob);
        assertEq(ya, 100e6); assertEq(na, 0);
        assertEq(yb, 0); assertEq(nb, 200e6);
        SlashMarket.Market memory m = market.marketAt(id);
        assertEq(m.yesStake, 100e6);
        assertEq(m.noStake, 200e6);
    }

    function test_stake_after_expiry_reverts() public {
        uint256 id = _create(WINDOW);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(alice); usdc.approve(address(market), 100e6);
        vm.prank(alice);
        vm.expectRevert(SlashMarket.MarketExpired.selector);
        market.stake(id, true, 100e6);
    }

    function test_stake_after_settle_reverts() public {
        uint256 id = _create(WINDOW);
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        vm.prank(alice); usdc.approve(address(market), 100e6);
        vm.prank(alice);
        vm.expectRevert(SlashMarket.MarketSettled.selector);
        market.stake(id, true, 100e6);
    }

    function test_stake_zero_reverts() public {
        uint256 id = _create(WINDOW);
        vm.prank(alice);
        vm.expectRevert(SlashMarket.ZeroAmount.selector);
        market.stake(id, true, 0);
    }

    function test_stake_unknown_market_reverts() public {
        vm.prank(alice); usdc.approve(address(market), 100e6);
        vm.prank(alice);
        vm.expectRevert(SlashMarket.UnknownMarket.selector);
        market.stake(99, true, 100e6);
    }

    // -- settle --------------------------------------------------------------

    function test_settle_before_expiry_reverts() public {
        uint256 id = _create(WINDOW);
        vm.expectRevert(SlashMarket.MarketActive.selector);
        market.settle(id);
    }

    function test_settle_no_slash_did_not_happen() public {
        bond.setTotalSlashed(1000);
        uint256 id = _create(WINDOW);
        // no slash growth
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        SlashMarket.Market memory m = market.marketAt(id);
        assertFalse(m.didSlash);
        assertEq(m.newSlashedAtSettle, 1000);
        assertTrue(m.settled);
    }

    function test_settle_yes_slash_happened() public {
        bond.setTotalSlashed(1000);
        uint256 id = _create(WINDOW);
        bond.setTotalSlashed(1500); // slash happened during window
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        SlashMarket.Market memory m = market.marketAt(id);
        assertTrue(m.didSlash);
        assertEq(m.newSlashedAtSettle, 1500);
    }

    function test_settle_double_reverts() public {
        uint256 id = _create(WINDOW);
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        vm.expectRevert(SlashMarket.MarketSettled.selector);
        market.settle(id);
    }

    // -- claim ---------------------------------------------------------------

    function test_claim_yes_winner_gets_full_payout_when_no_loser_pool() public {
        // Only YES staked; YES wins. Payout = original stake + 0 (no losing pool).
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6);
        bond.setTotalSlashed(1);
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        vm.prank(alice); uint256 p = market.claim(id);
        assertEq(p, 100e6);
        assertEq(usdc.balanceOf(alice), 1000e6); // back to start
    }

    function test_claim_yes_winner_takes_loser_pool_pro_rata() public {
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6); // YES 100
        _stake(bob, id, false, 100e6);   // NO 100
        bond.setTotalSlashed(1);
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);

        vm.prank(alice); uint256 p = market.claim(id);
        // alice owns 100% of YES → gets 100 stake back + 100 losers = 200
        assertEq(p, 200e6);
        assertEq(usdc.balanceOf(alice), 1000e6 + 100e6);
    }

    function test_claim_no_winner_when_no_slash() public {
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6);
        _stake(bob, id, false, 100e6);
        // no slash
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        vm.prank(bob); uint256 p = market.claim(id);
        assertEq(p, 200e6);
        assertEq(usdc.balanceOf(bob), 1000e6 + 100e6);
    }

    function test_claim_loser_gets_zero_then_locked() public {
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6);  // YES
        _stake(bob, id, false, 100e6);    // NO
        bond.setTotalSlashed(1); // YES wins
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        // Bob was on NO, loses
        vm.prank(bob); uint256 p = market.claim(id);
        assertEq(p, 0);
        // Bob can't claim again
        vm.prank(bob);
        vm.expectRevert(SlashMarket.AlreadyClaimed.selector);
        market.claim(id);
    }

    function test_claim_multiple_winners_split_pool_pro_rata() public {
        // alice + bob both YES, alice 60 bob 40 → split loser pool 60/40
        address carol = address(0xCA01);
        usdc.mint(carol, 1000e6);
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 60e6);
        _stake(bob, id, true, 40e6);
        _stake(carol, id, false, 100e6);
        bond.setTotalSlashed(1);
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);

        vm.prank(alice); uint256 pa = market.claim(id);
        vm.prank(bob);   uint256 pb = market.claim(id);
        // alice owns 60/100 of YES → 60 stake + 60% of 100 loser = 60 + 60 = 120
        // bob   owns 40/100 of YES → 40 stake + 40% of 100 loser = 40 + 40 = 80
        assertEq(pa, 120e6);
        assertEq(pb, 80e6);
    }

    function test_claim_before_settle_reverts() public {
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6);
        vm.prank(alice);
        vm.expectRevert(SlashMarket.MarketActive.selector);
        market.claim(id);
    }

    function test_claim_double_reverts() public {
        uint256 id = _create(WINDOW);
        _stake(alice, id, true, 100e6);
        bond.setTotalSlashed(1);
        vm.warp(block.timestamp + WINDOW + 1);
        market.settle(id);
        vm.prank(alice); market.claim(id);
        vm.prank(alice);
        vm.expectRevert(SlashMarket.AlreadyClaimed.selector);
        market.claim(id);
    }
}
