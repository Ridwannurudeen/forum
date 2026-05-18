// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {FeeRouterV1} from "../src/FeeRouterV1.sol";
import {IERC20} from "../src/CovenantVault.sol";

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

contract FeeRouterV1Test is Test {
    MockUsdc usdc;
    FeeRouterV1 router;
    address creator = address(0xC0DE);
    address operator = address(0x0F1);
    address researcher = address(0xE5);
    address referrer = address(0xFEE);
    address payer = address(0xBA9);

    function setUp() public {
        usdc = new MockUsdc();
        router = new FeeRouterV1(IERC20(address(usdc)));
        usdc.mint(payer, 10_000_000);
    }

    function _pay(uint256 splitId, uint256 amount) internal {
        vm.prank(payer); usdc.approve(address(router), amount);
        vm.prank(payer); router.pay(splitId, amount);
    }

    function _basicSplit() internal returns (uint256) {
        address[] memory r = new address[](3);
        r[0] = operator; r[1] = researcher; r[2] = referrer;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000; bps[1] = 3000; bps[2] = 1000;
        vm.prank(creator);
        return router.createSplit(r, bps);
    }

    function test_constructor_zero_usdc_reverts() public {
        vm.expectRevert(FeeRouterV1.ZeroAddress.selector);
        new FeeRouterV1(IERC20(address(0)));
    }

    function test_createSplit_records_and_emits() public {
        uint256 id = _basicSplit();
        assertEq(id, 0);
        assertEq(router.splitCount(), 1);
        FeeRouterV1.SplitView memory s = router.splitAt(id);
        assertEq(s.creator, creator);
        assertEq(s.recipients.length, 3);
        assertEq(s.bps[0], 6000);
        assertEq(s.bps[1], 3000);
        assertEq(s.bps[2], 1000);
        assertEq(s.totalRouted, 0);
    }

    function test_createSplit_empty_reverts() public {
        address[] memory r = new address[](0);
        uint16[] memory bps = new uint16[](0);
        vm.expectRevert(FeeRouterV1.EmptyRecipients.selector);
        router.createSplit(r, bps);
    }

    function test_createSplit_length_mismatch_reverts() public {
        address[] memory r = new address[](2);
        r[0] = operator; r[1] = researcher;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000; bps[1] = 3000; bps[2] = 1000;
        vm.expectRevert(FeeRouterV1.LengthMismatch.selector);
        router.createSplit(r, bps);
    }

    function test_createSplit_bps_not_10000_reverts() public {
        address[] memory r = new address[](2);
        r[0] = operator; r[1] = researcher;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000; bps[1] = 4000; // sums to 9000
        vm.expectRevert(FeeRouterV1.BpsMismatch.selector);
        router.createSplit(r, bps);
    }

    function test_createSplit_zero_recipient_reverts() public {
        address[] memory r = new address[](2);
        r[0] = operator; r[1] = address(0);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000; bps[1] = 5000;
        vm.expectRevert(FeeRouterV1.ZeroAddress.selector);
        router.createSplit(r, bps);
    }

    function test_pay_unknown_split_reverts() public {
        vm.prank(payer); usdc.approve(address(router), 100);
        vm.prank(payer);
        vm.expectRevert(FeeRouterV1.UnknownSplit.selector);
        router.pay(99, 100);
    }

    function test_pay_zero_reverts() public {
        _basicSplit();
        vm.prank(payer);
        vm.expectRevert(FeeRouterV1.ZeroAmount.selector);
        router.pay(0, 0);
    }

    function test_pay_clean_division_60_30_10() public {
        uint256 id = _basicSplit();
        _pay(id, 1_000_000); // 1 USDC
        // 60% operator, 30% researcher, 10% referrer
        assertEq(router.claimableOf(id, operator),  600_000);
        assertEq(router.claimableOf(id, researcher), 300_000);
        assertEq(router.claimableOf(id, referrer),   100_000);
        assertEq(router.totalClaimableOf(operator),  600_000);
        assertEq(router.totalClaimableOf(researcher), 300_000);
        assertEq(router.totalClaimableOf(referrer),   100_000);
    }

    function test_pay_rounding_dust_to_first() public {
        // 7 units across 3 recipients with 6000/3000/1000 bps
        // Exact: 4.2 / 2.1 / 0.7. Floor: r[1]=2, r[2]=0, dust=5 → r[0]
        uint256 id = _basicSplit();
        _pay(id, 7);
        assertEq(router.claimableOf(id, researcher), 2);
        assertEq(router.claimableOf(id, referrer),   0);
        assertEq(router.claimableOf(id, operator),   5);
        // sum must equal what was paid in
        assertEq(
            router.claimableOf(id, operator)
            + router.claimableOf(id, researcher)
            + router.claimableOf(id, referrer),
            7
        );
    }

    function test_pay_running_totals() public {
        uint256 id = _basicSplit();
        _pay(id, 1_000_000);
        _pay(id, 2_000_000);
        assertEq(router.claimableOf(id, operator),  1_800_000);
        FeeRouterV1.SplitView memory s = router.splitAt(id);
        assertEq(s.totalRouted, 3_000_000);
    }

    function test_claim_pays_total_across_splits() public {
        // Two splits both sending to operator (60% and 50%)
        uint256 a = _basicSplit();

        address[] memory r = new address[](2);
        r[0] = operator; r[1] = researcher;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000; bps[1] = 5000;
        vm.prank(creator);
        uint256 b = router.createSplit(r, bps);

        _pay(a, 1_000_000); // operator += 600_000
        _pay(b, 1_000_000); // operator += 500_000

        uint256 beforeBal = usdc.balanceOf(operator);
        vm.prank(operator);
        uint256 paid = router.claim();
        assertEq(paid, 1_100_000);
        assertEq(usdc.balanceOf(operator) - beforeBal, 1_100_000);
        assertEq(router.totalClaimableOf(operator), 0);
    }

    function test_claim_nothing_reverts() public {
        vm.prank(operator);
        vm.expectRevert(FeeRouterV1.NothingToClaim.selector);
        router.claim();
    }

    function test_claim_double_call_second_reverts() public {
        uint256 id = _basicSplit();
        _pay(id, 1_000_000);
        vm.prank(operator); router.claim();
        vm.prank(operator);
        vm.expectRevert(FeeRouterV1.NothingToClaim.selector);
        router.claim();
    }

    function test_splitAt_unknown_reverts() public {
        vm.expectRevert(FeeRouterV1.UnknownSplit.selector);
        router.splitAt(99);
    }

    function test_two_recipients_50_50_exact() public {
        address[] memory r = new address[](2);
        r[0] = operator; r[1] = researcher;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000; bps[1] = 5000;
        vm.prank(creator);
        uint256 id = router.createSplit(r, bps);
        _pay(id, 2_000_000);
        assertEq(router.claimableOf(id, operator),   1_000_000);
        assertEq(router.claimableOf(id, researcher), 1_000_000);
    }
}
