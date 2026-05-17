// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TrackRecordV2} from "../src/TrackRecordV2.sol";

contract TrackRecordV2Test is Test {
    TrackRecordV2 tr;
    bytes32 constant BOT = keccak256("bot-v2-1");
    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;

    bytes32 constant RECORD_TYPEHASH = keccak256(
        "RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)"
    );

    function setUp() public {
        tr = new TrackRecordV2();
        signer = vm.addr(SIGNER_PK);
    }

    function _sign(
        bytes32 botId,
        TrackRecordV2.BotKind kind,
        TrackRecordV2.Record memory r
    ) internal view returns (bytes memory, bytes32 digest) {
        bytes32 evidenceUriHash = keccak256(bytes(r.evidenceUri));
        bytes32 structHash = keccak256(
            abi.encode(
                RECORD_TYPEHASH,
                botId,
                uint8(kind),
                r.seq,
                r.periodStart,
                r.periodEnd,
                r.pnlMicros,
                r.fills,
                r.metaHash,
                evidenceUriHash,
                r.evidenceHash,
                r.prevRecordHash
            )
        );
        digest = keccak256(abi.encodePacked("\x19\x01", tr.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rsig, bytes32 ssig) = vm.sign(SIGNER_PK, digest);
        return (abi.encodePacked(rsig, ssig, v), digest);
    }

    function _record(
        uint64 seq,
        uint64 start,
        uint64 end,
        int128 pnl,
        bytes32 prevHash
    ) internal pure returns (TrackRecordV2.Record memory) {
        return TrackRecordV2.Record({
            seq: seq,
            periodStart: start,
            periodEnd: end,
            pnlMicros: pnl,
            fills: 1,
            metaHash: keccak256("meta"),
            evidenceUri: "ipfs://bafyEvidence",
            evidenceHash: keccak256("evidence"),
            prevRecordHash: prevHash
        });
    }

    function test_register_then_publish_first_record() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(1, 100, 200, 500_000, bytes32(0));
        (bytes memory sig, bytes32 digest) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r);
        tr.publish(BOT, r, sig);
        assertEq(tr.recordCount(BOT), 1);
        assertEq(tr.lastSeq(BOT), 1);
        assertEq(tr.lastPeriodEnd(BOT), 200);
        assertEq(tr.lastRecordHash(BOT), digest);
    }

    function test_publish_chains_correctly() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r1 = _record(1, 100, 200, 500_000, bytes32(0));
        (bytes memory sig1, bytes32 digest1) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r1);
        tr.publish(BOT, r1, sig1);

        TrackRecordV2.Record memory r2 = _record(2, 201, 300, 750_000, digest1);
        (bytes memory sig2, bytes32 digest2) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r2);
        tr.publish(BOT, r2, sig2);

        assertEq(tr.recordCount(BOT), 2);
        assertEq(tr.lastSeq(BOT), 2);
        assertEq(tr.lastRecordHash(BOT), digest2);
    }

    function test_publish_rejects_bad_sequence() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(2, 100, 200, 0, bytes32(0));
        (bytes memory sig, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r);
        vm.expectRevert(TrackRecordV2.BadSequence.selector);
        tr.publish(BOT, r, sig);
    }

    function test_publish_rejects_overlapping_period() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r1 = _record(1, 100, 200, 0, bytes32(0));
        (bytes memory sig1, bytes32 digest1) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r1);
        tr.publish(BOT, r1, sig1);

        // periodStart=200 overlaps lastPeriodEnd=200 — must be strictly after
        TrackRecordV2.Record memory r2 = _record(2, 200, 300, 0, digest1);
        (bytes memory sig2, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r2);
        vm.expectRevert(TrackRecordV2.BadTimeWindow.selector);
        tr.publish(BOT, r2, sig2);
    }

    function test_publish_rejects_period_end_before_start() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(1, 200, 100, 0, bytes32(0));
        (bytes memory sig, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r);
        vm.expectRevert(TrackRecordV2.BadTimeWindow.selector);
        tr.publish(BOT, r, sig);
    }

    function test_publish_rejects_broken_hash_chain() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r1 = _record(1, 100, 200, 0, bytes32(0));
        (bytes memory sig1, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r1);
        tr.publish(BOT, r1, sig1);

        // r2 claims prevRecordHash = zero (wrong; should be hash of r1)
        TrackRecordV2.Record memory r2 = _record(2, 201, 300, 0, bytes32(0));
        (bytes memory sig2, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r2);
        vm.expectRevert(TrackRecordV2.BadHashChain.selector);
        tr.publish(BOT, r2, sig2);
    }

    function test_publish_rejects_replay() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(1, 100, 200, 500_000, bytes32(0));
        (bytes memory sig, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r);
        tr.publish(BOT, r, sig);
        // Replay the same signed record — must be rejected (bad seq, not even replay)
        vm.expectRevert(TrackRecordV2.BadSequence.selector);
        tr.publish(BOT, r, sig);
    }

    function test_publish_rejects_unregistered() public {
        TrackRecordV2.Record memory r = _record(1, 100, 200, 0, bytes32(0));
        bytes memory sig = new bytes(65);
        vm.expectRevert(TrackRecordV2.NotRegistered.selector);
        tr.publish(BOT, r, sig);
    }

    function test_publish_rejects_bad_signature() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(1, 100, 200, 0, bytes32(0));
        bytes memory badSig = new bytes(65);
        vm.expectRevert(TrackRecordV2.BadSignature.selector);
        tr.publish(BOT, r, badSig);
    }

    function test_anyone_can_relay() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(1, 100, 200, 0, bytes32(0));
        (bytes memory sig, ) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r);
        // Relay from a random EOA — must still succeed because sig is the auth
        vm.prank(address(0xBEEF));
        tr.publish(BOT, r, sig);
        assertEq(tr.recordCount(BOT), 1);
    }

    function test_recordAt_returns_stored_evidence_hash() public {
        tr.registerBot(BOT, TrackRecordV2.BotKind.MAKER, signer);
        TrackRecordV2.Record memory r = _record(1, 100, 200, 500_000, bytes32(0));
        (bytes memory sig, bytes32 digest) = _sign(BOT, TrackRecordV2.BotKind.MAKER, r);
        tr.publish(BOT, r, sig);
        TrackRecordV2.StoredRecord memory s = tr.recordAt(BOT, 0);
        assertEq(s.seq, 1);
        assertEq(s.evidenceUriHash, keccak256(bytes(r.evidenceUri)));
        assertEq(s.evidenceHash, r.evidenceHash);
        assertEq(s.recordHash, digest);
    }
}
