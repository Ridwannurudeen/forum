// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {KeeperConfig} from "../src/KeeperConfig.sol";

contract KeeperConfigTest is Test {
    KeeperConfig cfg;
    bytes32 constant BOT = keccak256("test-bot");
    address operator = address(0x0BEC);

    function setUp() public {
        cfg = new KeeperConfig();
    }

    function test_setAndGet() public {
        vm.prank(operator);
        cfg.setConfig(BOT, hex"deadbeef");
        KeeperConfig.Snapshot memory s = cfg.getConfig(operator, BOT);
        assertEq(s.version, 1);
        assertEq(s.data, hex"deadbeef");
    }

    function test_version_increments() public {
        vm.startPrank(operator);
        cfg.setConfig(BOT, hex"00");
        cfg.setConfig(BOT, hex"01");
        cfg.setConfig(BOT, hex"02");
        vm.stopPrank();
        assertEq(cfg.historyLength(operator, BOT), 3);
        assertEq(cfg.getConfig(operator, BOT).version, 3);
        assertEq(cfg.snapshotAt(operator, BOT, 0).data, hex"00");
    }

    function test_get_reverts_when_unset() public {
        vm.expectRevert(KeeperConfig.NoConfig.selector);
        cfg.getConfig(operator, BOT);
    }

    function test_history_isolated_per_operator() public {
        vm.prank(operator);
        cfg.setConfig(BOT, hex"AA");
        address other = address(0x1234);
        vm.prank(other);
        cfg.setConfig(BOT, hex"BB");
        assertEq(cfg.getConfig(operator, BOT).data, hex"AA");
        assertEq(cfg.getConfig(other, BOT).data, hex"BB");
    }
}
