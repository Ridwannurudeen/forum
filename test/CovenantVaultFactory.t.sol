// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CovenantVaultFactory} from "../src/CovenantVaultFactory.sol";
import {CovenantVault, IERC20} from "../src/CovenantVault.sol";

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

contract CovenantVaultFactoryTest is Test {
    MockUsdc usdc;
    CovenantVaultFactory factory;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address operator1 = address(0x0BEC);
    address operator2 = address(0x0BED);
    bytes32 constant BOT1 = keccak256("factory-test-1");
    bytes32 constant BOT2 = keccak256("factory-test-2");

    function setUp() public {
        usdc = new MockUsdc();
        factory = new CovenantVaultFactory(IERC20(address(usdc)));
    }

    function _mandate(address op, bytes32 botId) internal pure returns (CovenantVault.Mandate memory) {
        return CovenantVault.Mandate({
            operator: op,
            botId: botId,
            budgetUsdc: 500e6,
            maxDrawdownBps: 500,
            receiptFreshnessSec: 600,
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(0xBEEF),
            riskKernel: address(0xC0DE),
            trackRecordV2: address(0xDEAD)
        });
    }

    function test_createVault_returns_address_and_emits_event() public {
        vm.prank(alice);
        vm.expectEmit(false, true, true, false, address(factory));
        emit CovenantVaultFactory.VaultCreated(address(0), alice, operator1, BOT1, 500e6, uint64(block.timestamp));
        address vault = factory.createVault(_mandate(operator1, BOT1));
        assertTrue(vault != address(0));
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), vault);
    }

    function test_createVault_seeds_lookup_tables() public {
        vm.prank(alice);
        address vault = factory.createVault(_mandate(operator1, BOT1));

        address[] memory byCreator = factory.vaultsByCreator(alice);
        assertEq(byCreator.length, 1);
        assertEq(byCreator[0], vault);

        address[] memory byOperator = factory.vaultsByOperator(operator1);
        assertEq(byOperator.length, 1);
        assertEq(byOperator[0], vault);

        address[] memory byBotId = factory.vaultsByBotId(BOT1);
        assertEq(byBotId.length, 1);
        assertEq(byBotId[0], vault);
    }

    function test_createVault_constructor_validation_passes_through() public {
        // budget == 0 must revert at CovenantVault constructor
        CovenantVault.Mandate memory bad = _mandate(operator1, BOT1);
        bad.budgetUsdc = 0;
        vm.expectRevert(bytes("zero budget"));
        factory.createVault(bad);
    }

    function test_createVault_zero_operator_reverts() public {
        CovenantVault.Mandate memory bad = _mandate(address(0), BOT1);
        vm.expectRevert(bytes("zero operator"));
        factory.createVault(bad);
    }

    function test_two_creators_isolated_in_lookup_tables() public {
        vm.prank(alice);
        address vA = factory.createVault(_mandate(operator1, BOT1));

        vm.prank(bob);
        address vB = factory.createVault(_mandate(operator2, BOT2));

        assertEq(factory.vaultCount(), 2);
        assertEq(factory.vaultsByCreator(alice).length, 1);
        assertEq(factory.vaultsByCreator(alice)[0], vA);
        assertEq(factory.vaultsByCreator(bob).length, 1);
        assertEq(factory.vaultsByCreator(bob)[0], vB);
        assertEq(factory.vaultsByOperator(operator1).length, 1);
        assertEq(factory.vaultsByOperator(operator2).length, 1);
        assertEq(factory.vaultsByBotId(BOT1).length, 1);
        assertEq(factory.vaultsByBotId(BOT2).length, 1);
    }

    function test_same_creator_multiple_vaults_accumulate() public {
        vm.prank(alice);
        factory.createVault(_mandate(operator1, BOT1));
        vm.prank(alice);
        factory.createVault(_mandate(operator1, BOT2));
        vm.prank(alice);
        factory.createVault(_mandate(operator2, BOT1));

        assertEq(factory.vaultCount(), 3);
        assertEq(factory.vaultsByCreator(alice).length, 3);
        assertEq(factory.vaultsByOperator(operator1).length, 2);
        assertEq(factory.vaultsByOperator(operator2).length, 1);
        assertEq(factory.vaultsByBotId(BOT1).length, 2);
        assertEq(factory.vaultsByBotId(BOT2).length, 1);
    }

    function test_created_vault_is_usable() public {
        vm.prank(alice);
        address vaultAddr = factory.createVault(_mandate(operator1, BOT1));
        CovenantVault vault = CovenantVault(vaultAddr);

        // Vault should be ACTIVE and accept deposits immediately
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
        usdc.mint(bob, 100e6);
        vm.prank(bob); usdc.approve(vaultAddr, 100e6);
        vm.prank(bob); uint256 shares = vault.deposit(100e6);
        assertEq(shares, 100e6);
        assertEq(vault.assets(), 100e6);
    }

    function test_allVaults_returns_full_array() public {
        vm.prank(alice); address v1 = factory.createVault(_mandate(operator1, BOT1));
        vm.prank(bob);   address v2 = factory.createVault(_mandate(operator2, BOT2));

        address[] memory all = factory.allVaults();
        assertEq(all.length, 2);
        assertEq(all[0], v1);
        assertEq(all[1], v2);
    }

    function test_factory_constructor_zero_usdc_reverts() public {
        vm.expectRevert(bytes("zero usdc"));
        new CovenantVaultFactory(IERC20(address(0)));
    }
}
