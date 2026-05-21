// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CovenantVaultV2} from "../src/CovenantVaultV2.sol";
import {IERC20} from "../src/CovenantVault.sol";
import {IStrategyAdapter} from "../src/IStrategyAdapter.sol";

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

/// Idle-like adapter that holds USDC for the vault. The test mints extra USDC
/// directly to it to simulate realized yield.
contract MockAdapter is IStrategyAdapter {
    MockUsdc public immutable usdcToken;
    address public immutable vaultAddr;
    constructor(MockUsdc _usdc, address _vault) { usdcToken = _usdc; vaultAddr = _vault; }
    function asset() external view returns (address) { return address(usdcToken); }
    function vault() external view returns (address) { return vaultAddr; }
    function totalAssets() external view returns (uint256) { return usdcToken.balanceOf(address(this)); }
    function deposit(uint256 amount) external returns (uint256) {
        require(msg.sender == vaultAddr, "not vault");
        usdcToken.transferFrom(msg.sender, address(this), amount);
        return amount;
    }
    function withdraw(uint256 amount) external returns (uint256) {
        require(msg.sender == vaultAddr, "not vault");
        uint256 bal = usdcToken.balanceOf(address(this));
        uint256 amt = amount > bal ? bal : amount;
        if (amt > 0) usdcToken.transfer(vaultAddr, amt);
        return amt;
    }
}

contract CovenantVaultV2Test is Test {
    MockUsdc usdc;
    CovenantVaultV2 vault;
    MockAdapter adapter;
    address operator = address(0x0BEC);
    address governor = address(0x6066);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address riskKernel = address(0xCAFE);

    function setUp() public {
        usdc = new MockUsdc();
        CovenantVaultV2.Mandate memory m = CovenantVaultV2.Mandate({
            operator: operator, botId: keccak256("agent-2"), budgetUsdc: 500e6,
            maxDrawdownBps: 500, receiptFreshnessSec: 600, expiry: 0,
            perfFeeBps: 2_000, bondContract: address(0xBEEF),
            riskKernel: riskKernel, trackRecordV2: address(0x7AC2)
        });
        vault = new CovenantVaultV2(IERC20(address(usdc)), m, governor);
        adapter = new MockAdapter(usdc, address(vault));
        usdc.mint(alice, 10_000e6);
        usdc.mint(operator, 10_000e6);
    }

    function _deposit(address u, uint256 a) internal returns (uint256) {
        vm.prank(u); usdc.approve(address(vault), a);
        vm.prank(u); return vault.deposit(a);
    }
    function _allow() internal {
        vm.prank(governor); vault.setStrategyAllowed(address(adapter), true);
    }

    function test_setStrategyAllowed_only_governor() public {
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV2.NotGovernor.selector);
        vault.setStrategyAllowed(address(adapter), true);
        _allow();
        assertTrue(vault.allowedStrategy(address(adapter)));
    }

    function test_setStrategyAllowed_rejects_mismatched_adapter() public {
        MockAdapter wrong = new MockAdapter(usdc, address(0xdead)); // wrong vault binding
        vm.prank(governor);
        vm.expectRevert(CovenantVaultV2.AdapterMismatch.selector);
        vault.setStrategyAllowed(address(wrong), true);
    }

    function test_deployToStrategy_moves_idle_to_adapter_not_operator() public {
        _deposit(alice, 1_000e6);
        _allow();
        uint256 opBefore = usdc.balanceOf(operator);
        vm.prank(operator); vault.deployToStrategy(address(adapter), 400e6);
        // funds went to the ADAPTER, not the operator
        assertEq(usdc.balanceOf(address(adapter)), 400e6);
        assertEq(usdc.balanceOf(operator), opBefore);
        assertEq(vault.strategyDeployed(), 400e6);
        assertEq(vault.deployedTo(address(adapter)), 400e6);
        assertEq(vault.depositTotalIdle(), 600e6);
        // assets() conserved across an idle deployment (principal still counted)
        assertEq(vault.assets(), 1_000e6);
    }

    function test_deployToStrategy_requires_allowlist() public {
        _deposit(alice, 1_000e6);
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV2.StrategyNotAllowed.selector);
        vault.deployToStrategy(address(adapter), 100e6);
    }

    function test_deployToStrategy_only_operator() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(bob);
        vm.expectRevert(CovenantVaultV2.NotOperator.selector);
        vault.deployToStrategy(address(adapter), 100e6);
    }

    function test_deployToStrategy_blocked_when_paused() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(riskKernel); vault.setState(CovenantVaultV2.State.PAUSED, bytes32("p"));
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV2.MandateNotActive.selector);
        vault.deployToStrategy(address(adapter), 100e6);
    }

    function test_deployToStrategy_cannot_exceed_idle() public {
        _deposit(alice, 100e6); _allow();
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV2.InsufficientIdle.selector);
        vault.deployToStrategy(address(adapter), 200e6);
    }

    function test_recall_returns_principal_and_realized_yield_raises_nav() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(operator); vault.deployToStrategy(address(adapter), 500e6);
        // simulate +50 USDC yield earned in the adapter
        usdc.mint(address(adapter), 50e6);
        vm.prank(operator); vault.recallFromStrategy(address(adapter), type(uint256).max);
        assertEq(vault.strategyDeployed(), 0);
        assertEq(vault.deployedTo(address(adapter)), 0);
        assertEq(vault.depositTotalIdle(), 1_050e6); // 500 idle left + 550 recovered
        assertEq(vault.assets(), 1_050e6);
        assertEq(vault.perSharePrice(), 1.05e18); // NAV rose 1.0 -> 1.05
    }

    function test_recall_works_when_paused() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(operator); vault.deployToStrategy(address(adapter), 400e6);
        vm.prank(riskKernel); vault.setState(CovenantVaultV2.State.PAUSED, bytes32("p"));
        // recall must work even when paused — funds are never stuck
        vm.prank(operator); vault.recallFromStrategy(address(adapter), type(uint256).max);
        assertEq(vault.strategyDeployed(), 0);
        assertEq(vault.depositTotalIdle(), 1_000e6);
    }

    function test_recall_reverts_when_nothing_deployed() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV2.ZeroAmount.selector);
        vault.recallFromStrategy(address(adapter), 100e6);
    }

    function test_crystalliseFee_on_strategy_yield() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(operator); vault.deployToStrategy(address(adapter), 500e6);
        usdc.mint(address(adapter), 200e6); // +200 yield
        vm.prank(operator); vault.recallFromStrategy(address(adapter), type(uint256).max);
        vault.crystalliseFee();
        // perf fee = 20% * (1.2 - 1.0) * 1000 shares = 40 USDC
        assertEq(vault.operatorClaimable(), 40e6);
    }

    function test_pullCredit_still_works_alongside_strategy() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(operator); vault.deployToStrategy(address(adapter), 400e6);
        // 600 idle remains; operator can still draw credit within budget
        vm.prank(operator); vault.pullCredit(300e6);
        assertEq(vault.operatorOutstanding(), 300e6);
        assertEq(vault.depositTotalIdle(), 300e6);
        // availableCredit reflects only idle now
        assertEq(vault.availableCredit(), 200e6); // min(budget-out=200, idle=300)
    }

    function test_depositor_withdraw_limited_to_idle() public {
        _deposit(alice, 1_000e6); _allow();
        vm.prank(operator); vault.deployToStrategy(address(adapter), 900e6);
        // only 100 idle; alice cannot pull her full 1000 until recall
        vm.prank(alice);
        vm.expectRevert(CovenantVaultV2.InsufficientIdle.selector);
        vault.withdraw(1_000e6);
        // but can withdraw against available idle
        vm.prank(alice); uint256 out = vault.withdraw(100e6);
        assertEq(out, 100e6);
    }
}
