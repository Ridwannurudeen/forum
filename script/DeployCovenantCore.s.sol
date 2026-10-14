// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {RiskKernelV2} from "../src/RiskKernelV2.sol";
import {CovenantVaultFactoryV2} from "../src/CovenantVaultFactoryV2.sol";
import {CapitalRouter} from "../src/CapitalRouter.sol";
import {FeeRouterV1} from "../src/FeeRouterV1.sol";
import {IERC20} from "../src/CovenantVault.sol";

/// @notice Arc mainnet (chain 5042) core of the Covenant stack. Deploys the
///         shared, operator-independent contracts only. Per-operator accounts
///         (SlashBond + vault) come from DeployCovenantAccount.
contract DeployCovenantCore is Script {
    function run()
        external
        returns (RiskKernelV2 kernel, CovenantVaultFactoryV2 factory, CapitalRouter router, FeeRouterV1 feeRouter)
    {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        address strategist = vm.envAddress("STRATEGIST");

        vm.startBroadcast(pk);
        kernel = new RiskKernelV2();
        factory = new CovenantVaultFactoryV2(IERC20(usdc));
        router = new CapitalRouter(IERC20(usdc), strategist);
        feeRouter = new FeeRouterV1(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("chainId:               ", block.chainid);
        console2.log("usdc:                  ", usdc);
        console2.log("RiskKernelV2:          ", address(kernel));
        console2.log("CovenantVaultFactoryV2:", address(factory));
        console2.log("CapitalRouter:         ", address(router));
        console2.log("FeeRouterV1:           ", address(feeRouter));
        console2.log("strategist:            ", strategist);
    }
}
