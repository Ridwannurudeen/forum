// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {SlashBond, IERC20} from "../src/SlashBond.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultV3} from "../src/CovenantVaultV3.sol";
import {CovenantVaultFactoryV2} from "../src/CovenantVaultFactoryV2.sol";

/// @notice One Covenant Account on Arc mainnet: a SlashBond attested by the
///         RiskKernelV2 plus a CovenantVaultV3 created through the factory.
///         The deployer key IS the operator / keeper signer, so the botId is
///         derived exactly as keeper/src/forum-v2.ts does:
///         keccak256(utf8(`${operator.toLowerCase()}:${label}`)).
///         Bonding, depositing and registerBot are separate cast steps.
contract DeployCovenantAccount is Script {
    uint16 constant MAX_DRAWDOWN_BPS = 500;   // 5%, same as the testnet demo account
    uint16 constant PERF_FEE_BPS = 2_000;     // 20%, same as the testnet demo account
    uint64 constant UNBOND_DELAY_SEC = 86_400;

    function botIdFor(address operator, string memory label) public pure returns (bytes32) {
        // vm.toString(address) is EIP-55 checksummed; viem's `.toLowerCase()` is not.
        return keccak256(bytes(string.concat(vm.toLowercase(vm.toString(operator)), ":", label)));
    }

    function run() external returns (SlashBond bond, CovenantVaultV3 vault, bytes32 botId) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        address slashRecipient = vm.envAddress("SLASH_RECIPIENT");
        string memory label = vm.envString("KEEPER_LABEL");

        CovenantVault.Mandate memory m;
        m.operator = vm.addr(pk);
        m.botId = botIdFor(m.operator, label);
        m.budgetUsdc = uint128(vm.envUint("BUDGET_USDC"));
        m.maxDrawdownBps = MAX_DRAWDOWN_BPS;
        m.receiptFreshnessSec = uint32(vm.envUint("RECEIPT_FRESHNESS_SEC"));
        m.expiry = 0;
        m.perfFeeBps = PERF_FEE_BPS;
        m.riskKernel = vm.envAddress("RISK_KERNEL");
        m.trackRecordV2 = vm.envAddress("TRACK_RECORD_V2");
        botId = m.botId;

        vm.startBroadcast(pk);
        bond = new SlashBond(IERC20(usdc), m.operator, m.riskKernel, slashRecipient, m.botId, UNBOND_DELAY_SEC);
        m.bondContract = address(bond);
        vault = CovenantVaultV3(CovenantVaultFactoryV2(vm.envAddress("FACTORY_V2")).createVault(m));
        vm.stopBroadcast();

        console2.log("chainId:        ", block.chainid);
        console2.log("operator:       ", m.operator);
        console2.log("label:          ", label);
        console2.log("botId:");
        console2.logBytes32(botId);
        console2.log("SlashBond:      ", address(bond));
        console2.log("CovenantVaultV3:", address(vault));
        console2.log("budgetUsdc:     ", m.budgetUsdc);
        console2.log("slashRecipient: ", slashRecipient);
        console2.log("Next, from the operator key: approve(bond, N) -> bond.bond(N >= budgetUsdc); then trackRecordV2.registerBot(botId, kind, operator)");
    }
}
