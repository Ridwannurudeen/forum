// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./CovenantVault.sol";

interface ISlashBond {
    function totalSlashed() external view returns (uint256);
}

interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title SlashMarket
/// @notice Phase 9 (Risk Markets) v0. Per-bond, per-window prediction
///         market: "WILL this `SlashBond` have a slash event between now
///         and expiry?" — YES stakers vs NO stakers, both in USDC.
///
///         Settlement is fully on-chain and oracle-free: at expiry,
///         anyone calls `settle(id)`. The market reads the bond's
///         current `totalSlashed()`; if it's > the snapshot taken at
///         market creation, the YES side wins. Otherwise NO wins.
///         Winners get their stake back + a pro-rata share of the
///         losing pool. No protocol fee in v0 (revenue model deferred).
///
///         What this proves:
///         - Forum's slash events become a tradeable signal.
///         - Outside capital can take the other side of agent risk
///           without trusting any oracle that isn't the bond contract
///           itself (which is immutable and on the same chain).
///         - Anyone can create a market against any bond — including
///           bonds not connected to Forum-deployed CovenantVaults.
///
///         Out-of-scope for v0:
///         - Multi-event markets (this market is binary per bond per window)
///         - Continuous slash insurance (a depositor-side premium product
///           that pays out automatically — different shape, Phase 9.x)
///         - AgentScore oracle subscription product (Phase 9 ship item;
///           served separately via /api/agents)
///         - Bond yield (also Phase 9; lives in CapitalRouter idle layer)
///
///         Immutable. No admin keys. No upgrade path.
contract SlashMarket {
    IERC20 public immutable usdc;

    struct Market {
        address bond;
        uint64 createdAt;
        uint64 expiryAt;
        uint256 slashedSnapshot;
        uint256 yesStake;
        uint256 noStake;
        bool settled;
        bool didSlash;
        uint256 newSlashedAtSettle;
    }

    Market[] private _markets;
    mapping(uint256 => mapping(address => uint256)) public yesStakeOf;
    mapping(uint256 => mapping(address => uint256)) public noStakeOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketCreated(
        uint256 indexed id,
        address indexed bond,
        address indexed creator,
        uint64 expiryAt,
        uint256 slashedSnapshot
    );
    event Staked(uint256 indexed id, address indexed user, bool yesSide, uint256 amount);
    event Settled(uint256 indexed id, bool didSlash, uint256 newSlashedAtSettle);
    event Claimed(uint256 indexed id, address indexed user, uint256 payout);

    error ZeroAmount();
    error ZeroAddress();
    error MarketSettled();
    error MarketActive();
    error MarketExpired();
    error AlreadyClaimed();
    error InvalidExpiry();
    error UnknownMarket();
    error NoWinningStake();
    error TransferFailed();

    constructor(IERC20 _usdc) {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        usdc = _usdc;
    }

    function createMarket(address bond, uint64 expiryAt) external returns (uint256 id) {
        if (bond == address(0)) revert ZeroAddress();
        if (expiryAt <= block.timestamp) revert InvalidExpiry();
        uint256 snapshot = ISlashBond(bond).totalSlashed();
        _markets.push(
            Market({
                bond: bond,
                createdAt: uint64(block.timestamp),
                expiryAt: expiryAt,
                slashedSnapshot: snapshot,
                yesStake: 0,
                noStake: 0,
                settled: false,
                didSlash: false,
                newSlashedAtSettle: 0
            })
        );
        id = _markets.length - 1;
        emit MarketCreated(id, bond, msg.sender, expiryAt, snapshot);
    }

    function stake(uint256 id, bool yesSide, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (id >= _markets.length) revert UnknownMarket();
        Market storage m = _markets[id];
        if (m.settled) revert MarketSettled();
        if (block.timestamp >= m.expiryAt) revert MarketExpired();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (yesSide) {
            m.yesStake += amount;
            yesStakeOf[id][msg.sender] += amount;
        } else {
            m.noStake += amount;
            noStakeOf[id][msg.sender] += amount;
        }
        emit Staked(id, msg.sender, yesSide, amount);
    }

    function settle(uint256 id) external {
        if (id >= _markets.length) revert UnknownMarket();
        Market storage m = _markets[id];
        if (m.settled) revert MarketSettled();
        if (block.timestamp < m.expiryAt) revert MarketActive();
        uint256 newSlashed = ISlashBond(m.bond).totalSlashed();
        m.didSlash = newSlashed > m.slashedSnapshot;
        m.newSlashedAtSettle = newSlashed;
        m.settled = true;
        emit Settled(id, m.didSlash, newSlashed);
    }

    function claim(uint256 id) external returns (uint256 payout) {
        if (id >= _markets.length) revert UnknownMarket();
        Market storage m = _markets[id];
        if (!m.settled) revert MarketActive();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        claimed[id][msg.sender] = true;

        uint256 myStake = m.didSlash ? yesStakeOf[id][msg.sender] : noStakeOf[id][msg.sender];
        if (myStake == 0) {
            // Loser side — claim records the no-op so they can't try again.
            emit Claimed(id, msg.sender, 0);
            return 0;
        }
        uint256 winningPool = m.didSlash ? m.yesStake : m.noStake;
        uint256 losingPool = m.didSlash ? m.noStake : m.yesStake;
        if (winningPool == 0) revert NoWinningStake();
        // Original stake back + pro-rata share of the losing pool.
        payout = myStake + (myStake * losingPool) / winningPool;
        if (!usdc.transfer(msg.sender, payout)) revert TransferFailed();
        emit Claimed(id, msg.sender, payout);
    }

    // -- views ---------------------------------------------------------------

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function marketAt(uint256 id) external view returns (Market memory) {
        if (id >= _markets.length) revert UnknownMarket();
        return _markets[id];
    }

    function stakeOf(uint256 id, address user)
        external
        view
        returns (uint256 yes, uint256 no)
    {
        return (yesStakeOf[id][user], noStakeOf[id][user]);
    }
}
