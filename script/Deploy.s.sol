// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BuilderCodeRegistry} from "../src/BuilderCodeRegistry.sol";
import {KeeperConfig} from "../src/KeeperConfig.sol";
import {TrackRecord} from "../src/TrackRecord.sol";
import {FeeDistributor, IERC20} from "../src/FeeDistributor.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");

        vm.startBroadcast(pk);
        BuilderCodeRegistry reg = new BuilderCodeRegistry();
        KeeperConfig cfg = new KeeperConfig();
        TrackRecord tr = new TrackRecord();
        FeeDistributor dist = new FeeDistributor(reg, IERC20(usdc));
        vm.stopBroadcast();

        console2.log("BuilderCodeRegistry:", address(reg));
        console2.log("KeeperConfig:       ", address(cfg));
        console2.log("TrackRecord:        ", address(tr));
        console2.log("FeeDistributor:     ", address(dist));
    }
}
