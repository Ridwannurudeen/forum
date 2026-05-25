// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault} from "./CovenantVault.sol";

/// @title RiskKernelV2
/// @notice v1.1 of RiskKernel that, in addition to pausing CovenantVault on
///         violation, ALSO calls SlashBond.slash() in the same transaction
///         when the violation is an operator-fault (not just expiry).
///
///         This closes the v1 caveat: pause→slash is now fully autonomous,
///         no manual operator call needed.
///
///         Designed to be deployed alongside a NEW SlashBond whose
///         `attestor` is this RiskKernelV2's own address. Old v1 contracts
///         stay deployed; this is the v1.1 evolution path.
///
///         Slash policy (v1.1): 25% of current bondBalance per violation,
///         capped at bond balance. Reason = bytes32(uint256(verdict)).
interface ITrackRecordV2 {
    struct StoredRecord {
        uint64 seq;
        uint64 periodStart;
        uint64 periodEnd;
        int128 pnlMicros;
        uint64 fills;
        bytes32 metaHash;
        bytes32 evidenceUriHash;
        bytes32 evidenceHash;
        bytes32 recordHash;
    }
    function recordCount(bytes32 botId) external view returns (uint256);
    function recordAt(bytes32 botId, uint256 idx) external view returns (StoredRecord memory);
}

interface ISlashBond {
    function bondBalance() external view returns (uint256);
    function operator() external view returns (address);
    function attestor() external view returns (address);
    function botId() external view returns (bytes32);
    function slash(uint256 amount, bytes32 reason) external;
}

contract RiskKernelV2 {
    enum Verdict {
        ALLOW,
        PAUSE_DRAWDOWN,
        PAUSE_OVERSUBSCRIBED,
        PAUSE_STALE,
        PAUSE_EXPIRED
    }

    uint16 public constant SLASH_BPS_PER_VIOLATION = 2_500; // 25%

    event Enforced(
        address indexed vault,
        Verdict verdict,
        CovenantVault.State newState,
        uint256 slashedUsdc
    );

    function evaluate(address vaultAddr) public view returns (Verdict) {
        CovenantVault vault = CovenantVault(vaultAddr);
        (
            ,
            bytes32 botId,
            uint128 budgetUsdc,
            uint16 maxDrawdownBps,
            uint32 receiptFreshnessSec,
            uint64 expiry,
            ,
            ,
            ,
            address trackRecordV2
        ) = vault.mandate();

        if (expiry != 0 && block.timestamp >= expiry) return Verdict.PAUSE_EXPIRED;
        if (vault.operatorOutstanding() > budgetUsdc) return Verdict.PAUSE_OVERSUBSCRIBED;

        ITrackRecordV2 tr = ITrackRecordV2(trackRecordV2);
        uint256 count = tr.recordCount(botId);
        if (count == 0) return Verdict.ALLOW;

        ITrackRecordV2.StoredRecord memory last = tr.recordAt(botId, count - 1);
        if (receiptFreshnessSec != 0 && block.timestamp > uint256(last.periodEnd) + receiptFreshnessSec) {
            return Verdict.PAUSE_STALE;
        }

        return _drawdownVerdict(tr, botId, count, last.pnlMicros, maxDrawdownBps, budgetUsdc);
    }

    function _drawdownVerdict(
        ITrackRecordV2 tr,
        bytes32 botId,
        uint256 count,
        int128 cur,
        uint16 maxDrawdownBps,
        uint128 budgetUsdc
    ) private view returns (Verdict) {
        int128 peak = type(int128).min;
        uint256 lookback = count > 64 ? count - 64 : 0;
        for (uint256 i = lookback; i < count; ++i) {
            int128 v = tr.recordAt(botId, i).pnlMicros;
            if (v > peak) peak = v;
        }
        if (peak <= 0) {
            if (cur < 0 && budgetUsdc > 0) {
                uint256 lossBps = uint256(-int256(cur)) * 10_000 / uint256(budgetUsdc);
                if (lossBps >= maxDrawdownBps) return Verdict.PAUSE_DRAWDOWN;
            }
            return Verdict.ALLOW;
        }
        if (peak > 0 && cur < peak) {
            uint256 ddBps = uint256(int256(peak) - int256(cur)) * 10_000 / uint256(uint128(peak));
            if (ddBps >= maxDrawdownBps) return Verdict.PAUSE_DRAWDOWN;
        }
        return Verdict.ALLOW;
    }

    /// @notice Permissionless transition + slash. Anyone can call.
    function enforce(address vaultAddr) external {
        CovenantVault vault = CovenantVault(vaultAddr);
        Verdict verdict = evaluate(vaultAddr);
        CovenantVault.State current = vault.state();
        CovenantVault.State expected = verdict == Verdict.ALLOW
            ? CovenantVault.State.ACTIVE
            : CovenantVault.State.PAUSED;

        uint256 slashed = 0;
        if (current != expected) {
            bytes32 reason = bytes32(uint256(verdict));
            vault.setState(expected, reason);

            // Autonomous slash on operator-fault violations (not just timeout).
            if (
                expected == CovenantVault.State.PAUSED &&
                verdict != Verdict.PAUSE_EXPIRED
            ) {
                slashed = _trySlash(vaultAddr, reason);
            }
        }
        emit Enforced(vaultAddr, verdict, expected, slashed);
    }

    function _trySlash(address vaultAddr, bytes32 reason) private returns (uint256) {
        (address operator, bytes32 botId, , , , , , address bondAddr, , ) = CovenantVault(vaultAddr).mandate();
        if (bondAddr == address(0)) return 0;
        ISlashBond bond = ISlashBond(bondAddr);
        try bond.operator() returns (address bondOperator) {
            if (bondOperator != operator) return 0;
        } catch {
            return 0;
        }
        try bond.attestor() returns (address bondAttestor) {
            if (bondAttestor != address(this)) return 0;
        } catch {
            return 0;
        }
        try bond.botId() returns (bytes32 bondBotId) {
            if (bondBotId != botId) return 0;
        } catch {
            return 0;
        }
        uint256 bal = bond.bondBalance();
        if (bal == 0) return 0;
        uint256 amount = (bal * SLASH_BPS_PER_VIOLATION) / 10_000;
        if (amount == 0) amount = bal; // tiny bond → slash the whole thing
        try bond.slash(amount, reason) {
            return amount;
        } catch {
            // bond may revert if this contract isn't its attestor — fall through silently
            return 0;
        }
    }
}
