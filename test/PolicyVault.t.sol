// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TrackRecordV2} from "../src/TrackRecordV2.sol";
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

contract MockUsdcBlocklist is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    function setBlocked(address account, bool value) external { blocked[account] = value; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(!blocked[msg.sender] && !blocked[to]);
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(!blocked[from] && !blocked[to]);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}

contract PolicyVaultTest is Test {
    uint256 constant OWNER_PK = 1;
    uint256 constant AGENT_PK = 2;
    uint256 constant STRANGER_PK = 3;
    bytes32 constant BOT_ID = keccak256("policy-vault-bot");
    bytes32 constant PAYEE_ID = keccak256("payee");
    bytes32 constant CATEGORY_ID = keccak256("category");
    uint128 constant AMOUNT = 10e6;
    uint128 constant EPOCH_BUDGET = 100e6;
    uint128 constant PER_TX_CAP = 50e6;
    uint128 constant PER_DAY_CAP = 80e6;
    bytes32 constant RECORD_TYPEHASH = keccak256(
        "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)"
    );

    address owner;
    address agent;
    address stranger;
    address payee = address(0xBEEF);
    address rotatedAgent = address(0xCAFE);
    MockUsdc usdc;
    TrackRecordV2 trackRecord;
    PolicyVault vault;

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        agent = vm.addr(AGENT_PK);
        stranger = vm.addr(STRANGER_PK);
        usdc = new MockUsdc();
        trackRecord = new TrackRecordV2();
        trackRecord.registerBot(BOT_ID, TrackRecordV2.BotKind.OTHER, agent);
        vault = new PolicyVault(IERC20(address(usdc)), trackRecord, owner, agent, BOT_ID);
        usdc.mint(owner, 10_000e6);
        vm.prank(owner);
        usdc.approve(address(vault), type(uint256).max);
        _configureCategory(EPOCH_BUDGET, PER_TX_CAP, PER_DAY_CAP);
        vm.prank(owner);
        vault.registerPayee(PAYEE_ID, payee, 100e6);
    }

    function _configureCategory(uint128 budget, uint128 txCap, uint128 dayCap) internal {
        vm.prank(owner);
        vault.setCategory(CATEGORY_ID, budget, txCap, dayCap);
    }

    function _warpPastCooling() internal {
        vm.warp(block.timestamp + 86_400);
    }

    function _record(uint128 amount) internal view returns (TrackRecordV2.Record memory r) {
        uint64 start = trackRecord.lastPeriodEnd(BOT_ID) + 1;
        r = TrackRecordV2.Record({
            seq: trackRecord.lastSeq(BOT_ID) + 1,
            periodStart: start,
            periodEnd: uint64(block.timestamp > start ? block.timestamp : start),
            pnlMicros: -int128(amount),
            fills: 1,
            metaHash: vault.paymentMeta(PAYEE_ID, CATEGORY_ID, amount),
            evidenceUri: "ipfs://policy-payment",
            evidenceHash: keccak256("payment-evidence"),
            prevRecordHash: trackRecord.lastRecordHash(BOT_ID)
        });
    }

    function _structHash(TrackRecordV2.Record memory r) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            RECORD_TYPEHASH,
            BOT_ID,
            uint8(TrackRecordV2.BotKind.OTHER),
            r.seq,
            r.periodStart,
            r.periodEnd,
            r.pnlMicros,
            r.fills,
            r.metaHash,
            keccak256(bytes(r.evidenceUri)),
            r.evidenceHash,
            r.prevRecordHash
        ));
    }

    function _sign(TrackRecordV2.Record memory r, uint256 pk)
        internal view returns (bytes memory, bytes32)
    {
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", trackRecord.DOMAIN_SEPARATOR(), _structHash(r))
        );
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(pk, digest);
        return (abi.encodePacked(rs, ss, v), digest);
    }

    function _pay(uint128 amount) internal returns (TrackRecordV2.Record memory r) {
        r = _record(amount);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vault.pay(PAYEE_ID, CATEGORY_ID, amount, r, sig);
    }

    function _assertNoMovement(uint256 ownerBefore, uint256 payeeBefore) internal view {
        assertEq(usdc.balanceOf(payee), payeeBefore);
        assertEq(usdc.balanceOf(owner), ownerBefore);
        assertEq(vault.totalPaidUsdc(), 0);
        assertEq(vault.paymentCount(), 0);
        assertEq(trackRecord.lastSeq(BOT_ID), 0);
    }

    function test_registerPayee_ownerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.registerPayee(keccak256("stranger"), address(0x1111), 100e6);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.registerPayee(keccak256("agent"), address(0x2222), 100e6);
    }

    function test_registerPayee_startsCooling() public {
        bytes32 id = keccak256("cooldown-event");
        uint64 registeredAt = uint64(block.timestamp);
        uint64 payableFrom = registeredAt + 86_400;
        vm.expectEmit(true, false, false, true, address(vault));
        emit PolicyVault.PayeeRegistered(id, address(0x1234), 100e6, registeredAt, payableFrom);
        vm.prank(owner);
        vault.registerPayee(id, address(0x1234), 100e6);
        assertEq(vault.payeePayableFrom(id), payableFrom);
    }

    function test_registerPayee_duplicateReverts() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.PayeeExists.selector);
        vault.registerPayee(PAYEE_ID, address(0x1234), 100e6);
    }

    function test_registerPayee_rejectsZeroDailyCap() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.registerPayee(keccak256("zero-cap"), address(0x1234), 0);
    }

    function test_registerPayee_rejectsVaultItself() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAddress.selector);
        vault.registerPayee(keccak256("vault"), address(vault), 100e6);
    }

    function test_constructor_rejectsUnregisteredBot() public {
        bytes32 unknownBot = keccak256("unregistered-bot");
        vm.expectRevert(PolicyVault.ZeroAddress.selector);
        new PolicyVault(IERC20(address(usdc)), trackRecord, owner, agent, unknownBot);
    }

    function test_setCategory_rejectsAbovePilotCeiling() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.BudgetTooLarge.selector);
        vault.setCategory(CATEGORY_ID, 1_000e6 + 1, 1e6, 1_000e6 + 1);
    }

    function test_setCategory_rejectsBadCapOrder() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.CapOrder.selector);
        vault.setCategory(CATEGORY_ID, 20e6, 15e6, 10e6);
        vm.prank(owner);
        vm.expectRevert(PolicyVault.CapOrder.selector);
        vault.setCategory(CATEGORY_ID, 10e6, 5e6, 15e6);
    }

    function test_setAgent_rotatesCallerNotSigner() public {
        _warpPastCooling();
        vm.prank(owner);
        vault.setAgent(rotatedAgent);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory wrongSig,) = _sign(r, uint256(uint160(rotatedAgent)));
        vm.prank(rotatedAgent);
        vm.expectRevert(TrackRecordV2.BadSignature.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, wrongSig);
        (bytes memory originalSig,) = _sign(r, AGENT_PK);
        vm.prank(rotatedAgent);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, originalSig);
        assertEq(trackRecord.lastSeq(BOT_ID), 1);
    }

    function test_pay_happyPath() public {
        _warpPastCooling();
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(payee);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.expectEmit(true, true, true, true, address(vault));
        emit PolicyVault.Paid(PAYEE_ID, CATEGORY_ID, payee, AMOUNT,
            vault.paymentMeta(PAYEE_ID, CATEGORY_ID, AMOUNT), 1, 1);
        vm.prank(agent);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        assertEq(usdc.balanceOf(owner), ownerBefore - AMOUNT);
        assertEq(usdc.balanceOf(payee), payeeBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(trackRecord.lastSeq(BOT_ID), 1);
        assertEq(vault.totalPaidUsdc(), AMOUNT);
        assertEq(vault.paymentCount(), 1);
    }

    function test_pay_metaMismatchReverts() public {
        _warpPastCooling();
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(payee);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        r.metaHash = bytes32(uint256(r.metaHash) ^ 1);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.RecordMismatch.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        _assertNoMovement(ownerBefore, payeeBefore);
    }

    function test_pay_pnlMicrosMismatchReverts() public {
        _warpPastCooling();
        TrackRecordV2.Record memory r = _record(AMOUNT);
        r.pnlMicros++;
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.RecordMismatch.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
    }

    function test_pay_fillsMustBeOne() public {
        _warpPastCooling();
        TrackRecordV2.Record memory r = _record(AMOUNT);
        r.fills = 0;
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.RecordMismatch.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
    }

    function test_pay_badRecordSignatureRevertsWholeTx() public {
        _warpPastCooling();
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(payee);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, STRANGER_PK);
        vm.prank(agent);
        vm.expectRevert(TrackRecordV2.BadSignature.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        _assertNoMovement(ownerBefore, payeeBefore);
    }

    function test_pay_recordSeqReuseReverts() public {
        _warpPastCooling();
        _pay(AMOUNT);
        vm.warp(block.timestamp + 1);
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(payee);
        TrackRecordV2.Record memory replay = _record(AMOUNT);
        replay.seq = 1;
        (bytes memory sig,) = _sign(replay, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(TrackRecordV2.BadSequence.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, replay, sig);
        assertEq(usdc.balanceOf(payee), payeeBefore);
        assertEq(usdc.balanceOf(owner), ownerBefore);
        assertEq(vault.totalPaidUsdc(), AMOUNT);
        assertEq(vault.paymentCount(), 1);
        assertEq(trackRecord.lastSeq(BOT_ID), 1);
    }

    function test_pay_overPerTxCapReverts() public {
        _warpPastCooling();
        TrackRecordV2.Record memory excessive = _record(PER_TX_CAP + 1);
        (bytes memory sig,) = _sign(excessive, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.OverPerTxCap.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, PER_TX_CAP + 1, excessive, sig);
        _configureCategory(EPOCH_BUDGET, PER_TX_CAP, PER_DAY_CAP);
        _pay(PER_TX_CAP);
    }

    function test_pay_overDayCapReverts() public {
        _warpPastCooling();
        _pay(PER_TX_CAP);
        vm.warp(block.timestamp + 1);
        TrackRecordV2.Record memory excessive = _record(PER_TX_CAP);
        (bytes memory sig,) = _sign(excessive, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.OverDayCap.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, PER_TX_CAP, excessive, sig);
        vm.warp(block.timestamp + 1 days);
        _pay(PER_TX_CAP);
    }

    function test_pay_overPayeeDayCapReverts() public {
        bytes32 cappedPayee = keccak256("capped-payee");
        address cappedAccount = address(0xA11CE);
        bytes32 categoryA = keccak256("category-a");
        bytes32 categoryB = keccak256("category-b");
        vm.prank(owner); vault.registerPayee(cappedPayee, cappedAccount, 15e6);
        vm.prank(owner); vault.setCategory(categoryA, 100e6, 10e6, 10e6);
        vm.prank(owner); vault.setCategory(categoryB, 100e6, 10e6, 10e6);
        _warpPastCooling();
        TrackRecordV2.Record memory r = _record(10e6);
        r.metaHash = vault.paymentMeta(cappedPayee, categoryA, 10e6);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent); vault.pay(cappedPayee, categoryA, 10e6, r, sig);
        vm.warp(block.timestamp + 1);
        r = _record(10e6);
        r.metaHash = vault.paymentMeta(cappedPayee, categoryB, 10e6);
        (sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.OverPayeeDayCap.selector);
        vault.pay(cappedPayee, categoryB, 10e6, r, sig);
        assertEq(vault.categoryDaySpent(categoryB, uint64(block.timestamp / 86_400)), 0);
        assertEq(vault.remainingPayeeDayCap(cappedPayee), 5e6);
    }

    function test_pay_payeeDayCapResetsNextDay() public {
        bytes32 cappedPayee = keccak256("daily-reset-payee");
        address cappedAccount = address(0xA11CE);
        vm.prank(owner); vault.registerPayee(cappedPayee, cappedAccount, 10e6);
        _warpPastCooling();
        TrackRecordV2.Record memory r = _record(10e6);
        r.metaHash = vault.paymentMeta(cappedPayee, CATEGORY_ID, 10e6);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent); vault.pay(cappedPayee, CATEGORY_ID, 10e6, r, sig);
        vm.warp(block.timestamp + 1 days);
        r = _record(10e6);
        r.metaHash = vault.paymentMeta(cappedPayee, CATEGORY_ID, 10e6);
        (sig,) = _sign(r, AGENT_PK);
        vm.prank(agent); vault.pay(cappedPayee, CATEGORY_ID, 10e6, r, sig);
        assertEq(vault.payeeDaySpent(cappedPayee, uint64(block.timestamp / 86_400)), 10e6);
    }

    function test_pay_rejectsFuturePeriodEnd() public {
        _warpPastCooling();
        TrackRecordV2.Record memory r = _record(AMOUNT);
        r.periodEnd = uint64(block.timestamp + 1);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.RecordMismatch.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        assertEq(trackRecord.lastSeq(BOT_ID), 0);
    }

    function test_pay_overEpochBudgetReverts() public {
        _configureCategory(30e6, 10e6, 10e6);
        _warpPastCooling();
        _pay(10e6);
        vm.warp(block.timestamp + 1 days);
        _pay(10e6);
        vm.warp(block.timestamp + 1 days);
        _pay(10e6);
        vm.warp(block.timestamp + 1);
        TrackRecordV2.Record memory excessive = _record(1);
        (bytes memory sig,) = _sign(excessive, AGENT_PK);
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.OverEpochBudget.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, 1, excessive, sig);
        vm.warp(block.timestamp + 30 days);
        _pay(10e6);
    }

    function test_pay_dayAndEpochCountersTrackIndependently() public {
        _warpPastCooling();
        _pay(PER_TX_CAP);
        uint128 epochRemaining = vault.remainingEpochBudget(CATEGORY_ID);
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.remainingDayCap(CATEGORY_ID), PER_DAY_CAP);
        assertEq(vault.remainingEpochBudget(CATEGORY_ID), epochRemaining);
    }

    function testFuzz_pay_neverExceedsAnyCap(uint128 a, uint128 b) public {
        _configureCategory(100e6, 50e6, 80e6);
        a = uint128(bound(a, 1, 50e6));
        b = uint128(bound(b, 1, 50e6));
        vm.assume(uint256(a) + b <= 80e6);
        _warpPastCooling();
        _pay(a);
        vm.warp(block.timestamp + 1);
        if (uint256(a) + b <= 80e6) _pay(b);
        uint64 dayIndex = uint64(block.timestamp / 86_400);
        assertLe(vault.categoryDaySpent(CATEGORY_ID, dayIndex), uint128(80e6));
        assertLe(vault.categoryEpochSpent(CATEGORY_ID, vault.currentEpochIndex()), 100e6);
    }

    function test_adversarial_payInsideCoolingWindowReverts() public {
        (, uint64 registeredAt_, , ) = vault.payees(PAYEE_ID);
        vm.warp(uint256(registeredAt_) + 86_399);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.PayeeCooling.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        vm.warp(block.timestamp + 1);
        _pay(AMOUNT);
    }

    function test_adversarial_unregisteredPayeeReverts() public {
        _warpPastCooling();
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(payee);
        bytes32 unknown = keccak256("unknown");
        TrackRecordV2.Record memory r = _record(AMOUNT);
        r.metaHash = vault.paymentMeta(unknown, CATEGORY_ID, AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.PayeeUnknown.selector);
        vault.pay(unknown, CATEGORY_ID, AMOUNT, r, sig);
        _assertNoMovement(ownerBefore, payeeBefore);
    }

    function test_adversarial_promptInjectedPayeeCannotBePaidSameDay() public {
        address attacker = address(0xBAD);
        bytes32 attackerId = keccak256("attacker");
        vm.prank(owner);
        vault.registerPayee(attackerId, attacker, 100e6);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        r.metaHash = vault.paymentMeta(attackerId, CATEGORY_ID, AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.PayeeCooling.selector);
        vault.pay(attackerId, CATEGORY_ID, AMOUNT, r, sig);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_adversarial_pausedBlocksAgent() public {
        vm.prank(owner);
        vault.setPaused(true);
        (bool ok, uint8 code) = vault.canPay(PAYEE_ID, CATEGORY_ID, AMOUNT);
        assertFalse(ok);
        assertEq(code, 1);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.Paused.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
    }

    function test_adversarial_agentCannotRegisterPayeeOrSetCategory() public {
        vm.prank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.registerPayee(keccak256("agent-payee"), address(0x1111), 100e6);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.setCategory(CATEGORY_ID, 10e6, 5e6, 10e6);
    }

    function test_adversarial_agentCannotSpendAboveAllowance() public {
        _warpPastCooling();
        vm.prank(owner);
        usdc.approve(address(vault), AMOUNT - 1);
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(payee);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert();
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        _assertNoMovement(ownerBefore, payeeBefore);
    }

    function test_adversarial_ownerApproveZeroBlocksEverything() public {
        _warpPastCooling();
        vm.prank(owner);
        usdc.approve(address(vault), 0);
        (bool ok, uint8 code) = vault.canPay(PAYEE_ID, CATEGORY_ID, AMOUNT);
        assertFalse(ok);
        assertEq(code, 10);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert();
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
        assertEq(trackRecord.lastSeq(BOT_ID), 0);
    }

    function test_adversarial_blocklistedPayeeRevertsAtomically() public {
        MockUsdcBlocklist blockedUsdc = new MockUsdcBlocklist();
        TrackRecordV2 tr = new TrackRecordV2();
        tr.registerBot(BOT_ID, TrackRecordV2.BotKind.OTHER, agent);
        PolicyVault blockedVault = new PolicyVault(IERC20(address(blockedUsdc)), tr, owner, agent, BOT_ID);
        blockedUsdc.mint(owner, 100e6);
        vm.prank(owner);
        blockedUsdc.approve(address(blockedVault), 100e6);
        vm.prank(owner);
        blockedVault.setCategory(CATEGORY_ID, 100e6, 50e6, 80e6);
        vm.prank(owner);
        blockedVault.registerPayee(PAYEE_ID, payee, 100e6);
        vm.warp(block.timestamp + 86_400);
        blockedUsdc.setBlocked(payee, true);
        TrackRecordV2.Record memory r = TrackRecordV2.Record({
            seq: 1, periodStart: tr.lastPeriodEnd(BOT_ID) + 1,
            periodEnd: uint64(block.timestamp), pnlMicros: -int128(AMOUNT), fills: 1,
            metaHash: blockedVault.paymentMeta(PAYEE_ID, CATEGORY_ID, AMOUNT),
            evidenceUri: "ipfs://blocked", evidenceHash: keccak256("blocked"),
            prevRecordHash: tr.lastRecordHash(BOT_ID)
        });
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", tr.DOMAIN_SEPARATOR(), _structHash(r))
        );
        (uint8 v, bytes32 rsig, bytes32 ssig) = vm.sign(AGENT_PK, digest);
        vm.prank(agent);
        vm.expectRevert();
        blockedVault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, abi.encodePacked(rsig, ssig, v));
        assertEq(tr.lastSeq(BOT_ID), 0);
        assertEq(blockedVault.categoryDaySpent(CATEGORY_ID, uint64(block.timestamp / 86_400)), 0);
        assertEq(blockedVault.categoryEpochSpent(CATEGORY_ID, blockedVault.currentEpochIndex()), 0);
    }

    function test_adversarial_deactivatedPayeeBlocked() public {
        _warpPastCooling();
        _pay(AMOUNT);
        vm.prank(owner);
        vault.deactivatePayee(PAYEE_ID);
        vm.warp(block.timestamp + 1);
        TrackRecordV2.Record memory r = _record(AMOUNT);
        (bytes memory sig,) = _sign(r, AGENT_PK);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.PayeeInactive.selector);
        vault.pay(PAYEE_ID, CATEGORY_ID, AMOUNT, r, sig);
    }

    function test_invariant_sumOfPnlMicrosEqualsNegativeTotalPaid() public {
        _warpPastCooling();
        _pay(AMOUNT);
        vm.warp(block.timestamp + 1);
        _pay(2 * AMOUNT);
        vm.warp(block.timestamp + 1);
        _pay(3 * AMOUNT);
        int256 pnl;
        for (uint256 i; i < trackRecord.recordCount(BOT_ID); i++) {
            pnl += trackRecord.recordAt(BOT_ID, i).pnlMicros;
        }
        assertEq(pnl, -int256(vault.totalPaidUsdc()));
    }

    function test_canPay_codes_payeeStates() public {
        {
            (bool ok, uint8 code) = (false, 0);
            bytes32 pausedPayee = keccak256("paused-code-payee");
            bytes32 pausedCategory = keccak256("paused-code-category");
            vm.prank(owner); vault.registerPayee(pausedPayee, address(0x1001), 100e6);
            vm.prank(owner); vault.setCategory(pausedCategory, 100e6, 50e6, 80e6);
            vm.warp(block.timestamp + 86_400);
            vm.prank(owner); vault.setPaused(true);
            (ok, code) = vault.canPay(pausedPayee, pausedCategory, AMOUNT);
            assertFalse(ok); assertEq(code, 1);
            vm.prank(owner); vault.setPaused(false);
        }
        {
            bytes32 unknownCategory = keccak256("unknown-payee-category");
            vm.prank(owner); vault.setCategory(unknownCategory, 100e6, 50e6, 80e6);
            (bool ok, uint8 code) = vault.canPay(keccak256("never-registered-code-payee"), unknownCategory, AMOUNT);
            assertFalse(ok); assertEq(code, 2);
        }
        {
            bytes32 inactivePayee = keccak256("inactive-code-payee");
            bytes32 inactiveCategory = keccak256("inactive-code-category");
            vm.prank(owner); vault.registerPayee(inactivePayee, address(0x1003), 100e6);
            vm.prank(owner); vault.setCategory(inactiveCategory, 100e6, 50e6, 80e6);
            vm.warp(block.timestamp + 86_400);
            vm.prank(owner); vault.deactivatePayee(inactivePayee);
            (bool ok, uint8 code) = vault.canPay(inactivePayee, inactiveCategory, AMOUNT);
            assertFalse(ok); assertEq(code, 3);
        }
        {
            bytes32 coolingPayee = keccak256("cooling-code-payee");
            bytes32 coolingCategory = keccak256("cooling-code-category");
            vm.prank(owner); vault.registerPayee(coolingPayee, address(0x1004), 100e6);
            vm.prank(owner); vault.setCategory(coolingCategory, 100e6, 50e6, 80e6);
            (bool ok, uint8 code) = vault.canPay(coolingPayee, coolingCategory, AMOUNT);
            assertFalse(ok); assertEq(code, 4);
        }
    }

    function test_canPay_codes_categoryAndPerTx() public {
        {
            bytes32 unknownCategoryPayee = keccak256("unknown-category-code-payee");
            vm.prank(owner); vault.registerPayee(unknownCategoryPayee, address(0x1005), 100e6);
            vm.warp(block.timestamp + 86_400);
            (bool ok, uint8 code) = vault.canPay(unknownCategoryPayee, keccak256("never-set-code-category"), AMOUNT);
            assertFalse(ok); assertEq(code, 5);
        }
        {
            bytes32 txPayee = keccak256("tx-cap-code-payee");
            bytes32 txCategory = keccak256("tx-cap-code-category");
            vm.prank(owner); vault.registerPayee(txPayee, address(0x1006), 100e6);
            vm.prank(owner); vault.setCategory(txCategory, 20e6, 5e6, 20e6);
            vm.warp(block.timestamp + 86_400);
            (bool ok, uint8 code) = vault.canPay(txPayee, txCategory, 6e6);
            assertFalse(ok); assertEq(code, 6);
        }
    }

    function test_canPay_codes_velocityAndBudget() public {
        {
            bytes32 payeeCapPayee = keccak256("payee-day-code-payee");
            bytes32 payeeCapCategoryA = keccak256("payee-day-code-category-a");
            bytes32 payeeCapCategoryB = keccak256("payee-day-code-category-b");
            vm.prank(owner); vault.registerPayee(payeeCapPayee, address(0x1007), 10e6);
            vm.prank(owner); vault.setCategory(payeeCapCategoryA, 100e6, 50e6, 100e6);
            vm.prank(owner); vault.setCategory(payeeCapCategoryB, 100e6, 50e6, 100e6);
            vm.warp(block.timestamp + 86_400);
            TrackRecordV2.Record memory r = _record(10e6);
            r.metaHash = vault.paymentMeta(payeeCapPayee, payeeCapCategoryA, 10e6);
            (bytes memory sig,) = _sign(r, AGENT_PK);
            vm.prank(agent); vault.pay(payeeCapPayee, payeeCapCategoryA, 10e6, r, sig);
            vm.warp(block.timestamp + 1);
            (bool ok, uint8 code) = vault.canPay(payeeCapPayee, payeeCapCategoryB, 1);
            assertFalse(ok); assertEq(code, 7);
        }
        {
            bytes32 dayPayee = keccak256("category-day-code-payee");
            bytes32 dayCategory = keccak256("category-day-code-category");
            vm.prank(owner); vault.registerPayee(dayPayee, address(0x1008), 100e6);
            vm.prank(owner); vault.setCategory(dayCategory, 100e6, 10e6, 10e6);
            vm.warp(block.timestamp + 86_400);
            TrackRecordV2.Record memory r = _record(10e6);
            r.metaHash = vault.paymentMeta(dayPayee, dayCategory, 10e6);
            (bytes memory sig,) = _sign(r, AGENT_PK);
            vm.prank(agent); vault.pay(dayPayee, dayCategory, 10e6, r, sig);
            vm.warp(block.timestamp + 1);
            (bool ok, uint8 code) = vault.canPay(dayPayee, dayCategory, 1);
            assertFalse(ok); assertEq(code, 8);
        }
        {
            bytes32 epochPayee = keccak256("epoch-code-payee");
            bytes32 epochCategory = keccak256("epoch-code-category");
            vm.prank(owner); vault.registerPayee(epochPayee, address(0x1009), 100e6);
            vm.prank(owner); vault.setCategory(epochCategory, 20e6, 10e6, 10e6);
            vm.warp(block.timestamp + 86_400);
            TrackRecordV2.Record memory r = _record(10e6);
            r.metaHash = vault.paymentMeta(epochPayee, epochCategory, 10e6);
            (bytes memory sig,) = _sign(r, AGENT_PK);
            vm.prank(agent); vault.pay(epochPayee, epochCategory, 10e6, r, sig);
            vm.warp(block.timestamp + 1 days);
            r = _record(10e6);
            r.metaHash = vault.paymentMeta(epochPayee, epochCategory, 10e6);
            (sig,) = _sign(r, AGENT_PK);
            vm.prank(agent); vault.pay(epochPayee, epochCategory, 10e6, r, sig);
            vm.warp(block.timestamp + 1 days);
            (bool ok, uint8 code) = vault.canPay(epochPayee, epochCategory, 1);
            assertFalse(ok); assertEq(code, 9);
        }
    }

    function test_canPay_codes_spendableAndOk() public {
        {
            bytes32 spendablePayee = keccak256("spendable-code-payee");
            bytes32 spendableCategory = keccak256("spendable-code-category");
            vm.prank(owner); vault.registerPayee(spendablePayee, address(0x1010), 100e6);
            vm.prank(owner); vault.setCategory(spendableCategory, 100e6, 50e6, 80e6);
            vm.warp(block.timestamp + 86_400);
            (bool ok, uint8 code) = vault.canPay(spendablePayee, spendableCategory, AMOUNT);
            assertTrue(ok); assertEq(code, 0);
            vm.prank(owner); usdc.approve(address(vault), 0);
            (ok, code) = vault.canPay(spendablePayee, spendableCategory, 1);
            assertFalse(ok); assertEq(code, 10);
        }
    }

    function test_ownerSpendable_isMinOfBalanceAndAllowance() public {
        vm.prank(owner); usdc.approve(address(vault), 20e6);
        assertEq(vault.ownerSpendable(), 20e6);
        vm.prank(owner); usdc.approve(address(vault), type(uint256).max);
        assertEq(vault.ownerSpendable(), usdc.balanceOf(owner));
    }
}

