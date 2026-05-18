# Forum - Agora Agents Hackathon Submission Draft

> Do not submit this form without explicit approval.

## Project Name

Forum

## One-Line Description

Covenant Accounts for autonomous market agents: mandate-bounded USDC credit lines, receipt-backed performance, and permissionless pause plus slash enforcement on Arc.

## Live Demo

- Frontend: https://forum.gudman.xyz/
- Repository: https://github.com/Ridwannurudeen/forum
- Arc explorer example: https://testnet.arcscan.app/address/0x80384963c0c93414ff16e018c6618a64bc94df6d

## What Problem Are You Solving?

Capital wants exposure to autonomous trading agents, but today the choices are bad:

- give the agent or operator a wallet and hope they behave;
- use a slow managed-account structure that does not fit agentic markets;
- trust screenshots of PnL, Sharpe, or win rate.

Forum makes an agent fundable without requiring blind trust. A depositor funds a USDC vault. The agent gets bounded execution rights. A public risk kernel can pause the vault and slash the operator bond if the mandate is breached.

## Why This Fits Agora / Arc

Agora is about agents that trade, invest, create, and interface with markets, settled instantly on Arc with USDC. Forum is the capital-control layer underneath those agents.

RFB fit:

- RFB 02, Prediction Market Trader Intelligence: agents can publish signed, receipt-backed recommendations and performance.
- RFB 06, Social Trading Intelligence: allocators can copy or fund agents based on verifiable receipts instead of social claims.
- Adjacent to RFB 04, Adaptive Portfolio Manager: the Covenant Account is a mandate-controlled allocation vehicle.

Arc/Circle usage:

- Arc testnet stores the live mandate, vault, bond, risk, identity, and receipt commitments.
- USDC is used for vault capital, operator bond, slashing, and fee split demos.
- **Circle CCTP V2 is wired**: `CovenantInbox` (`0x670f68ff6b90c42f4b7be26a684812e1e5561b12`) deployed to Arc testnet — accepts USDC bridged in via CCTP V2 (Arc = Domain 26) and deposits into any `CovenantVault` on behalf of a designated recipient. Canonical Circle/Arc addresses pinned in `deployments/arc-testnet.json` under `circle.*` (CCTP V2 TokenMessenger / MessageTransmitter / TokenMinter / MessageV2, Gateway Wallet + Minter, USYC + Teller + Entitlements, EURC, FxEscrow — all verified against `docs.arc.io/arc/references/contract-addresses`).
- Circle Paymaster is **upstream-blocked on Arc**: the supported-chains list at `developers.circle.com/paymaster` covers Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain — Arc is not listed for either ERC-4337 v0.7 or v0.8.
- USYC: token + Teller + Entitlements all live on Arc testnet (addresses pinned), but the Teller's buy/sell ABI is undocumented and the Entitlements gate appears to be permissioned. Read-only `totalSupply` verified; deposit/redeem integration deferred.
- Circle Gateway (`GatewayWallet` + `GatewayMinter`) and App Kit are addressed but not wired in v1.

## What Is Live

Live contracts on Arc testnet:

| Contract | Address | Role |
|---|---:|---|
| `BuilderCodeRegistry` | `0x730825299821d411146c503915553e37ebdc750c` | builder-code identity |
| `KeeperConfig` | `0xf37b1eb28d9af1b259cad3d71a14e76ca8ae0d26` | bot config history |
| `TrackRecord` | `0xaace70a50573cb077f65d601cd19103afc4aef9d` | v1 signed PnL ledger |
| `FeeDistributor` | `0x0574257629e8221d560cf4aace0f3cd7226be2a0` | USDC attribution split |
| `TrackRecordV2` | `0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66` | strict receipt ledger |
| `AgentPool` | `0x13855be80b6122187c0bcba007946f9fbaae3fae` | simple USDC pool |
| `RiskKernelV2` | `0x0af356f280af1d8b7a43f0746c581614feec4055` | permissionless enforcement |
| `SlashBondV1.1` | `0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939` | slashable USDC bond |
| `CovenantVaultV1.2` | `0x80384963c0c93414ff16e018c6618a64bc94df6d` | live AgoraMind credit line |
| `CovenantInbox` | `0x670f68ff6b90c42f4b7be26a684812e1e5561b12` | CCTP V2 bridge-friendly deposit wrapper; deposits incoming USDC into a vault for a designated recipient |

Live services:

- `forum-keeper`: reference paper-mode keeper publishing v1 records.
- `forum-agora-mind`: AI-driven keeper publishing `TrackRecordV2` receipts and reasoning trace hashes.

## Verifiable Demo Proofs

Autonomous pause plus slash:

- Tx: `0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13`
- What happened: `RiskKernelV2.enforce(vault)` paused `CovenantVaultV1.2` and slashed `1.25 USDC` from `SlashBondV1.1` in the same transaction.
- Trigger: stale receipt window, not a manually edited UI state.

Receipt proof:

- Example receipt: https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
- Local verifier: `npx tsx keeper/scripts/verify-receipt.mjs <receipt-url>`
- The frontend now performs the same browser-side hash check against `TrackRecordV2`.

## Traction During The Event

- 5 registered bot identities on Arc across the original `TrackRecord` surface.
- Continuous keeper activity during the event window.
- 1 live AgoraMind bot publishing public `TrackRecordV2` receipts.
- 1 live Covenant Account funded and bonded with USDC on Arc testnet.
- 1 autonomous pause plus slash transaction completed on-chain.

Honest note: these are self-operated demo users. External bot adapters and third-party user onboarding are not complete yet.

## What Is Novel?

Most hackathon entries will build an agent. Forum builds the account primitive that lets someone else safely fund an agent.

The new primitive is the Covenant Account:

- bounded USDC credit;
- signed public receipts;
- on-chain drawdown, staleness, budget, and expiry checks;
- operator bond;
- pause plus slash in one transaction.

That combination is the difference between "I built a bot" and "a third party can allocate capital to this bot under enforceable rules."

## Tests

Current CI covers:

- Foundry build and contract tests;
- keeper TypeScript typecheck;
- keeper Vitest suite;
- TypeScript SDK typecheck;
- Python SDK import smoke.

Local Windows does not currently have `forge`; Foundry verification is via GitHub Actions.

## Risks And Scope

- Arc testnet only.
- Reference trading is paper-mode.
- No real Polymarket order execution or real builder-fee capture is claimed.
- External adapters are not shipped yet.
- Contracts are immutable and unaudited.
- The current vault bounds operator credit by amount and state, but does not enforce allowed venues on-chain.

## Demo Video

To be recorded.

Recommended flow:

1. Show the live site and the active `CovenantVaultV1.2`.
2. Show the autonomous pause plus slash tx on Arc explorer.
3. Show a public receipt JSON.
4. Run `npx tsx keeper/scripts/verify-receipt.mjs <receipt-url>`.
5. Show the SDK snippet and explain how another bot plugs in.

## Team

Ridwan Nurudeen

## Contact

nraheemst@gmail.com
