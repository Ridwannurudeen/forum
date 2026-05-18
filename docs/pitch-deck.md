# Forum Investor Deck Source

## 1. Title

**Forum: Covenant Accounts for autonomous market agents.**

Programmable USDC credit lines, receipt-backed performance, and permissionless risk enforcement on Arc.

Live: https://forum.gudman.xyz/

## 2. Problem

Trading agents can act continuously, but capital cannot safely fund them.

The current choices are:

- hand the operator a wallet;
- build a bespoke managed-account and audit stack;
- trust unaudited PnL screenshots.

That does not work for agents making market decisions every minute.

## 3. Product

A Covenant Account is a USDC vault with an on-chain mandate:

- maximum operator budget;
- drawdown threshold;
- receipt freshness window;
- mandate expiry;
- performance fee above high-water mark;
- slashable operator bond.

The agent can pull bounded credit. Anyone can call `RiskKernelV2.enforce(vault)`. If the mandate is breached, the vault pauses and the bond can be slashed in the same transaction.

## 4. Why Arc

Arc gives Forum the right settlement physics:

- USDC-native accounting;
- low-cost, frequent receipt publication;
- fast enforcement transactions;
- clean separation from the trading venue.

Forum uses Arc as the capital-control and reputation layer for agents that trade elsewhere.

## 5. Live Proof

On Arc testnet:

- live `CovenantVaultV1.2`;
- live `RiskKernelV2`;
- live `SlashBondV1.1`;
- live `TrackRecordV2` receipts;
- live AgoraMind keeper publishing public receipt JSON.

Autonomous pause plus slash tx:

`0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13`

That transaction paused the vault and slashed `1.25 USDC` from the operator bond.

## 6. Reputation Graph

Each `TrackRecordV2` record has:

- strict sequence;
- monotonic time;
- previous-record hash;
- replay protection;
- EIP-712 signer attribution;
- public evidence URI and evidence hash.

The product creates an AgentScore graph: which agents publish receipts, how fresh they are, whether their PnL recomputes, and whether they have ever been slashed.

## 7. Business Model

Forum can monetize without taxing the base contracts:

- hosted Covenant Account operations;
- reputation and risk API;
- mandate template marketplace;
- optional performance-fee routing;
- enterprise integrations for trading teams and venues.

The contracts stay permissionless. Revenue comes from services around the graph and account operations.

## 8. Wedge

The first wedge is prediction-market agents because they are:

- easy to inspect publicly;
- high-frequency enough to need cheap settlement;
- socially traded enough to need reputation;
- small enough for retail-sized USDC vaults.

The broader market is any agent that touches capital and needs enforceable limits.

## 9. Current Gaps

Honest current gaps:

- external adapters are not shipped yet;
- reference trading remains paper-mode;
- real builder-fee capture is not proven;
- Circle Gateway/CCTP/USYC integrations are roadmap;
- contracts are unaudited.

These are execution milestones, not thesis blockers.

## 10. Ask

The hackathon goal is to prove the primitive:

- agent publishes receipts;
- vault funds the agent under a mandate;
- risk kernel enforces the mandate;
- bond slash happens on-chain.

Next capital should fund:

- one external bot integration;
- production receipt verifier and indexer;
- real trading/fee-routing pilot;
- security review;
- Arc mainnet deployment when available.

Contact: nraheemst@gmail.com

## Appendix: Addresses

| Contract | Address |
|---|---:|
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` |
| `RiskKernelV2` | `0x0af356f280af1d8b7a43f0746c581614feec4055` |
| `SlashBondV1.1` | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` |
| `CovenantVaultV1.2` | `0x80384963c0c93414ff16e018c6618a64bc94df6d` |
| `AgentPool` | `0x13855be80b6122187c0bcba007946f9fbaae3fae` |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` |
