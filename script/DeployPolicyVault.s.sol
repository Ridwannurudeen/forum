// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {IERC20} from "../src/CovenantVault.sol";
import {TrackRecordV2} from "../src/TrackRecordV2.sol";

contract DeployPolicyVault is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        address owner = vm.envAddress("POLICY_OWNER");
        address agent = vm.envAddress("POLICY_AGENT");

        vm.startBroadcast(pk);
        TrackRecordV2 tr = new TrackRecordV2();
        bytes32 botId = keccak256(abi.encodePacked("forum-policy-vault-v1", owner, agent, block.chainid));
        // This registration is irreversible: the bot signer is fixed forever.
        tr.registerBot(botId, TrackRecordV2.BotKind.OTHER, agent);
        PolicyVault vault = new PolicyVault(IERC20(usdc), tr, owner, agent, botId);
        vm.stopBroadcast();

        console2.log("TrackRecordV2:", address(tr));
        console2.log("PolicyVault:   ", address(vault));
        console2.log("botId:");
        console2.logBytes32(botId);
        console2.log("owner:         ", owner);
        console2.log("agent:         ", agent);
        console2.log("botSigner (MUST equal the signing key):", tr.botSigner(botId));
        console2.log("From the owner key, in order: setCategory -> registerPayee (cooling starts at that transaction) -> approve(vault, N)");
    }
}
