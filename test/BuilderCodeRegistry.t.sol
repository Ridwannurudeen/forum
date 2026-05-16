// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BuilderCodeRegistry} from "../src/BuilderCodeRegistry.sol";

contract BuilderCodeRegistryTest is Test {
    BuilderCodeRegistry reg;
    bytes32 constant CODE = keccak256("forum-test-code");
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        reg = new BuilderCodeRegistry();
    }

    function test_claim() public {
        vm.prank(alice);
        reg.claim(CODE);
        assertEq(reg.ownerOf(CODE), alice);
    }

    function test_claim_reverts_when_taken() public {
        vm.prank(alice);
        reg.claim(CODE);
        vm.prank(bob);
        vm.expectRevert(BuilderCodeRegistry.AlreadyClaimed.selector);
        reg.claim(CODE);
    }

    function test_transfer() public {
        vm.prank(alice);
        reg.claim(CODE);
        vm.prank(alice);
        reg.transfer(CODE, bob);
        assertEq(reg.ownerOf(CODE), bob);
    }

    function test_transfer_reverts_if_not_owner() public {
        vm.prank(alice);
        reg.claim(CODE);
        vm.prank(bob);
        vm.expectRevert(BuilderCodeRegistry.NotOwner.selector);
        reg.transfer(CODE, bob);
    }

    function test_transfer_to_zero_reverts() public {
        vm.prank(alice);
        reg.claim(CODE);
        vm.prank(alice);
        vm.expectRevert(BuilderCodeRegistry.ZeroAddress.selector);
        reg.transfer(CODE, address(0));
    }

    function test_revoke_frees_code() public {
        vm.prank(alice);
        reg.claim(CODE);
        vm.prank(alice);
        reg.revoke(CODE);
        assertEq(reg.ownerOf(CODE), address(0));
        vm.prank(bob);
        reg.claim(CODE);
        assertEq(reg.ownerOf(CODE), bob);
    }

    function test_setMetadata() public {
        vm.prank(alice);
        reg.claim(CODE);
        vm.prank(alice);
        reg.setMetadata(CODE, "ipfs://abc");
        assertEq(reg.metadataUri(CODE), "ipfs://abc");
    }
}
