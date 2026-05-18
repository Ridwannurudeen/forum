// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CovenantInbox} from "../src/CovenantInbox.sol";
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

contract CovenantInboxTest is Test {
    MockUsdc usdc;
    CovenantVault vault;
    CovenantInbox inbox;
    bytes32 constant BOT = keccak256("inbox-test");
    address operator = address(0x0BEC);
    address bridgeRelayer = address(0xB81D6E); // simulates CCTP relayer / bridge caller
    address recipient = address(0xA11CE);

    function setUp() public {
        usdc = new MockUsdc();
        CovenantVault.Mandate memory m = CovenantVault.Mandate({
            operator: operator,
            botId: BOT,
            budgetUsdc: 500e6,
            maxDrawdownBps: 500,
            receiptFreshnessSec: 600,
            expiry: 0,
            perfFeeBps: 2_000,
            bondContract: address(0xBEEF),
            riskKernel: address(0xC0DE),
            trackRecordV2: address(0xDEAD)
        });
        vault = new CovenantVault(IERC20(address(usdc)), m);
        inbox = new CovenantInbox();
    }

    function test_depositInto_credits_recipient() public {
        usdc.mint(bridgeRelayer, 100e6);
        vm.prank(bridgeRelayer); usdc.approve(address(inbox), 100e6);

        vm.prank(bridgeRelayer);
        uint256 shares = inbox.depositInto(address(vault), recipient, 100e6);

        assertEq(shares, 100e6); // first deposit, 1:1
        assertEq(inbox.sharesOf(address(vault), recipient), 100e6);
        // Bridge relayer holds NO shares — recipient does (in inbox ledger)
        assertEq(inbox.sharesOf(address(vault), bridgeRelayer), 0);
        // Vault sees the inbox as the share holder
        assertEq(vault.sharesOf(address(inbox)), 100e6);
        // USDC moved into the vault
        assertEq(usdc.balanceOf(address(vault)), 100e6);
    }

    function test_claim_pays_recipient_directly() public {
        usdc.mint(bridgeRelayer, 100e6);
        vm.prank(bridgeRelayer); usdc.approve(address(inbox), 100e6);
        vm.prank(bridgeRelayer); inbox.depositInto(address(vault), recipient, 100e6);

        vm.prank(recipient);
        uint256 paid = inbox.claim(address(vault), 100e6);

        assertEq(paid, 100e6);
        assertEq(usdc.balanceOf(recipient), 100e6);
        assertEq(inbox.sharesOf(address(vault), recipient), 0);
        assertEq(vault.sharesOf(address(inbox)), 0);
        // Vault is empty
        assertEq(vault.assets(), 0);
    }

    function test_two_recipients_isolated() public {
        address alice = address(0xA11CE);
        address bob = address(0xB0B);
        usdc.mint(bridgeRelayer, 300e6);
        vm.prank(bridgeRelayer); usdc.approve(address(inbox), 300e6);
        vm.prank(bridgeRelayer); inbox.depositInto(address(vault), alice, 100e6);
        vm.prank(bridgeRelayer); inbox.depositInto(address(vault), bob, 200e6);

        assertEq(inbox.sharesOf(address(vault), alice), 100e6);
        assertEq(inbox.sharesOf(address(vault), bob), 200e6);

        // Alice claims; Bob's balance untouched
        vm.prank(alice); inbox.claim(address(vault), 100e6);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(inbox.sharesOf(address(vault), alice), 0);
        assertEq(inbox.sharesOf(address(vault), bob), 200e6);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_claim_above_balance_reverts() public {
        usdc.mint(bridgeRelayer, 100e6);
        vm.prank(bridgeRelayer); usdc.approve(address(inbox), 100e6);
        vm.prank(bridgeRelayer); inbox.depositInto(address(vault), recipient, 100e6);

        vm.prank(recipient);
        vm.expectRevert(CovenantInbox.InsufficientInboxShares.selector);
        inbox.claim(address(vault), 200e6);
    }

    function test_depositInto_zero_amount_reverts() public {
        vm.expectRevert(CovenantInbox.ZeroAmount.selector);
        inbox.depositInto(address(vault), recipient, 0);
    }

    function test_depositInto_zero_recipient_reverts() public {
        usdc.mint(bridgeRelayer, 100e6);
        vm.prank(bridgeRelayer); usdc.approve(address(inbox), 100e6);
        vm.prank(bridgeRelayer);
        vm.expectRevert(CovenantInbox.ZeroAddress.selector);
        inbox.depositInto(address(vault), address(0), 100e6);
    }
}
