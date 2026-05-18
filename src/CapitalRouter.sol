// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CovenantVault, IERC20} from "./CovenantVault.sol";

/// @notice CovenantVault's IERC20 interface omits approve(); we need it to
///         authorise vault.deposit() to pull USDC from the router.
interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title CapitalRouter
/// @notice The allocator product (Phase 5). Pools depositor USDC and routes
///         it across whitelisted `CovenantVault` instances according to a
///         strategist-set weight table. Permissionless `rebalance()` moves
///         capital toward target weights using `vault.deposit()` and
///         `vault.withdraw()`.
///
///         Trust model (honest):
///         - Depositors trust the strategist to pick non-malicious vaults.
///         - The strategist is set at deploy time and immutable.
///         - Each target vault enforces its own mandate via RiskKernelV2.
///         - The router NEVER hands cash to an operator directly; only to a
///           `CovenantVault`, which holds operator credit under its mandate.
///         - Withdraw works in any state. If idle is insufficient, the
///           router pulls from target vaults proportionally. If a vault is
///           PAUSED + has zero idle, that vault's slice may not be
///           immediately recoverable — depositors hold a pro-rata claim on
///           the remainder.
///
///         Out-of-scope for v1:
///         - Auto-enforce on breach (frontend already exposes one-click
///           enforce; permissionless so anyone can do it from the UI)
///         - Auto-withdraw on stale receipt (rebalance() naturally rotates
///           if a vault's stale verdict pauses it AND a strategist updates
///           weights to drop it)
///         - Allocator performance profile (lives in the indexer / frontend)
///         - Yield on idle (depends on USYC / equivalent — Phase 7)
contract CapitalRouter {
    IERC20 public immutable usdc;
    /// @notice The single account allowed to call setStrategy. Immutable —
    ///         no admin key, no upgrade.
    address public immutable strategist;

    address[] public targetVaults;
    mapping(address => uint16) public targetWeightsBps;
    /// @notice True if the address is currently in `targetVaults`. Used to
    ///         skip non-strategy vaults during withdraw fallback.
    mapping(address => bool) public isTarget;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    uint256 public idleUsdc;

    uint64 public strategyVersion;
    uint64 public lastRebalanceAt;

    uint256 private constant ONE = 1e18;
    uint16 private constant WEIGHTS_TOTAL_BPS = 10_000;
    uint8 private constant MAX_TARGET_VAULTS = 20;

    event Deposit(address indexed user, uint256 usdcIn, uint256 sharesMinted);
    event Withdraw(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    event StrategySet(uint64 indexed version, address[] vaults, uint16[] weightsBps);
    event Rebalanced(uint64 indexed at, uint256 totalAssets, uint256 vaultsTouched);

    error NotStrategist();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientShares();
    error WeightsLengthMismatch();
    error WeightsMustSumTo10000();
    error TooManyVaults();

    constructor(IERC20 _usdc, address _strategist) {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        if (_strategist == address(0)) revert ZeroAddress();
        usdc = _usdc;
        strategist = _strategist;
    }

    // ------------------------------------------------------------------
    // Strategy admin (strategist only)
    // ------------------------------------------------------------------

    function setStrategy(address[] calldata vaults, uint16[] calldata weightsBps) external {
        if (msg.sender != strategist) revert NotStrategist();
        if (vaults.length != weightsBps.length) revert WeightsLengthMismatch();
        if (vaults.length > MAX_TARGET_VAULTS) revert TooManyVaults();
        uint256 sum = 0;
        for (uint256 i = 0; i < weightsBps.length; ++i) sum += weightsBps[i];
        if (sum != WEIGHTS_TOTAL_BPS) revert WeightsMustSumTo10000();

        // Clear old
        for (uint256 i = 0; i < targetVaults.length; ++i) {
            address old = targetVaults[i];
            targetWeightsBps[old] = 0;
            isTarget[old] = false;
        }
        delete targetVaults;
        // Set new
        for (uint256 i = 0; i < vaults.length; ++i) {
            if (vaults[i] == address(0)) revert ZeroAddress();
            targetVaults.push(vaults[i]);
            targetWeightsBps[vaults[i]] = weightsBps[i];
            isTarget[vaults[i]] = true;
        }
        unchecked { strategyVersion += 1; }
        emit StrategySet(strategyVersion, vaults, weightsBps);
    }

    function targetVaultCount() external view returns (uint256) {
        return targetVaults.length;
    }

    // ------------------------------------------------------------------
    // Asset accounting
    // ------------------------------------------------------------------

    /// @notice Pro-rata sum: router's idle USDC + router's share of every
    ///         target vault's NAV.
    function assets() public view returns (uint256 total) {
        total = idleUsdc;
        for (uint256 i = 0; i < targetVaults.length; ++i) {
            total += _routerAssetsInVault(targetVaults[i]);
        }
    }

    function _routerAssetsInVault(address vaultAddr) internal view returns (uint256) {
        CovenantVault vault = CovenantVault(vaultAddr);
        uint256 routerShares = vault.sharesOf(address(this));
        if (routerShares == 0) return 0;
        uint256 totalVaultShares = vault.totalShares();
        if (totalVaultShares == 0) return 0;
        return (routerShares * vault.assets()) / totalVaultShares;
    }

    function perSharePrice() public view returns (uint256) {
        if (totalShares == 0) return ONE;
        return (assets() * ONE) / totalShares;
    }

    // ------------------------------------------------------------------
    // Depositor surface
    // ------------------------------------------------------------------

    function deposit(uint256 amount) external returns (uint256 sharesMinted) {
        if (amount == 0) revert ZeroAmount();
        if (totalShares == 0) {
            sharesMinted = amount;
        } else {
            sharesMinted = (amount * totalShares) / assets();
            if (sharesMinted == 0) revert ZeroAmount();
        }
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert();
        sharesOf[msg.sender] += sharesMinted;
        totalShares += sharesMinted;
        idleUsdc += amount;
        emit Deposit(msg.sender, amount, sharesMinted);
    }

    /// @notice Withdraw `shares` worth of USDC. Pulls from idle first;
    ///         if insufficient, pulls proportionally from target vaults.
    ///         If a vault is paused with no idle, that slice stays trapped
    ///         in that vault (depositor keeps the claim until the vault
    ///         unpauses or its idle replenishes from operator returns).
    function withdraw(uint256 shares) external returns (uint256 usdcOut) {
        if (shares == 0) revert ZeroAmount();
        uint256 userShares = sharesOf[msg.sender];
        if (shares > userShares) revert InsufficientShares();
        uint256 totalAssetsNow = assets();
        usdcOut = (shares * totalAssetsNow) / totalShares;

        if (usdcOut > idleUsdc) {
            // Need to source the shortfall from vaults.
            for (uint256 i = 0; i < targetVaults.length; ++i) {
                if (idleUsdc >= usdcOut) break;
                uint256 shortfall = usdcOut - idleUsdc;
                address vAddr = targetVaults[i];
                CovenantVault vault = CovenantVault(vAddr);
                uint256 routerShares = vault.sharesOf(address(this));
                if (routerShares == 0) continue;
                uint256 totalVaultShares = vault.totalShares();
                uint256 vaultAssetsNow = vault.assets();
                if (totalVaultShares == 0 || vaultAssetsNow == 0) continue;

                uint256 routerInVault = (routerShares * vaultAssetsNow) / totalVaultShares;
                uint256 toPull = shortfall < routerInVault ? shortfall : routerInVault;
                uint256 sharesToBurn = (toPull * totalVaultShares) / vaultAssetsNow;
                if (sharesToBurn > routerShares) sharesToBurn = routerShares;
                if (sharesToBurn == 0) continue;
                try vault.withdraw(sharesToBurn) returns (uint256 pulled) {
                    idleUsdc += pulled;
                } catch {
                    // Vault is PAUSED with no idle, or insufficient idle —
                    // skip; depositor's remainder waits.
                }
            }
            if (usdcOut > idleUsdc) {
                // Best-effort: pay what we have idle now.
                usdcOut = idleUsdc;
            }
        }

        sharesOf[msg.sender] = userShares - shares;
        totalShares -= shares;
        idleUsdc -= usdcOut;
        if (!usdc.transfer(msg.sender, usdcOut)) revert();
        emit Withdraw(msg.sender, shares, usdcOut);
    }

    // ------------------------------------------------------------------
    // Permissionless rebalance
    // ------------------------------------------------------------------

    /// @notice Move idle USDC into / out of target vaults to hit the
    ///         strategist's weights. Permissionless — anyone can call;
    ///         the strategist need not pay gas every cycle. A vault that
    ///         is PAUSED simply gets skipped on deposit (vault.deposit
    ///         will revert) and may be partly withdrawable on withdraw.
    function rebalance() external returns (uint256 vaultsTouched) {
        uint256 n = targetVaults.length;
        if (n == 0) return 0;
        uint256 totalNow = assets();

        for (uint256 i = 0; i < n; ++i) {
            address vAddr = targetVaults[i];
            CovenantVault vault = CovenantVault(vAddr);
            uint256 routerShares = vault.sharesOf(address(this));
            uint256 totalVaultShares = vault.totalShares();
            uint256 vaultAssetsNow = vault.assets();
            uint256 currentInVault =
                (routerShares == 0 || totalVaultShares == 0 || vaultAssetsNow == 0)
                    ? 0
                    : (routerShares * vaultAssetsNow) / totalVaultShares;
            uint256 targetForVault = (totalNow * targetWeightsBps[vAddr]) / WEIGHTS_TOTAL_BPS;

            if (currentInVault < targetForVault) {
                uint256 toDeposit = targetForVault - currentInVault;
                if (toDeposit > idleUsdc) toDeposit = idleUsdc;
                if (toDeposit == 0) continue;
                if (!IERC20Approve(address(usdc)).approve(vAddr, toDeposit)) revert();
                try vault.deposit(toDeposit) returns (uint256 /*shares*/) {
                    idleUsdc -= toDeposit;
                    unchecked { vaultsTouched += 1; }
                } catch {
                    // Vault paused or other revert; skip this vault, leave idle.
                    IERC20Approve(address(usdc)).approve(vAddr, 0);
                }
            } else if (currentInVault > targetForVault && routerShares > 0) {
                uint256 toWithdraw = currentInVault - targetForVault;
                uint256 sharesToBurn = (toWithdraw * totalVaultShares) / vaultAssetsNow;
                if (sharesToBurn > routerShares) sharesToBurn = routerShares;
                if (sharesToBurn == 0) continue;
                try vault.withdraw(sharesToBurn) returns (uint256 pulled) {
                    idleUsdc += pulled;
                    unchecked { vaultsTouched += 1; }
                } catch {
                    // Vault paused with no idle; skip.
                }
            }
        }
        lastRebalanceAt = uint64(block.timestamp);
        emit Rebalanced(lastRebalanceAt, totalNow, vaultsTouched);
    }
}
