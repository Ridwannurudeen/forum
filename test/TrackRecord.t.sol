// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TrackRecord} from "../src/TrackRecord.sol";

contract TrackRecordTest is Test {
    TrackRecord tr;
    bytes32 constant BOT = keccak256("bot-1");
    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;

    bytes32 constant RECORD_TYPEHASH = keccak256(
        "Record(bytes32 botId,uint8 kind,uint64 ts,int128 pnlMicros,uint64 fills,bytes32 metaHash)"
    );

    function setUp() public {
        tr = new TrackRecord();
        signer = vm.addr(SIGNER_PK);
    }

    function _sign(bytes32 botId, TrackRecord.BotKind kind, TrackRecord.Record memory r)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(RECORD_TYPEHASH, botId, uint8(kind), r.ts, r.pnlMicros, r.fills, r.metaHash)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", tr.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rsig, bytes32 ssig) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(rsig, ssig, v);
    }

    function test_registerAndPublish() public {
        tr.registerBot(BOT, TrackRecord.BotKind.MAKER, signer);
        TrackRecord.Record memory rec = TrackRecord.Record({
            ts: uint64(block.timestamp),
            pnlMicros: int128(1_500_000),
            fills: 7,
            metaHash: bytes32(uint256(0xfeed))
        });
        bytes memory sig = _sign(BOT, TrackRecord.BotKind.MAKER, rec);
        tr.publish(BOT, rec, sig);
        assertEq(tr.recordCount(BOT), 1);
        TrackRecord.Record memory got = tr.recordAt(BOT, 0);
        assertEq(got.pnlMicros, rec.pnlMicros);
        assertEq(got.fills, rec.fills);
    }

    function test_publish_bad_sig_reverts() public {
        tr.registerBot(BOT, TrackRecord.BotKind.MAKER, signer);
        TrackRecord.Record memory rec = TrackRecord.Record({
            ts: uint64(block.timestamp), pnlMicros: 0, fills: 0, metaHash: bytes32(0)
        });
        bytes memory badSig = new bytes(65);
        vm.expectRevert(TrackRecord.BadSignature.selector);
        tr.publish(BOT, rec, badSig);
    }

    function test_publish_unregistered_reverts() public {
        TrackRecord.Record memory rec;
        bytes memory sig = new bytes(65);
        vm.expectRevert(TrackRecord.NotRegistered.selector);
        tr.publish(BOT, rec, sig);
    }

    function test_register_twice_reverts() public {
        tr.registerBot(BOT, TrackRecord.BotKind.MAKER, signer);
        vm.expectRevert(TrackRecord.AlreadyRegistered.selector);
        tr.registerBot(BOT, TrackRecord.BotKind.TAKER, signer);
    }

    function test_register_zero_signer_reverts() public {
        vm.expectRevert(TrackRecord.ZeroAddress.selector);
        tr.registerBot(BOT, TrackRecord.BotKind.MAKER, address(0));
    }

    function test_negative_pnl() public {
        tr.registerBot(BOT, TrackRecord.BotKind.MAKER, signer);
        TrackRecord.Record memory rec = TrackRecord.Record({
            ts: uint64(block.timestamp), pnlMicros: -2_130_000, fills: 12, metaHash: bytes32(uint256(0xbad))
        });
        bytes memory sig = _sign(BOT, TrackRecord.BotKind.MAKER, rec);
        tr.publish(BOT, rec, sig);
        assertEq(tr.recordAt(BOT, 0).pnlMicros, -2_130_000);
    }
}
