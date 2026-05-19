// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BuilderCodeRegistry} from "../src/BuilderCodeRegistry.sol";
import {FeeDistributor, IERC20} from "../src/FeeDistributor.sol";

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Handler that drives invariant exploration: alternates between
///      depositing (which only ever increases claimable) and claiming
///      (which zeroes a recipient's claimable). Tracks max-observed
///      per-recipient claimable to assert monotonicity-between-claims.
contract FeeDistHandler is Test {
    FeeDistributor public dist;
    MockUsdc public usdc;
    bytes32 public code;
    address public funder;
    address[] public recipients;

    uint256 public totalDistributed;
    uint256 public totalClaimed;
    mapping(address => uint256) public maxClaimableSeen;

    constructor(
        FeeDistributor _dist,
        MockUsdc _usdc,
        bytes32 _code,
        address _funder,
        address[] memory _recipients
    ) {
        dist = _dist;
        usdc = _usdc;
        code = _code;
        funder = _funder;
        recipients = _recipients;
    }

    function distribute(uint256 amount) external {
        amount = bound(amount, recipients.length, 1_000_000e6);
        usdc.mint(funder, amount);
        vm.prank(funder);
        usdc.approve(address(dist), amount);
        // Snapshot pre-distribute claimables to verify monotonic-up.
        uint256[] memory before_ = new uint256[](recipients.length);
        for (uint256 i = 0; i < recipients.length; ++i) {
            before_[i] = dist.claimable(recipients[i]);
        }

        vm.prank(funder);
        dist.distribute(code, amount);
        totalDistributed += amount;

        for (uint256 i = 0; i < recipients.length; ++i) {
            uint256 nowClaim = dist.claimable(recipients[i]);
            require(nowClaim >= before_[i], "claimable decreased on distribute");
            if (nowClaim > maxClaimableSeen[recipients[i]]) {
                maxClaimableSeen[recipients[i]] = nowClaim;
            }
        }
    }

    function claim(uint256 idx) external {
        idx = bound(idx, 0, recipients.length - 1);
        address r = recipients[idx];
        uint256 amt = dist.claimable(r);
        if (amt == 0) return;
        vm.prank(r);
        dist.claim();
        totalClaimed += amt;
        require(dist.claimable(r) == 0, "claim must zero claimable");
    }

    function recipientCount() external view returns (uint256) {
        return recipients.length;
    }

    function recipientAt(uint256 i) external view returns (address) {
        return recipients[i];
    }
}

contract FeeDistributorFuzzTest is Test {
    BuilderCodeRegistry reg;
    MockUsdc usdc;
    FeeDistributor dist;
    bytes32 constant CODE = keccak256("fuzz-code");
    address alice = address(0xA11CE);

    FeeDistHandler internal handler;

    function setUp() public {
        reg = new BuilderCodeRegistry();
        usdc = new MockUsdc();
        dist = new FeeDistributor(reg, IERC20(address(usdc)));
        vm.prank(alice);
        reg.claim(CODE);

        // Invariant fixture: a separate code with a fixed attribution.
        bytes32 invCode = keccak256("inv-code");
        address operator = address(0xB055);
        vm.prank(operator);
        reg.claim(invCode);

        address[] memory r = new address[](3);
        r[0] = address(0xAAA1);
        r[1] = address(0xBBB2);
        r[2] = address(0xCCC3);

        uint16[] memory bps = new uint16[](3);
        bps[0] = 5_000; bps[1] = 3_000; bps[2] = 2_000;
        vm.prank(operator);
        dist.setAttribution(invCode, r, bps);

        handler = new FeeDistHandler(dist, usdc, invCode, address(0xF44F), r);
        targetContract(address(handler));
    }

    // ---------- helpers ----------

    function _normaliseBps(uint16[] memory raw) internal pure returns (uint16[] memory bps) {
        // Map any raw uint16 vector into a vector that sums to exactly 10_000
        // by giving the first n-1 entries a strictly positive bound and the
        // last entry the remainder. Caller must ensure raw.length >= 1.
        uint256 n = raw.length;
        bps = new uint16[](n);
        uint256 acc;
        for (uint256 i = 0; i < n - 1; ++i) {
            // each early slice gets 1..(remaining - (n - 1 - i)) so the tail still has room
            uint256 remaining = 10_000 - acc;
            uint256 maxThis = remaining - (n - 1 - i);
            // raw[i] is uint16 (0..65535); reduce to 1..maxThis
            uint256 v = (uint256(raw[i]) % maxThis) + 1;
            bps[i] = uint16(v);
            acc += v;
        }
        bps[n - 1] = uint16(10_000 - acc);
    }

    function _makeRecipients(uint256 n, uint256 seed) internal pure returns (address[] memory r) {
        r = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            // Non-zero, deterministic, distinct.
            r[i] = address(uint160(uint256(keccak256(abi.encode(seed, i, "recipient"))) | 1));
        }
    }

    // ---------- fuzz: sum-of-bps must equal 10_000 ----------

    /// @notice Any well-formed (sum-to-10000) bps vector is accepted.
    function testFuzz_setAttribution_accepts_sum_of_bps_equal_10000(
        uint16 a,
        uint16 b,
        uint16 c
    ) public {
        uint16[] memory raw = new uint16[](3);
        raw[0] = a; raw[1] = b; raw[2] = c;
        uint16[] memory bps = _normaliseBps(raw);
        // Self-check: invariant holds on the normalised input.
        uint256 sum;
        for (uint256 i = 0; i < bps.length; ++i) sum += bps[i];
        assertEq(sum, 10_000, "normalisation broken");

        address[] memory r = _makeRecipients(3, uint256(keccak256(abi.encode(a, b, c))));
        vm.prank(alice);
        dist.setAttribution(CODE, r, bps);

        FeeDistributor.Attribution memory stored = dist.attributionOf(CODE);
        assertEq(stored.recipients.length, 3);
        assertEq(stored.bps.length, 3);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(stored.recipients[i], r[i]);
            assertEq(stored.bps[i], bps[i]);
        }
    }

    /// @notice Any bps vector whose sum != 10_000 is rejected.
    function testFuzz_setAttribution_rejects_bad_sum(
        uint16 a,
        uint16 b,
        uint16 c
    ) public {
        // Bound to keep arithmetic in range; ensure sum != 10_000.
        uint256 s = uint256(a) + uint256(b) + uint256(c);
        vm.assume(s != 10_000);
        // Also avoid overflow into uint16 cast bands by clamping each value.
        vm.assume(a <= 10_000 && b <= 10_000 && c <= 10_000);

        address[] memory r = _makeRecipients(3, 1);
        uint16[] memory bps = new uint16[](3);
        bps[0] = a; bps[1] = b; bps[2] = c;
        vm.prank(alice);
        vm.expectRevert(FeeDistributor.BpsMismatch.selector);
        dist.setAttribution(CODE, r, bps);
    }

    /// @notice Any recipient list containing address(0) is rejected,
    ///         regardless of which slot the zero appears in.
    function testFuzz_setAttribution_rejects_zero_recipient_at_any_index(
        uint8 nRaw,
        uint8 zeroIdxRaw
    ) public {
        uint256 n = bound(uint256(nRaw), 1, 10);
        uint256 zeroIdx = bound(uint256(zeroIdxRaw), 0, n - 1);

        address[] memory r = _makeRecipients(n, 42);
        r[zeroIdx] = address(0);

        // Build a sum-to-10000 bps vector of length n.
        uint16[] memory bps = new uint16[](n);
        if (n == 1) {
            bps[0] = 10_000;
        } else {
            uint256 each = 10_000 / n;
            uint256 acc;
            for (uint256 i = 0; i < n - 1; ++i) { bps[i] = uint16(each); acc += each; }
            bps[n - 1] = uint16(10_000 - acc);
        }

        vm.prank(alice);
        vm.expectRevert(FeeDistributor.ZeroAddress.selector);
        dist.setAttribution(CODE, r, bps);
    }

    // ---------- fuzz: distribute(0) always reverts ----------

    function testFuzz_distribute_reverts_on_zero_amount(uint16 a, uint16 b) public {
        // Set up a valid attribution first so we don't short-circuit on NoAttribution.
        uint16[] memory raw = new uint16[](2);
        raw[0] = a; raw[1] = b;
        uint16[] memory bps = _normaliseBps(raw);
        address[] memory r = _makeRecipients(2, uint256(a) ^ uint256(b));
        vm.prank(alice);
        dist.setAttribution(CODE, r, bps);

        vm.prank(alice);
        vm.expectRevert(FeeDistributor.ZeroAmount.selector);
        dist.distribute(CODE, 0);
    }

    // ---------- fuzz: conservation — sum of claimable deltas == amount ----------

    /// @notice For any valid attribution + non-zero amount, the total
    ///         claimable delta across all recipients equals `amount`.
    ///         Dust from per-recipient truncation flows to recipient[0]
    ///         (FeeDistributor's contract design).
    function testFuzz_distribute_conserves_total(
        uint8 nRaw,
        uint16 bpsSeed,
        uint256 amount,
        uint256 recipientSeed
    ) public {
        uint256 n = bound(uint256(nRaw), 1, 10);
        amount = bound(amount, n, 1_000_000_000e6);

        // Build a sum-to-10000 bps vector of length n using bpsSeed for variety.
        uint16[] memory raw = new uint16[](n);
        for (uint256 i = 0; i < n; ++i) {
            raw[i] = uint16(uint256(keccak256(abi.encode(bpsSeed, i))) % type(uint16).max);
        }
        uint16[] memory bps = n == 1 ? _allInOne() : _normaliseBps(raw);

        address[] memory r = _makeRecipients(n, recipientSeed);
        vm.prank(alice);
        dist.setAttribution(CODE, r, bps);

        // Mint + approve from a fresh funder, distribute.
        address funder = address(0xF1F1);
        usdc.mint(funder, amount);
        vm.prank(funder);
        usdc.approve(address(dist), amount);

        uint256[] memory before_ = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) before_[i] = dist.claimable(r[i]);

        vm.prank(funder);
        dist.distribute(CODE, amount);

        uint256 totalDelta;
        for (uint256 i = 0; i < n; ++i) {
            uint256 nowC = dist.claimable(r[i]);
            assertGe(nowC, before_[i], "claimable must not decrease on distribute");
            totalDelta += nowC - before_[i];
        }
        assertEq(totalDelta, amount, "conservation broken: dust lost or double-credited");

        // Contract escrow must equal exactly what is claimable in aggregate.
        assertEq(usdc.balanceOf(address(dist)), amount, "escrow != distributed");
    }

    function _allInOne() internal pure returns (uint16[] memory bps) {
        bps = new uint16[](1);
        bps[0] = 10_000;
    }

    // ---------- fuzz: monotonicity ----------

    /// @notice Between any pair of (distribute, distribute) calls with NO
    ///         intervening claim, a recipient's claimable balance is
    ///         monotonically non-decreasing.
    function testFuzz_claimable_monotonic_between_distributes(
        uint256 amount1,
        uint256 amount2
    ) public {
        amount1 = bound(amount1, 2, 100_000e6);
        amount2 = bound(amount2, 2, 100_000e6);

        address[] memory r = _makeRecipients(2, 7);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 6_000; bps[1] = 4_000;
        vm.prank(alice);
        dist.setAttribution(CODE, r, bps);

        address funder = address(0xF2F2);
        usdc.mint(funder, amount1 + amount2);
        vm.prank(funder);
        usdc.approve(address(dist), amount1 + amount2);

        vm.prank(funder);
        dist.distribute(CODE, amount1);
        uint256 c0_mid = dist.claimable(r[0]);
        uint256 c1_mid = dist.claimable(r[1]);

        vm.prank(funder);
        dist.distribute(CODE, amount2);
        assertGe(dist.claimable(r[0]), c0_mid, "r0 decreased between distributes");
        assertGe(dist.claimable(r[1]), c1_mid, "r1 decreased between distributes");
    }

    /// @notice A `claim()` is the ONLY action that can reduce a recipient's
    ///         claimable, and it must zero it exactly.
    function testFuzz_claim_zeros_balance(uint256 amount) public {
        amount = bound(amount, 2, 100_000e6);

        address[] memory r = _makeRecipients(2, 11);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7_500; bps[1] = 2_500;
        vm.prank(alice);
        dist.setAttribution(CODE, r, bps);

        address funder = address(0xF3F3);
        usdc.mint(funder, amount);
        vm.prank(funder);
        usdc.approve(address(dist), amount);
        vm.prank(funder);
        dist.distribute(CODE, amount);

        uint256 before0 = dist.claimable(r[0]);
        vm.prank(r[0]);
        dist.claim();
        assertEq(dist.claimable(r[0]), 0, "claim must zero claimable");
        assertEq(usdc.balanceOf(r[0]), before0, "claim must pay out exactly claimable");
    }

    // ---------- invariants ----------

    /// @notice The contract's USDC balance always equals the sum of every
    ///         recipient's outstanding claimable balance. No funds leak, no
    ///         phantom credits.
    function invariant_escrow_equals_sum_of_claimable() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.recipientCount(); ++i) {
            sum += dist.claimable(handler.recipientAt(i));
        }
        assertEq(usdc.balanceOf(address(dist)), sum, "escrow != sum(claimable)");
    }

    /// @notice Across the full handler run, conservation holds globally:
    ///         everything distributed has either been claimed or is still
    ///         claimable. The handler tracks both sides.
    function invariant_total_distributed_accounts_for_claimed_plus_outstanding() public view {
        uint256 outstanding;
        for (uint256 i = 0; i < handler.recipientCount(); ++i) {
            outstanding += dist.claimable(handler.recipientAt(i));
        }
        assertEq(
            handler.totalDistributed(),
            handler.totalClaimed() + outstanding,
            "total distributed != claimed + outstanding"
        );
    }
}
