// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployCovenantCore} from "../script/DeployCovenantCore.s.sol";
import {DeployCovenantAccount} from "../script/DeployCovenantAccount.s.sol";
import {RiskKernelV2} from "../src/RiskKernelV2.sol";
import {CovenantVaultFactoryV2} from "../src/CovenantVaultFactoryV2.sol";
import {CapitalRouter} from "../src/CapitalRouter.sol";
import {FeeRouterV1} from "../src/FeeRouterV1.sol";
import {CovenantVault, IERC20} from "../src/CovenantVault.sol";
import {CovenantVaultV3} from "../src/CovenantVaultV3.sol";
import {SlashBond} from "../src/SlashBond.sol";
import {TrackRecordV2} from "../src/TrackRecordV2.sol";

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

/// End-to-end run of the two mainnet deploy scripts against the real
/// contracts (only USDC is mocked): core -> account -> bond -> deposit ->
/// publish -> pullCredit -> stale -> enforce pauses and slashes.
contract CovenantMainnetFlowTest is Test {
    // The deployer key IS the operator / keeper signer. vm.addr(0xA11CE) =
    // 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7 (mixed case, so the
    // lowercasing in botIdFor is actually exercised).
    uint256 constant DEPLOYER_PK = 0xA11CE;

    // Reference values computed with viem:
    //   keccak256(toHex(`${address.toLowerCase()}:${label}`))
    // written as two 16-byte halves.
    bytes32 constant VIEM_BOT_ID_DEMO_LIVE = bytes32(
        (uint256(0x2abc604d40cbe202ccbb8c6f80d79582) << 128) | uint256(0x0c5bce877c46e954d78aad777c9465ff)
    );
    bytes32 constant VIEM_BOT_ID_MAINNET_KEEPER = bytes32(
        (uint256(0x17a1d898537aee56c8a9393739ce9e32) << 128) | uint256(0x21148485fa7a75481c9de5ce4c1ae73e)
    );
    // anvil account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) + "demo-live-v1":
    // the value `forge script` logs when run against a local anvil.
    bytes32 constant VIEM_BOT_ID_ANVIL0_DEMO_LIVE = bytes32(
        (uint256(0x8a66245352bd1a224f223082f704b87b) << 128) | uint256(0x7834bdbff3a9af11f75d26efd2bcd8b4)
    );

    string constant LABEL = "demo-live-v1";
    uint128 constant BUDGET = 2e6;
    uint32 constant FRESHNESS = 1800;
    uint256 constant BOND_AMOUNT = 2e6;
    uint256 constant DEPOSIT_AMOUNT = 5e6;

    bytes32 constant RECORD_TYPEHASH = keccak256(
        "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)"
    );

    MockUsdc usdc;
    TrackRecordV2 tr;
    DeployCovenantAccount accountScript;

    RiskKernelV2 kernel;
    CovenantVaultFactoryV2 factory;
    CapitalRouter router;
    FeeRouterV1 feeRouter;

    SlashBond bond;
    CovenantVaultV3 vault;
    bytes32 botId;

    address operator;
    address strategist = address(0x57A7);
    address slashRecipient = address(0x5A5E);
    address depositor = address(0xDE90);

    function setUp() public {
        vm.warp(1_760_000_000); // forge's default timestamp is 1; records need a real clock
        operator = vm.addr(DEPLOYER_PK);
        usdc = new MockUsdc();
        tr = new TrackRecordV2();
        accountScript = new DeployCovenantAccount();

        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(DEPLOYER_PK));
        vm.setEnv("ARC_USDC_ADDRESS", vm.toString(address(usdc)));
        vm.setEnv("STRATEGIST", vm.toString(strategist));
        (kernel, factory, router, feeRouter) = new DeployCovenantCore().run();

        vm.setEnv("RISK_KERNEL", vm.toString(address(kernel)));
        vm.setEnv("FACTORY_V2", vm.toString(address(factory)));
        vm.setEnv("TRACK_RECORD_V2", vm.toString(address(tr)));
        vm.setEnv("SLASH_RECIPIENT", vm.toString(slashRecipient));
        vm.setEnv("KEEPER_LABEL", LABEL);
        vm.setEnv("BUDGET_USDC", vm.toString(uint256(BUDGET)));
        vm.setEnv("RECEIPT_FRESHNESS_SEC", vm.toString(uint256(FRESHNESS)));
        (bond, vault, botId) = accountScript.run();

        usdc.mint(operator, 100e6);
        usdc.mint(depositor, 100e6);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _bond(uint256 amount) internal {
        vm.prank(operator); usdc.approve(address(bond), amount);
        vm.prank(operator); bond.bond(amount);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(depositor); usdc.approve(address(vault), amount);
        vm.prank(depositor); vault.deposit(amount);
    }

    function _signedRecord(uint64 periodStart, uint64 periodEnd)
        internal
        view
        returns (TrackRecordV2.Record memory r, bytes memory sig)
    {
        r = TrackRecordV2.Record({
            seq: 1,
            periodStart: periodStart,
            periodEnd: periodEnd,
            pnlMicros: 250_000,
            fills: 3,
            metaHash: keccak256("meta"),
            evidenceUri: "https://receipts.example/demo-live-v1/1.json",
            evidenceHash: keccak256("evidence"),
            prevRecordHash: bytes32(0)
        });
        bytes32 structHash = keccak256(
            abi.encode(
                RECORD_TYPEHASH,
                botId,
                uint8(TrackRecordV2.BotKind.MAKER),
                r.seq,
                r.periodStart,
                r.periodEnd,
                r.pnlMicros,
                r.fills,
                r.metaHash,
                keccak256(bytes(r.evidenceUri)),
                r.evidenceHash,
                r.prevRecordHash
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", tr.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(DEPLOYER_PK, digest);
        sig = abi.encodePacked(rs, ss, v);
    }

    function _registerAndPublish() internal {
        // forum-v2.ts ensureRegistered() defaults to kind 0 = MAKER, signer = the keeper key.
        tr.registerBot(botId, TrackRecordV2.BotKind.MAKER, operator);
        uint64 now_ = uint64(block.timestamp);
        (TrackRecordV2.Record memory r, bytes memory sig) = _signedRecord(now_ - 600, now_);
        tr.publish(botId, r, sig);
        assertEq(tr.recordCount(botId), 1);
    }

    // ------------------------------------------------------------------
    // wiring produced by the scripts
    // ------------------------------------------------------------------

    function test_botId_helper_matches_viem() public view {
        assertEq(accountScript.botIdFor(operator, "demo-live-v1"), VIEM_BOT_ID_DEMO_LIVE);
        assertEq(accountScript.botIdFor(operator, "mainnet-keeper-v1"), VIEM_BOT_ID_MAINNET_KEEPER);
        assertEq(
            accountScript.botIdFor(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, "demo-live-v1"),
            VIEM_BOT_ID_ANVIL0_DEMO_LIVE
        );
        assertEq(botId, VIEM_BOT_ID_DEMO_LIVE);
    }

    function test_scripts_wire_the_account_to_the_core() public view {
        assertEq(address(factory.usdc()), address(usdc));
        assertEq(address(router.usdc()), address(usdc));
        assertEq(router.strategist(), strategist);
        assertEq(address(feeRouter.usdc()), address(usdc));

        assertEq(bond.operator(), operator);
        assertEq(bond.attestor(), address(kernel));
        assertEq(bond.recipient(), slashRecipient);
        assertEq(bond.botId(), botId);
        assertEq(bond.unbondDelay(), 86_400);

        (
            address mOperator,
            bytes32 mBotId,
            uint128 mBudget,
            uint16 mDrawdown,
            uint32 mFreshness,
            uint64 mExpiry,
            uint16 mPerfFee,
            address mBond,
            address mKernel,
            address mTr
        ) = vault.mandate();
        assertEq(mOperator, operator);
        assertEq(mBotId, botId);
        assertEq(mBudget, BUDGET);
        assertEq(mDrawdown, 500);
        assertEq(mFreshness, FRESHNESS);
        assertEq(mExpiry, 0);
        assertEq(mPerfFee, 2_000);
        assertEq(mBond, address(bond));
        assertEq(mKernel, address(kernel));
        assertEq(mTr, address(tr));
        assertEq(address(vault.usdc()), address(usdc));

        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), address(vault));
        assertEq(factory.vaultsByOperator(operator)[0], address(vault));
        assertEq(factory.vaultsByBotId(botId)[0], address(vault));
        assertEq(factory.vaultsByCreator(operator)[0], address(vault));
    }

    // ------------------------------------------------------------------
    // the mainnet operating loop
    // ------------------------------------------------------------------

    function test_zero_records_is_allow_and_enforce_is_noop() public {
        assertEq(uint8(kernel.evaluate(address(vault))), uint8(RiskKernelV2.Verdict.ALLOW));
        kernel.enforce(address(vault));
        assertEq(uint8(vault.state()), uint8(CovenantVault.State.ACTIVE));
    }

    function test_pullCredit_reverts_UnderBonded_when_bond_below_budget() public {
        _deposit(DEPOSIT_AMOUNT);
        _bond(BOND_AMOUNT - 1);
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.UnderBonded.selector);
        vault.pullCredit(1e6);
    }

    function test_pullCredit_reverts_BondMismatch_when_bond_attestor_is_not_the_kernel() public {
        SlashBond foreign = new SlashBond(bond.usdc(), operator, address(0xBAD), slashRecipient, botId, 86_400);
        vm.prank(operator); usdc.approve(address(foreign), BOND_AMOUNT);
        vm.prank(operator); foreign.bond(BOND_AMOUNT);
        vm.prank(operator);
        CovenantVaultV3 mismatched = CovenantVaultV3(
            factory.createVault(
                CovenantVault.Mandate({
                    operator: operator,
                    botId: botId,
                    budgetUsdc: BUDGET,
                    maxDrawdownBps: 500,
                    receiptFreshnessSec: FRESHNESS,
                    expiry: 0,
                    perfFeeBps: 2_000,
                    bondContract: address(foreign),
                    riskKernel: address(kernel),
                    trackRecordV2: address(tr)
                })
            )
        );
        vm.prank(depositor); usdc.approve(address(mismatched), DEPOSIT_AMOUNT);
        vm.prank(depositor); mismatched.deposit(DEPOSIT_AMOUNT);
        vm.prank(operator);
        vm.expectRevert(CovenantVaultV3.BondMismatch.selector);
        mismatched.pullCredit(1e6);
    }

    function test_full_flow_bond_deposit_publish_pull_stale_slash() public {
        _bond(BOND_AMOUNT);
        assertEq(bond.bondBalance(), BOND_AMOUNT);

        _deposit(DEPOSIT_AMOUNT);
        assertEq(vault.depositTotalIdle(), DEPOSIT_AMOUNT);
        assertEq(vault.sharesOf(depositor), DEPOSIT_AMOUNT);

        _registerAndPublish();
        assertEq(uint8(kernel.evaluate(address(vault))), uint8(RiskKernelV2.Verdict.ALLOW));

        uint256 operatorBefore = usdc.balanceOf(operator);
        vm.prank(operator);
        vault.pullCredit(1e6);
        assertEq(vault.operatorOutstanding(), 1e6);
        assertEq(vault.depositTotalIdle(), DEPOSIT_AMOUNT - 1e6);
        assertEq(usdc.balanceOf(operator), operatorBefore + 1e6);

        // Keeper goes quiet: warp past the freshness window.
        vm.warp(block.timestamp + FRESHNESS + 1);
        assertEq(uint8(kernel.evaluate(address(vault))), uint8(RiskKernelV2.Verdict.PAUSE_STALE));

        uint256 recipientBefore = usdc.balanceOf(slashRecipient);
        uint256 operatorBeforeSlash = usdc.balanceOf(operator);
        uint256 expectedSlash = BOND_AMOUNT * kernel.SLASH_BPS_PER_VIOLATION() / 10_000;

        vm.expectEmit(true, false, false, true, address(kernel));
        emit RiskKernelV2.Enforced(address(vault), RiskKernelV2.Verdict.PAUSE_STALE, CovenantVault.State.PAUSED, expectedSlash);
        kernel.enforce(address(vault));

        assertEq(uint8(vault.state()), uint8(CovenantVault.State.PAUSED));
        assertEq(expectedSlash, 500_000);
        assertEq(bond.bondBalance(), BOND_AMOUNT - expectedSlash);
        assertEq(bond.totalSlashed(), expectedSlash);
        assertTrue(slashRecipient != operator);
        assertEq(usdc.balanceOf(slashRecipient) - recipientBefore, expectedSlash);
        assertEq(usdc.balanceOf(operator), operatorBeforeSlash);

        // Paused vault refuses further credit; depositors can still exit.
        vm.prank(operator);
        vm.expectRevert(CovenantVault.MandateNotActive.selector);
        vault.pullCredit(1);
        vm.prank(depositor);
        vault.withdraw(1e6);
    }
}
