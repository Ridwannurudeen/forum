// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault} from "./CovenantVault.sol";

/// @title RiskKernel
/// @notice Permissionless evaluator + enforcer of CovenantVault mandates.
///
///         Anyone can call `enforce(vault)`. The kernel reads the vault's
///         current state, computes the EXPECTED state from on-chain truth,
///         and (if mismatch) calls `vault.setState()` to transition.
///
///         This is the security model: no centralised attestor, no admin
///         keys. Mandate adherence is a public function any keeper, watcher,
///         or competing operator can verify and act on.
///
///         v1 rules (all evaluated independently; ANY → PAUSED):
///           1. MAX_DRAWDOWN     — peak-to-trough pnlMicros > maxDrawdownBps of peak
///           2. OVERSUBSCRIBED   — operatorOutstanding > mandate.budgetUsdc
///           3. RECEIPT_STALE    — last record older than mandate.receiptFreshnessSec
///           4. EXPIRED          — block.timestamp >= mandate.expiry
///
///         v1.1 will add: per-venue exposure, drift detection, peer-relative Sharpe.
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

contract RiskKernel {
    enum Verdict {
        ALLOW,
        PAUSE_DRAWDOWN,
        PAUSE_OVERSUBSCRIBED,
        PAUSE_STALE,
        PAUSE_EXPIRED
    }

    event Enforced(address indexed vault, Verdict verdict, CovenantVault.State newState);

    /// @notice Pure evaluator — does NOT mutate. Anyone can call.
    function evaluate(address vaultAddr) public view returns (Verdict) {
        CovenantVault vault = CovenantVault(vaultAddr);
        (
            ,                              // operator
            bytes32 botId,
            uint128 budgetUsdc,
            uint16 maxDrawdownBps,
            uint32 receiptFreshnessSec,
            uint64 expiry,
            ,                              // perfFeeBps
            ,                              // bondContract
            ,                              // riskKernel
            address trackRecordV2
        ) = vault.mandate();

        if (expiry != 0 && block.timestamp >= expiry) return Verdict.PAUSE_EXPIRED;
        if (vault.operatorOutstanding() > budgetUsdc) return Verdict.PAUSE_OVERSUBSCRIBED;

        ITrackRecordV2 tr = ITrackRecordV2(trackRecordV2);
        uint256 count = tr.recordCount(botId);
        if (count == 0) return Verdict.ALLOW; // warmup grace

        ITrackRecordV2.StoredRecord memory last = tr.recordAt(botId, count - 1);
        if (receiptFreshnessSec != 0 && block.timestamp > uint256(last.periodEnd) + receiptFreshnessSec) {
            return Verdict.PAUSE_STALE;
        }

        return _drawdownVerdict(tr, botId, count, last.pnlMicros, maxDrawdownBps);
    }

    function _drawdownVerdict(
        ITrackRecordV2 tr,
        bytes32 botId,
        uint256 count,
        int128 cur,
        uint16 maxDrawdownBps
    ) private view returns (Verdict) {
        int128 peak = type(int128).min;
        uint256 lookback = count > 64 ? count - 64 : 0;
        for (uint256 i = lookback; i < count; ++i) {
            int128 v = tr.recordAt(botId, i).pnlMicros;
            if (v > peak) peak = v;
        }
        if (peak > 0 && cur < peak) {
            uint256 ddBps = uint256(uint128(peak - cur)) * 10_000 / uint256(uint128(peak));
            if (ddBps >= maxDrawdownBps) return Verdict.PAUSE_DRAWDOWN;
        }
        return Verdict.ALLOW;
    }

    /// @notice Permissionless transition. ANYONE can call to enforce mandate.
    function enforce(address vaultAddr) external {
        CovenantVault vault = CovenantVault(vaultAddr);
        Verdict verdict = evaluate(vaultAddr);
        CovenantVault.State current = vault.state();
        CovenantVault.State expected = verdict == Verdict.ALLOW
            ? CovenantVault.State.ACTIVE
            : CovenantVault.State.PAUSED;
        if (current != expected) {
            bytes32 reason = bytes32(uint256(verdict));
            vault.setState(expected, reason);
            emit Enforced(vaultAddr, verdict, expected);
        }
    }
}
