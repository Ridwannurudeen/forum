// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BuilderCodeRegistry} from "../src/BuilderCodeRegistry.sol";
import {FeeDistributor, IERC20} from "../src/FeeDistributor.sol";

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FeeDistributorTest is Test {
    BuilderCodeRegistry reg;
    MockUsdc usdc;
    FeeDistributor dist;
    bytes32 constant CODE = keccak256("code");
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA801);

    function setUp() public {
        reg = new BuilderCodeRegistry();
        usdc = new MockUsdc();
        dist = new FeeDistributor(reg, IERC20(address(usdc)));
        vm.prank(alice);
        reg.claim(CODE);
    }

    function _setAttr2() internal {
        address[] memory recipients = new address[](2);
        uint16[] memory bps = new uint16[](2);
        recipients[0] = bob;
        recipients[1] = carol;
        bps[0] = 7_000;
        bps[1] = 3_000;
        vm.prank(alice);
        dist.setAttribution(CODE, recipients, bps);
    }

    function test_setAttribution_and_distribute() public {
        _setAttr2();
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(dist), 1_000e6);
        vm.prank(alice);
        dist.distribute(CODE, 1_000e6);

        assertEq(dist.claimable(bob), 700e6);
        assertEq(dist.claimable(carol), 300e6);
    }

    function test_claim() public {
        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = bob;
        bps[0] = 10_000;
        vm.prank(alice);
        dist.setAttribution(CODE, recipients, bps);

        usdc.mint(alice, 500e6);
        vm.prank(alice);
        usdc.approve(address(dist), 500e6);
        vm.prank(alice);
        dist.distribute(CODE, 500e6);

        vm.prank(bob);
        dist.claim();
        assertEq(usdc.balanceOf(bob), 500e6);
        assertEq(dist.claimable(bob), 0);
    }

    function test_setAttribution_reverts_if_not_owner() public {
        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = bob;
        bps[0] = 10_000;
        vm.prank(bob);
        vm.expectRevert(FeeDistributor.NotCodeOwner.selector);
        dist.setAttribution(CODE, recipients, bps);
    }

    function test_setAttribution_reverts_bps_mismatch() public {
        address[] memory recipients = new address[](2);
        uint16[] memory bps = new uint16[](2);
        recipients[0] = bob;
        recipients[1] = carol;
        bps[0] = 5_000;
        bps[1] = 5_001;
        vm.prank(alice);
        vm.expectRevert(FeeDistributor.BpsMismatch.selector);
        dist.setAttribution(CODE, recipients, bps);
    }

    function test_setAttribution_reverts_length_mismatch() public {
        address[] memory recipients = new address[](2);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = bob;
        recipients[1] = carol;
        bps[0] = 10_000;
        vm.prank(alice);
        vm.expectRevert(FeeDistributor.LengthMismatch.selector);
        dist.setAttribution(CODE, recipients, bps);
    }

    function test_distribute_reverts_without_attribution() public {
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.approve(address(dist), 100e6);
        vm.prank(alice);
        vm.expectRevert(FeeDistributor.NoAttribution.selector);
        dist.distribute(CODE, 100e6);
    }

    function test_claim_reverts_when_zero() public {
        vm.prank(bob);
        vm.expectRevert(FeeDistributor.NothingToClaim.selector);
        dist.claim();
    }
}
