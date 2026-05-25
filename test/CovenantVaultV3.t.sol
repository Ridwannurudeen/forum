// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CovenantVaultV3} from "../src/CovenantVaultV3.sol";
import {CovenantVault, IERC20} from "../src/CovenantVault.sol";

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external { allowance[msg.sender][spender] = amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}

/// Minimal SlashBond stand-in exposing a settable `bondBalance()`.
contract MockBond {
    address public operator;
    address public attestor;
    bytes32 public botId;
    uint256 public bondBalance;
    constructor(address _operator, address _attestor, bytes32 _botId) {
        operator = _operator;
        attestor = _attestor;
        botId = _botId;
    }
    function setBondBalance(uint256 b) external { bondBalance = b; }
}

contract CovenantVaultV3Test is Test {
    MockUsdc usdc;
    MockBond bond;
    CovenantVaultV3 vault;
    address operator = address(0x0BEC);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address riskKernel = address(0xCAFE);
    bytes32 botId = keccak256("agent-3");

    uint128 constant BUDGET = 100e6;

    function setUp() public {
        usdc = new MockUsdc();
        bond = new MockBond(operator, riskKernel, botId);
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator,
            botId: botId,
            budgetUsdc: BUDGET,
            maxDrawdownBps: 500,        // 5%
            receiptFreshnessSec: 600,   // 10 min
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(bond),
            riskKernel: riskKernel,
            trackRecordV2: address(0x7AC2) // dummy; not exercised in this suite
        });
        vault = new CovenantVaultV3(IERC20(address(usdc)), m);
        usdc.mint(alice, 10_000e6);
        usdc.mint(operator, 10_000e6);
    }

    function _deposit(address u, uint256 a) internal returns (uint256) {
        vm.prank(u); usdc.approve(address(vault), a);
        vm.prank(u); return vault.deposit(a);
    }

    function _mandate(address bondContract) internal view returns (CovenantVault.Mandate memory) {
        return CovenantVault.Mandate({
            operator: operator,
            botId: botId,
            budgetUsdc: BUDGET,
            maxDrawdownBps: 500,
            receiptFreshnessSec: 600,
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: bondContract,
            riskKernel: riskKernel,
            trackRecordV2: address(0x7AC2)
        });
    }

    function test_pullCredit_reverts_when_bond_below_budget() public {
        _deposit(alice, 1_000e6); // idle > budget
        bond.setBondBalance(BUDGET - 1); // collateral just under budget
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.UnderBonded.selector);
        vault.pullCredit(50e6);
    }

    function test_pullCredit_reverts_when_no_bond() public {
        _deposit(alice, 1_000e6);
        // bond balance defaults to 0
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.UnderBonded.selector);
        vault.pullCredit(50e6);
    }

    function test_pullCredit_reverts_when_bond_operator_mismatches() public {
        MockBond otherBond = new MockBond(bob, riskKernel, botId);
        otherBond.setBondBalance(BUDGET);
        CovenantVaultV3 mismatched = new CovenantVaultV3(IERC20(address(usdc)), _mandate(address(otherBond)));
        vm.prank(alice); usdc.approve(address(mismatched), 1_000e6);
        vm.prank(alice); mismatched.deposit(1_000e6);

        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.BondMismatch.selector);
        mismatched.pullCredit(50e6);
    }

    function test_pullCredit_reverts_when_bond_attestor_mismatches() public {
        MockBond otherBond = new MockBond(operator, bob, botId);
        otherBond.setBondBalance(BUDGET);
        CovenantVaultV3 mismatched = new CovenantVaultV3(IERC20(address(usdc)), _mandate(address(otherBond)));
        vm.prank(alice); usdc.approve(address(mismatched), 1_000e6);
        vm.prank(alice); mismatched.deposit(1_000e6);

        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.BondMismatch.selector);
        mismatched.pullCredit(50e6);
    }

    function test_pullCredit_reverts_when_bond_bot_mismatches() public {
        MockBond otherBond = new MockBond(operator, riskKernel, keccak256("other-agent"));
        otherBond.setBondBalance(BUDGET);
        CovenantVaultV3 mismatched = new CovenantVaultV3(IERC20(address(usdc)), _mandate(address(otherBond)));
        vm.prank(alice); usdc.approve(address(mismatched), 1_000e6);
        vm.prank(alice); mismatched.deposit(1_000e6);

        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.BondMismatch.selector);
        mismatched.pullCredit(50e6);
    }

    function test_pullCredit_succeeds_when_bond_ge_budget() public {
        _deposit(alice, 1_000e6);
        bond.setBondBalance(BUDGET); // fully collateralised
        vm.prank(operator);
        vault.pullCredit(50e6);
        assertEq(vault.operatorOutstanding(), 50e6);
        assertEq(vault.depositTotalIdle(), 950e6);
        assertEq(usdc.balanceOf(operator), 10_000e6 + 50e6);
    }

    function test_pullCredit_still_enforces_budget() public {
        _deposit(alice, 1_000e6);
        bond.setBondBalance(BUDGET); // bond gate passes
        // amount > availableCredit (capped at budget=100e6) -> base BudgetExceeded
        vm.prank(operator);
        vm.expectRevert(CovenantVault.BudgetExceeded.selector);
        vault.pullCredit(101e6);
    }

    function test_pullCredit_onlyOperator() public {
        _deposit(alice, 1_000e6);
        bond.setBondBalance(BUDGET);
        vm.prank(bob);
        vm.expectRevert(CovenantVault.NotOperator.selector);
        vault.pullCredit(50e6);
    }
}
