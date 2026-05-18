// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SlashInsurance, ISlashBond} from "../src/SlashInsurance.sol";
import {IERC20} from "../src/CovenantVault.sol";

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}

contract MockBond {
    uint256 public totalSlashed;
    uint256 public bondBalance;
    function setTotalSlashed(uint256 v) external { totalSlashed = v; }
    function setBondBalance(uint256 v) external { bondBalance = v; }
}

contract SlashInsuranceTest is Test {
    MockUsdc usdc;
    MockBond bond;
    SlashInsurance ins;
    address recipient = address(0xBEEF);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        usdc = new MockUsdc();
        bond = new MockBond();
        bond.setTotalSlashed(100);
        ins = new SlashInsurance(IERC20(address(usdc)), ISlashBond(address(bond)), recipient);
        usdc.mint(alice, 1000e6);
        usdc.mint(bob, 1000e6);
    }

    function _pay(address from, uint256 amount) internal {
        vm.prank(from); usdc.approve(address(ins), amount);
        vm.prank(from); ins.payPremium(amount);
    }

    function test_constructor_snapshots_initial_slashed() public {
        assertEq(ins.lastSlashedSnapshot(), 100);
    }

    function test_constructor_zero_addrs_revert() public {
        vm.expectRevert(SlashInsurance.ZeroAddress.selector);
        new SlashInsurance(IERC20(address(0)), ISlashBond(address(bond)), recipient);
        vm.expectRevert(SlashInsurance.ZeroAddress.selector);
        new SlashInsurance(IERC20(address(usdc)), ISlashBond(address(0)), recipient);
        vm.expectRevert(SlashInsurance.ZeroAddress.selector);
        new SlashInsurance(IERC20(address(usdc)), ISlashBond(address(bond)), address(0));
    }

    function test_payPremium_records_contribution() public {
        _pay(alice, 100e6);
        assertEq(ins.contribOf(alice), 100e6);
        assertEq(ins.totalPremium(), 100e6);
        assertEq(ins.poolBalance(), 100e6);
    }

    function test_payPremium_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SlashInsurance.ZeroAmount.selector);
        ins.payPremium(0);
    }

    function test_two_funders_pro_rata() public {
        _pay(alice, 100e6);
        _pay(bob, 300e6);
        assertEq(ins.totalPremium(), 400e6);
        assertEq(ins.contribOf(alice), 100e6);
        assertEq(ins.contribOf(bob), 300e6);
    }

    function test_notifySlash_no_growth_pays_zero() public {
        _pay(alice, 100e6);
        // bond.totalSlashed unchanged
        uint256 paid = ins.notifySlash();
        assertEq(paid, 0);
        assertEq(ins.totalPaidOut(), 0);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_notifySlash_pays_delta_to_recipient() public {
        _pay(alice, 100e6);
        bond.setTotalSlashed(150); // delta = 50 (in arbitrary units; treat as USDC micros)
        uint256 paid = ins.notifySlash();
        assertEq(paid, 50);
        assertEq(usdc.balanceOf(recipient), 50);
        assertEq(ins.poolBalance(), 100e6 - 50);
        assertEq(ins.lastSlashedSnapshot(), 150);
        assertEq(ins.totalPaidOut(), 50);
    }

    function test_notifySlash_caps_at_pool_balance() public {
        _pay(alice, 100); // tiny pool: 100 micros
        bond.setTotalSlashed(100 + 500); // delta 500 > pool 100
        uint256 paid = ins.notifySlash();
        assertEq(paid, 100); // capped
        assertEq(ins.poolBalance(), 0);
        assertEq(ins.lastSlashedSnapshot(), 600);
    }

    function test_notifySlash_advances_snapshot_even_when_pool_empty() public {
        // No premium paid; bond gets slashed; notify advances snapshot
        bond.setTotalSlashed(200);
        uint256 paid = ins.notifySlash();
        assertEq(paid, 0);
        assertEq(ins.lastSlashedSnapshot(), 200);
    }

    function test_withdrawPremium_pro_rata_post_payout() public {
        _pay(alice, 100e6);
        _pay(bob, 100e6); // 200 total pool

        bond.setTotalSlashed(100 + 100e6); // delta exactly 100 USDC
        ins.notifySlash();
        // pool was 200, paid out 100, pool now 100. totalPremium still 200.

        // Alice withdraws her 100 contribution → gets pool * share/totalPremium = 100 * 100/200 = 50
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice); ins.withdrawPremium(100e6);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 50e6);
        assertEq(ins.contribOf(alice), 0);
        assertEq(ins.totalPremium(), 100e6);
    }

    function test_withdrawPremium_above_share_reverts() public {
        _pay(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(SlashInsurance.InsufficientShare.selector);
        ins.withdrawPremium(200e6);
    }

    function test_withdrawPremium_zero_reverts() public {
        _pay(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(SlashInsurance.ZeroAmount.selector);
        ins.withdrawPremium(0);
    }

    function test_full_lifecycle_two_funders_partial_slash() public {
        _pay(alice, 200e6);
        _pay(bob, 600e6); // 800 total pool

        bond.setTotalSlashed(100 + 100e6); // 100 USDC slash
        uint256 paid = ins.notifySlash();
        assertEq(paid, 100e6);
        assertEq(ins.poolBalance(), 700e6);

        // Bob withdraws 300 of his 600 share → 300 * 700/800 = 262.5 -> integer 262_500_000
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob); ins.withdrawPremium(300e6);
        assertEq(usdc.balanceOf(bob) - bobBefore, 262_500_000);
        assertEq(ins.contribOf(bob), 300e6);

        // Alice withdraws all 200 → 200 * (700-262.5)/(800-300) = 200 * 437.5/500 = 175
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice); ins.withdrawPremium(200e6);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 175e6);
    }
}
