// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault} from "./CovenantVault.sol";

/// @title RiskKernelV3
/// @notice Hardened risk engine. Same autonomous pause+slash as V2, plus two
///         fixes that matter once real capital is at stake:
///
///         1. PERSISTENT, MONOTONIC DRAWDOWN PEAK. V2 measured drawdown against
///            the max PnL in a rolling 64-record window, so an operator could
///            spam fresh receipts to push the real high out of the window and
///            silently reset their high-water mark. V3 stores the peak per bot
///            (`peakPnl`) and only ever raises it — it cannot be reset by
///            spamming. Anyone can `poke(vault)` to capture a new high; the
///            peak then persists. This is also O(1) gas (no 64-record loop).
///
///         2. ON-CHAIN NAV CIRCUIT BREAKER. V2's drawdown was purely
///            receipt-based (trusts the operator's published PnL). V3 adds a
///            receipt-independent check: if the vault's per-share NAV falls more
///            than `maxDrawdownBps` below its high-water mark, pause — directly
///            from on-chain vault accounting, regardless of what receipts claim.
///
///         Bind to a SlashBond whose `attestor` is this contract. Works on both
///         CovenantVault and CovenantVaultV2 (shared getter selectors).
interface ITrackRecordV3 {
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

interface ISlashBondV3 {
    function bondBalance() external view returns (uint256);
    function slash(uint256 amount, bytes32 reason) external;
}

contract RiskKernelV3 {
    enum Verdict {
        ALLOW,
        PAUSE_DRAWDOWN,
        PAUSE_OVERSUBSCRIBED,
        PAUSE_STALE,
        PAUSE_EXPIRED,
        PAUSE_NAV
    }

    uint16 public constant SLASH_BPS_PER_VIOLATION = 2_500; // 25%
    uint256 private constant ONE = 1e18;

    /// @notice Persistent high-water PnL per bot (micro-USDC). Monotonic: only
    ///         raised, never lowered — so an operator cannot reset it.
    mapping(bytes32 => int128) public peakPnl;

    event Enforced(
        address indexed vault,
        Verdict verdict,
        CovenantVault.State newState,
        uint256 slashedUsdc
    );
    event PeakUpdated(bytes32 indexed botId, int128 peakPnl);

    /// @notice Capture a new PnL high into the persistent peak. Permissionless;
    ///         a watcher calls this so a later crash is measured against the
    ///         real high even if no enforce happened at the peak.
    function poke(address vaultAddr) public {
        (, bytes32 botId, , , , , , , , address tr) = CovenantVault(vaultAddr).mandate();
        ITrackRecordV3 t = ITrackRecordV3(tr);
        uint256 count = t.recordCount(botId);
        if (count == 0) return;
        int128 cur = t.recordAt(botId, count - 1).pnlMicros;
        if (cur > peakPnl[botId]) {
            peakPnl[botId] = cur;
            emit PeakUpdated(botId, cur);
        }
    }

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

        // On-chain NAV circuit breaker — independent of published receipts.
        if (vault.totalShares() > 0) {
            uint256 hwm = vault.highWaterMark();
            uint256 px = vault.perSharePrice();
            if (hwm > 0 && px < hwm) {
                uint256 navDdBps = ((hwm - px) * 10_000) / hwm;
                if (maxDrawdownBps != 0 && navDdBps >= maxDrawdownBps) {
                    return Verdict.PAUSE_NAV;
                }
            }
        }

        ITrackRecordV3 tr = ITrackRecordV3(trackRecordV2);
        uint256 count = tr.recordCount(botId);
        if (count == 0) return Verdict.ALLOW;

        ITrackRecordV3.StoredRecord memory last = tr.recordAt(botId, count - 1);
        if (receiptFreshnessSec != 0 && block.timestamp > uint256(last.periodEnd) + receiptFreshnessSec) {
            return Verdict.PAUSE_STALE;
        }

        return _drawdownVerdict(botId, last.pnlMicros, maxDrawdownBps, budgetUsdc);
    }

    /// @dev Drawdown vs the PERSISTENT peak (max of stored peak and current),
    ///      not a rolling window — O(1) and not resettable by receipt spam.
    function _drawdownVerdict(
        bytes32 botId,
        int128 cur,
        uint16 maxDrawdownBps,
        uint128 budgetUsdc
    ) private view returns (Verdict) {
        int128 peak = peakPnl[botId];
        if (cur > peak) peak = cur;

        if (peak <= 0) {
            if (cur < 0 && budgetUsdc > 0) {
                uint256 lossBps = (uint256(-int256(cur)) * 10_000) / uint256(budgetUsdc);
                if (lossBps >= maxDrawdownBps) return Verdict.PAUSE_DRAWDOWN;
            }
            return Verdict.ALLOW;
        }
        if (cur < peak) {
            uint256 ddBps = (uint256(int256(peak) - int256(cur)) * 10_000) / uint256(uint128(peak));
            if (ddBps >= maxDrawdownBps) return Verdict.PAUSE_DRAWDOWN;
        }
        return Verdict.ALLOW;
    }

    /// @notice Permissionless transition + slash. Updates the persistent peak
    ///         first so drawdown is measured against the true high.
    function enforce(address vaultAddr) external {
        poke(vaultAddr);
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
            // Slash on operator-fault violations; expiry (timeout) is exempt.
            if (expected == CovenantVault.State.PAUSED && verdict != Verdict.PAUSE_EXPIRED) {
                slashed = _trySlash(vaultAddr, reason);
            }
        }
        emit Enforced(vaultAddr, verdict, expected, slashed);
    }

    function _trySlash(address vaultAddr, bytes32 reason) private returns (uint256) {
        (, , , , , , , address bondAddr, , ) = CovenantVault(vaultAddr).mandate();
        if (bondAddr == address(0)) return 0;
        ISlashBondV3 bond = ISlashBondV3(bondAddr);
        uint256 bal = bond.bondBalance();
        if (bal == 0) return 0;
        uint256 amount = (bal * SLASH_BPS_PER_VIOLATION) / 10_000;
        if (amount == 0) amount = bal;
        try bond.slash(amount, reason) {
            return amount;
        } catch {
            return 0;
        }
    }
}
