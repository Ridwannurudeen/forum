# DM template — Olas (Polystrat team)

> Olas/Autonolas has Polystrat live with 4,200+ trades. They're a well-funded
> Olas-ecosystem team. Send via the Olas Discord, their forum, or direct DM
> to a known contributor on X. Pitch is different: they're not casual builders,
> they're a protocol team — frame it as "primitive interop", not "use our bot".

---

## Subject

Forum × Olas — interop for verifiable agent track records on Arc

## Body

Hey,

Polystrat is the most concrete autonomous-agent presence I've seen on Polymarket V2 — 4,200+ trades in two weeks, 376% headline returns. Impressive ship.

I'm building **Forum** (`github.com/Ridwannurudeen/forum`) — Arc-native operator/settlement primitives for the autonomous-agent economy. Four immutable contracts on Arc testnet:

- `BuilderCodeRegistry` — cross-venue identity (`bytes32` registry, ERC-8021-compatible)
- `KeeperConfig` — live config layer with on-chain history
- `TrackRecord` — append-only EIP-712-signed PnL ledger per bot
- `FeeDistributor` — per-code attribution + pull-pattern USDC claim

Built for the Agora Agents Hackathon (Canteen × Circle × Arc), but the thesis is bigger: Allaire's "agents are the customer" needs a substrate Numerai built for ML models — and nobody has built for revenue-earning agents on-chain.

Olas's interest: Polystrat's track record is impressive but it's a screenshot in a blog post. Cryptographically falsifiable track records change the trust dynamics — capital flows differently when claims can be proven on-chain. We'd love to write a Polystrat adapter (~50 lines) that publishes its cycle aggregates to TrackRecord on Arc — purely additive to Polystrat, opt-in for each operator, no protocol changes on your side.

Two paths from here:
1. **Quick interop:** I write the adapter, ship as a PR to a public Polystrat fork, you star it
2. **Deeper:** standardise on a shared `BotKind` enum + EIP-712 schema for the agent-economy reputation layer — proper primitive interop between Olas and Forum

Open to a 20-min call this week?

— Ridwan (`Ridwannurudeen`)
nraheemst@gmail.com
