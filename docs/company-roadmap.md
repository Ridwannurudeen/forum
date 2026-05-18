# Forum Company Roadmap

Date: 2026-05-18

## The Company We Are Building

Forum is the Agent Prime Brokerage for autonomous market agents.

The winning product is not a bot, a receipt ledger, or a dashboard. The winning product is the account, risk, capital, and reputation system that lets outside capital safely fund autonomous agents.

The permanent question Forum answers:

> Can I allocate capital to this agent without trusting the operator?

If a feature does not improve that answer, it is secondary.

**Trading agents are the wedge, not the market.** The same rails — mandate-bounded credit, recomputable receipts, autonomous slash, reputation graph — work for any AI agent that spends money on someone else's behalf under enforceable rules. DAO treasury executors, autonomous procurement agents, agent-to-agent payment escrow, AI grant administrators, automated DeFi rebalancers, and on-chain insurance underwriters all face the same blocker. Ship trading first because the feedback loop is fastest and the prior art (Polymarket V2 builder codes, Hyperliquid HIP-3) is closest. Build the primitive generic so the next five verticals slot in without redesign.

## The One-in-a-Million Bet

Do not build another trading agent. Build the credit, risk, and settlement network that every serious trading agent has to plug into before allocators will fund it.

The rare idea is this:

> Forum turns autonomous agents from unfundable black boxes into underwritable financial actors.

That is bigger than a prediction-market bot, an arbitrage bot, or a copy-trading dashboard. Bots compete on alpha. Forum competes on trust, capital access, enforcement, and distribution. The agent that wins a trade is valuable for a moment. The network that decides which agents deserve capital can become infrastructure.

The company should be pitched as:

> The prime broker, credit bureau, and risk exchange for autonomous market agents.

Shorthand one-liner for warm intros (use as positioning, **not** as a claim of equivalent scale today):

> Stripe Connect plus Numerai for autonomous market agents, settled in USDC on Arc.

Arc and USDC matter because the account primitive only works if enforcement, funding, slashing, and settlement are cheap enough to happen continuously. If enforcement costs dollars or settles slowly, the product becomes a dashboard. On Arc, it can become a live control plane.

## Public Comparables

The structural analog is **ICE / LSEG / CME** — a vertically integrated clearing + data-feed + asset-manager company. Approximate market caps (from training data, must be re-verified before any external pitch): ICE ~$80B, LSEG ~$70B, CME ~$80B. None of those companies got to $50B+ on a single product; each owns three reinforcing surfaces that no incumbent can dislodge in isolation. Forum's analog triangle:

| Surface              | Codex section          | Public comp                              | Comp logic                                                                                                              |
| -------------------- | ---------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Clearing**         | Covenant Accounts (#1) | ICE clearing house, DTCC                 | Fee per dollar cleared. Standards capture + counterparty trust make it defensible at 1bps for decades.                  |
| **Data**             | AgentScore (#2)        | S&P Global ~$110B, MSCI ~$50B, Bloomberg | Subscription + license fees. Mandatory input to allocator decisions. Auditable on-chain snapshots are the unique angle. |
| **Asset management** | Capital Router (#4)    | Vanguard ~$9T AUM, BlackRock ~$11T       | AUM fees (50–200 bps). Regulated wrapper. Requires RIA / FCA / MAS licensing — different game.                          |

Each surface alone is a $1–5B business. Combined, with cross-surface reinforcement (clearing produces the data; data drives the AUM; AUM drives more clearing volume), $20–80B is the credible long-term range if the autonomous-agent economy hits $1T+ in cleared volume by 2030–2032.

The lighter comp — "Stripe Connect for AI agents" — is a $1–3B feature business. That is the floor outcome if standards capture and the data-feed network effect don't land. We should pitch the ceiling, build for the floor.

## Verified Constraints

The roadmap is built against verified hackathon and stack constraints:

- Agora is for agents that trade, invest, create, and interface with markets, settled instantly on Arc with USDC: https://agora.thecanteenapp.com/
- Agora judging weights agency and traction heavily, with Circle/Arc usage and innovation also material: https://agora.thecanteenapp.com/
- Arc positions itself for stablecoin finance and the agentic economy: https://docs.arc.io/
- Arc App Kit exposes Bridge, Swap, Send, and Unified Balance product flows: https://docs.arc.io/app-kit
- Circle Gateway gives a unified USDC balance across chains and can transfer from that balance quickly once established: https://developers.circle.com/gateway
- CCTP moves native USDC across chains by burn/mint and supports programmable destination actions: https://developers.circle.com/cctp

## Market Reality

Verified market scan:

- Agent-wallet security already exists as a category. Sigil, for example, positions agent wallets around transaction validation, policies, session keys, whitelists, and emergency freezes: https://sigil.codes/
- DeFi risk scoring already exists as a category. Philidor publishes risk scores and methodology for on-chain capital and vaults: https://www.philidor.io/
- Agentic capital management platforms already exist. Ampli positions around financial agents, smart accounts, MPC, operation validation, and fee distribution: https://ampli.net/
- Recent research argues that capital-managing agents need operating-layer controls across prompt compilation, typed controls, policy validation, execution guards, memory, and observability: https://arxiv.org/abs/2604.26091
- Recent research also frames trustworthy agents as a financial-risk problem with enforceable compensation and underwriting, not only a model-quality problem: https://arxiv.org/abs/2604.03976

Therefore the winning claim is not "no one has policy wallets." That claim is false or at least unprovable.

The winning claim is:

> Forum is the first Arc-native fundability layer where an agent account, receipt trail, slash history, mandate template, and capital allocation decision all compound into one underwriting graph.

Competitors can secure a wallet or score a vault. Forum should make agents fundable.

## Current Box Score

Already real:

- live Arc testnet contracts;
- Covenant Account primitive;
- bounded credit, pause, and slash proof;
- public receipt trail;
- browser-side receipt hash verification against TrackRecordV2;
- CLI receipt verification;
- TypeScript and Python SDK clients;
- live VPS demo at https://forum.gudman.xyz.

Still weak:

- no external agent operator yet;
- no live venue fill with real order ID yet;
- no self-serve vault factory yet;
- no indexer-backed product surface yet;
- no Circle Gateway, CCTP, App Kit, Wallets, or USYC integration in the live path yet;
- no venue allowlist enforced directly on-chain yet;
- no allocator-facing product yet.

The roadmap below is designed to close those weaknesses in the right order: credibility first, external agents second, capital third, risk markets last.

## Product North Star

**USDC under enforceable agent covenants.**

Do not use vanity metrics as the north star. Registered bots, page views, and receipt count are supporting indicators. The company only becomes large when capital is actually placed under mandates that can be verified, enforced, and reused.

Primary metric:

`Covenanted AUM = USDC deposited into live Covenant Accounts with active mandates, live receipts, and slashable bonds`

Secondary metrics:

- externally operated agents;
- verified live fills;
- enforceable mandate templates used;
- receipts verified by third parties;
- risk events enforced;
- fees routed through Forum;
- allocator retention.

## The Product Stack

Any AI agent that moves money on someone else's behalf needs the same seven things. Forum's seven product surfaces map one-to-one against them — this is why the stack is the stack:

| Universal agent need  | Forum surface                                                    |
| --------------------- | ---------------------------------------------------------------- |
| 1. Identity           | `BuilderCodeRegistry` (#1 prereq, ships under Covenant Accounts) |
| 2. Bounded authority  | **Covenant Accounts** (#1)                                       |
| 3. Public receipts    | `TrackRecordV2` + receipt verifier (#1 / #2)                     |
| 4. Risk controls      | **Execution Guard** (#5) + RiskKernelV2 enforcement              |
| 5. Fee routing        | `FeeDistributor` + **Fee Router** (Phase 6)                      |
| 6. Capital allocation | **Capital Router** (#4)                                          |
| 7. Reputation         | **AgentScore** (#2)                                              |

If any of those seven are missing or unauditable, capital cannot fund the agent. Build the seven surfaces in order; do not skip ahead.

### 1. Covenant Accounts

The base account primitive.

What it does:

- holds depositor USDC;
- gives the agent bounded credit;
- encodes budget, drawdown, freshness, expiry, performance fee, and bond;
- lets anyone enforce the mandate.

Current status:

- live on Arc testnet;
- autonomous pause plus slash proof exists;
- operator credit is bounded by amount/state but not venue-restricted on-chain.

Next standard:

- self-serve creation;
- venue allowlists;
- per-market limits;
- max open exposure;
- daily loss cap;
- emergency withdraw queue;
- Safe-style operator roles;
- receipt requirement before additional credit is released.

### 2. AgentScore

The reputation layer.

What it computes:

- verified receipt count;
- stale receipt rate;
- longest uninterrupted receipt streak;
- realized PnL from verified fills;
- drawdown;
- risk-adjusted return;
- bond coverage ratio;
- slash history;
- mandate breach history;
- strategy drift.

This is the main data moat. Every agent that wants capital must publish into the graph. Every allocator that wants agent exposure needs the graph.

### 3. Mandate Exchange

A marketplace for enforceable risk templates.

Examples:

- conservative prediction-market maker;
- directional +EV prediction trader;
- cross-market arb bot;
- event-risk hedger;
- treasury carry agent;
- perps funding-rate agent;
- social-copy allocator.

Each template includes:

- allowed venues;
- allowed assets;
- budget;
- max drawdown;
- max single-market exposure;
- receipt frequency;
- bond requirement;
- performance fee;
- expiry;
- liquidation/slash rules.

This turns Forum from a one-off vault into a standard.

### 4. Capital Router

The allocator product.

What it does:

- reads AgentScore;
- ranks agents by risk-adjusted verified performance;
- allocates USDC across Covenant Accounts;
- withdraws from stale or degraded agents;
- rebalances across agents;
- parks idle USDC in approved yield rails when available.

This is the first product that can feel like a fund, but it should stay mandate-first and transparent.

### 5. Execution Guard

The safety layer between agent decisions and capital movement.

What it checks before credit or execution:

- mandate state;
- venue allowlist;
- market exposure;
- inventory;
- quote age;
- expected slippage;
- daily loss;
- receipt freshness;
- bond ratio.

This is how Forum stops being "post-trade audit" and becomes "pre-trade guardrail."

### 6. Settlement Mesh

The Circle/Arc expansion layer.

Use it when live support and integrations are ready:

- App Kit Bridge for USDC movement into Arc flows;
- Gateway unified balance for cross-chain agent liquidity;
- CCTP for native USDC movement and programmable destination actions;
- USYC or equivalent for idle capital parking;
- Send/Swap flows for agent operations.

The product principle: Arc stays the control plane. Other venues are execution planes.

### 7. Risk Markets

The billion-dollar wedge after the account network exists.

Once AgentScore and slashing history exist, users can price agent risk:

- slash insurance;
- breach prediction markets;
- bond yield markets;
- mandate risk tranching;
- agent credit ratings;
- portfolio stress-test markets.

This is where Forum becomes more than infrastructure. It becomes the market where agent risk is priced.

## Day-90 Non-Negotiables

Multibillion-scale clearing/data/asset-management businesses do not happen with three engineers and an LLM. The hires that _must_ be in motion within 90 days of seed funding (or hackathon-prize funding, whichever lands first) — not roadmap items, founding conditions:

| Role                                              | Why Day 90 (not Year 2)                                                                                                                                                                                                                                                                          | Sourcing                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Chief Compliance Officer + securities counsel** | Year-3 RIA registration in the US, FCA-approved in UK, MAS-licensed in SG cannot start in year 3. The CCO has to be in seat _before_ any partnership conversation with a regulated counterparty. Coinbase and Circle both shipped this hire at seed; the ones that waited got disrupted.         | Securities-law boutique on retainer first; full-time CCO once Series A closes. |
| **VP Eng who has shipped a clearing system**      | DTCC / NYSE / Cboe / Coinbase Institutional / Galaxy alumni. Not a crypto-native; a clearing-native. The architectural decisions in year 1 (factory pattern, chain-agnostic identity, slash-bond vs insurance-reserve separation) are what determine whether year-5 can hit institutional scale. | Direct outreach. Public clearing-system engineering is a small pond.           |
| **Head of Standards + Partnerships**              | Runs the ERC-XXX (Mandate-Bounded Agent Accounts) drafting + the Forum Council formation. Without this, "standards capture as moat" is a wish, not a plan.                                                                                                                                       | EIP-author backgrounds; Linux-Foundation / W3C alumni; ex-Stripe Open Source.  |
| **Quant lead**                                    | Owns AgentScore methodology, defensibility against gaming, calibration against real PnL. Without this, AgentScore is a feature; with this, it's a data product.                                                                                                                                  | Academic finance / quant fund alumni. Not a generalist data scientist.         |
| **Enterprise sales (Year 2)**                     | Sells AgentScore subscriptions to Polymarket, Hyperliquid, Coinbase Institutional, allocator dashboards. Compensation must be subscription-recurring-revenue oriented from day one.                                                                                                              | Bloomberg / FactSet / Refinitiv sales alumni; not crypto sales.                |

The user-side action that has to happen in parallel to _any_ engineering ship plan: **begin the CCO + securities-counsel search immediately**. Every month this slips pushes the Year-3 RIA path back by ~6 weeks because of registration timelines.

## Roadmap

### Phase 0: Hackathon Close

Timebox: now to submission.

Goal: win by making the primitive undeniable.

Ship:

- polished live demo;
- public receipt verification in UI and CLI;
- clean submission;
- demo video;
- one external-adapter plan in the open;
- no exaggerated claims.

Success criteria:

- judge can verify the pause plus slash tx;
- judge can verify receipt hash against chain;
- judge understands this is an account primitive, not a trading bot;
- all claims survive code inspection.

Do not ship:

- fake external traction;
- fake real trading;
- unverified market-size claims;
- regulatory promises.

Investor framing:

- "We are not asking you to believe our bot is smart. We are showing you the rails that make any bot underwritable."
- "The proof is not a screenshot. It is a public receipt, a public hash, a public pause, and a public slash."
- "Arc is the reason enforcement can be cheap enough to run as product logic instead of back-office audit."

Submission stance — submit Forum as:

> The Covenant Account primitive for market agents on Arc: bounded USDC credit, public receipts, and permissionless risk enforcement.

Do **not** submit Forum as:

> A profitable AI trading bot.

That claim is not proven and weakens everything that _is_ proven.

### Phase 1: Self-Serve Covenant Account

Timebox: 2 weeks.

Goal: anyone can launch a fundable agent account without reading Solidity.

Ship:

- create-vault flow;
- mandate builder UI;
- operator bond flow;
- USDC approve/deposit flow;
- live risk status;
- withdraw flow;
- receipt explorer per agent;
- one-click enforce;
- SDK examples for vault creation and receipt publishing.

Engineering:

- add factory contract;
- indexer API;
- event database;
- frontend moves off raw RPC scanning;
- receipt verification service;
- formal deployment manifest.

Success metric:

- 5 non-internal Covenant Accounts created on testnet.

Product bar:

- a user can create, fund, monitor, pause, and withdraw from a Covenant Account without contacting the team;
- the UI must show the exact risks still not enforced on-chain;
- every account must have a public verification page.

### Phase 2: First External Agent

Timebox: 3-4 weeks.

Goal: prove this is not self-play.

Ship:

- adapter SDK;
- one real external bot integration;
- at least one external receipt sequence;
- public reproducible adapter demo;
- maintainer acknowledgement or objectively reproducible setup.

Best target profile:

- public repo;
- structured logs or fills;
- simple strategy;
- small maintainer surface;
- easy to run in paper mode first.

Success metric:

- 1 external operator publishes 10+ receipts through Forum.

Do not accept a fake integration. The external operator must either run the adapter themselves or the setup must be reproducible from a public repo.

### Phase 3: Verified Live Execution

Timebox: 6 weeks.

Goal: move from paper-mode to real, tiny-capital execution.

Ship:

- one live trading account with capped USDC;
- market-attributed fills;
- venue order IDs;
- realized/unrealized PnL recomputation;
- maker rebate accounting if available;
- failure-mode receipts;
- public postmortem format.

Risk controls:

- max loss per day;
- max loss per market;
- hard venue allowlist;
- min receipt interval;
- no additional credit if previous receipt missing;
- auto-pause on verifier failure.

Success metric:

- 100% of live fills reconcile to public receipts and on-chain evidence hashes.

This is the moment Forum becomes investable. Before this, Forum is a strong protocol demo. After this, it is a capital-control product.

### Phase 4: AgentScore v1

Timebox: 8 weeks.

Goal: make capital allocation data-driven.

Ship:

- public agent profiles;
- score calculation;
- freshness/drawdown charts;
- slash history;
- verified PnL;
- risk-adjusted leaderboards;
- API endpoint for allocators.

The leaderboard must not rank by raw PnL. It must rank by risk-adjusted verified performance under a comparable mandate.

Success metric:

- 10 agents with comparable public scores.

AgentScore should be difficult to game. Penalize missing receipts, mandate drift, unverified fills, sudden exposure changes, and stale inventory. Reward boring reliability more than lucky PnL.

### Phase 5: Capital Router

Timebox: 12 weeks.

Goal: Forum allocates across agents under transparent rules.

Ship:

- allocator strategy templates;
- target weights;
- max allocation per agent;
- auto-withdraw on stale receipts;
- auto-enforce on breach;
- reallocation receipts;
- allocator performance profile.

This is the first product that should feel like "AI fund of agents."

Success metric:

- 25%+ of deposited testnet capital controlled by allocator templates, not manual deposits.

The Capital Router is the real product wedge. It converts Forum from "risk tooling for operators" into "capital distribution for agents."

### Phase 6: Fee Router

Timebox: 3-4 months.

Goal: prove the revenue loop.

Ship:

- fee reconciliation service;
- source venue payout tracking;
- USDC movement into Arc;
- `FeeDistributor` split execution;
- operator/researcher/referrer accounting;
- downloadable monthly statement.

Success metric:

- first real or testnet-equivalent fee flow reconciled end to end.

Revenue should be earned when Forum creates measurable trust, routes measurable capital, or reconciles measurable fees. Do not charge for unverifiable claims.

### Phase 7: Cross-Chain Liquidity

Timebox: 4-6 months, dependent on live stack support.

Goal: agents access USDC where they need it while Arc remains the control plane.

Ship:

- App Kit deposit/send/bridge flows;
- Gateway unified-balance allocator prototype;
- CCTP movement for venue settlement;
- idle capital policy;
- cross-chain receipt linkage.

Success metric:

- one Covenant Account funds execution across more than one chain/venue while Arc remains the mandate ledger.

This phase is where Circle's stack becomes strategically visible. Gateway and CCTP should not be brochure integrations. They should solve a real capital problem: an agent has one risk mandate on Arc but needs USDC at the venue where the opportunity exists.

### Phase 8: Institutional Prime

Timebox: 6-9 months.

Goal: make Forum usable by serious allocators.

Ship:

- organization accounts;
- role-based access;
- policy approval workflows;
- audit export;
- mandate legal text generator;
- risk officer dashboard;
- API keys and webhooks;
- SOC-style control checklist;
- security review.

Success metric:

- first professional trading team or fund runs an agent under a Forum mandate.

This requires counsel, security review, and conservative language. The product can be non-custodial and mandate-driven, but investor-facing capital allocation has legal edges. Treat legal design as product design.

### Phase 9: Risk Markets

Timebox: 9-12 months.

Goal: price agent risk.

Ship:

- slash insurance pool;
- breach prediction markets;
- bond yield;
- agent risk tranches;
- AgentScore oracle;
- risk market settlement rules.

This is the expansion from "we monitor agents" to "we are the market for agent risk."

Success metric:

- third parties take the other side of agent risk using Forum data.

This is the multibillion-dollar expansion. If Forum owns the data used to underwrite agent failure, then risk markets, insurance, ratings, and allocator products can all sit on top of the same graph.

## Board-Level Milestones

### 30 Days

- 5 self-serve Covenant Accounts;
- 1 external adapter;
- 1 external receipt publisher;
- AgentScore v0;
- public receipt explorer;
- venue allowlist design reviewed.

### 60 Days

- 10 external agents or operators in pipeline;
- 3 live external receipt streams;
- first capped live execution pilot;
- indexer-backed frontend;
- mandate template library;
- first Circle App Kit flow in product.

### 90 Days

- 25 active Covenant Accounts;
- 5 external agents publishing receipts weekly;
- first fee reconciliation path;
- first allocator template controlling deposits;
- public agent leaderboard ranked by risk-adjusted verified performance;
- security review plan.

### 6 Months

- real USDC allocation pilot under strict legal and operational boundaries;
- Gateway/CCTP-backed cross-chain funding path;
- institutional dashboard;
- API keys and webhooks;
- external teams using Forum as their funding credential;
- first insurance or risk-pricing prototype.

### 12 Months

- meaningful Covenanted AUM;
- agent risk score used by third parties;
- mandate marketplace;
- fee router with recurring revenue;
- risk market pilot;
- security audit and compliance posture suitable for serious allocators.

### Investor-Grade Pre-Pitch Checklist

Before any institutional VC / strategic-acquirer / regulated-allocator conversation, ship every item on this list — no exceptions. These are the artefacts that turn "interesting hackathon project" into "diligence-ready company":

- one external adapter integrated and publishing receipts;
- one third-party acknowledgement of that adapter (maintainer tweet, PR comment, blog mention) OR objectively reproducible external setup from a public repo;
- full PnL recomputation for live fills, not just hash verification;
- indexer-backed dashboard (frontend reads from the indexer, not raw RPC);
- one real fee routing / reconciliation event end-to-end;
- security review notes (third-party or internal-with-counsel attestation);
- clean data room: deployment addresses, test results, demo video, risk register, cap table.

Without these, a serious investor conversation is premature. With these, the conversation has a baseline of credibility regardless of how the company is positioned (clearing primitive, asset manager, data feed, or hybrid).

## Exit Math

Honest financial framing for the multibillion outcome. All revenue multiples are public-comp approximations and must be re-verified against current trading multiples before any external pitch.

| Year  | Cleared volume | AUM    | Revenue mix                             | ARR     | Implied EV                            |
| ----- | -------------- | ------ | --------------------------------------- | ------- | ------------------------------------- |
| 2027  | $1B            | —      | $5M clearing                            | $5M     | Series A round, $20–40M post          |
| 2028  | $10B           | —      | $30M clearing + $15M data + $5M misc    | $50M    | Series B round, $300–500M post        |
| 2029  | $50B           | $5B    | $100M clearing + $75M data + $75M AUM   | $250M   | Series C, $1.5–2.5B post              |
| 2030  | $200B          | $20B   | $400M clearing + $300M data + $300M AUM | $1B     | Pre-IPO secondary at $8–12B           |
| 2031  | $500B          | $50B   | (same mix scaled)                       | $1.5–2B | **IPO at $15–30B**                    |
| 2033+ | $1T+           | $100B+ | + insurance brokerage + Risk Markets    | $5–10B  | $50B+ comp range (ICE / LSEG ceiling) |

Multiples assumed in the EV math (verify before quoting externally):

- **Clearing revenue:** 15–25× (LSEG ~20×, ICE ~18×, CME ~22×).
- **AUM:** 1.5–2.5% of AUM as enterprise value (Vanguard / BlackRock band, varies with rate environment).
- **Data feed revenue:** 8–12× (S&P Global / Bloomberg-comparable band, the highest multiple in the mix).

The data-feed line item carries the highest multiple. If standards capture lands and AgentScore becomes the mandatory subscription for every allocator + every venue, the rev mix shifts toward data and the EV multiple compounds. That is the difference between the $15B floor IPO and the $50B+ ceiling acquisition.

**Likely exit outcomes**, ranked by probability under the verified-constraint roadmap:

1. **Strategic acquisition by Stripe at $20–35B in 2030–2031** — Stripe is the only acquirer that can integrate clearing + data + asset-management cleanly. Most likely outcome.
2. **IPO at $15–30B in 2031** — if the data business is mature enough that the public market can price it separately from clearing.
3. **Strategic acquisition by Circle, ICE, or Coinbase Institutional at $10–25B** — Circle wants the Arc-native clearing primitive; ICE wants the data feed; Coinbase wants the regulated allocator product. Each would underprice the standalone trajectory.
4. **Founder-led private operating company at $5–10B EV with $200–500M ARR** — if the team chooses operating optionality over exit.

The plan must survive any of these four outcomes without architectural rework. Specifically: don't take a token route (closes acquisition optionality), don't centralize critical control surfaces (closes IPO compliance path), don't sign exclusivity (closes acquirer competition).

## Investor Narrative

The world is moving from human-operated software to autonomous financial actors. The blocker is not whether agents can generate trades. The blocker is whether anyone should fund them.

Forum solves that blocker with enforceable accounts:

1. the depositor funds a Covenant Account in USDC;
2. the agent receives bounded operating authority;
3. every receipt is hashed and published;
4. RiskKernel enforces mandate breaches;
5. slash history and performance become AgentScore;
6. allocators route capital to agents with verified histories;
7. the market starts pricing agent risk.

This is why the company can become large. It sits at the junction of agent wallets, risk underwriting, stablecoin settlement, capital allocation, and market data.

## Product Principles

1. Never sell performance before verification.
2. Never call something autonomous if a human must click the critical path.
3. Never claim custody safety if funds are transferred to an unrestricted operator wallet; say bounded credit until venue restrictions ship.
4. Do not optimize for receipt count. Optimize for verified capital under enforceable mandates.
5. Every demo must have a public tx, public receipt, and public verifier.
6. The UI should expose risk first, returns second.
7. Forum should make bad agents fail visibly and quickly.

## Moat

### Data Moat

AgentScore improves with every receipt, fill, breach, and slash. Competitors can copy contracts; they cannot copy verified agent histories once capital starts using them.

### Standard Moat

Mandate templates become the shared language for funding agents. Once allocators compare agents by standardized mandates, agents must publish in that format.

### Capital Moat

Agents go where capital is. Capital goes where risk is enforceable. That loop compounds.

### Distribution Moat

The first external agents are acquired through adapters. Later agents integrate directly because a Forum score becomes a prerequisite for funding.

## Business Model

Do not tax the base protocol too early. Build trust first.

Revenue sequence:

1. hosted agent operations;
2. premium AgentScore API;
3. fee routing/reconciliation;
4. mandate template marketplace;
5. institutional dashboards;
6. risk market fees;
7. allocator service fees.

## External Risks (Things Outside Our Control)

Codex's Kill Criteria covers internal failure modes ("if our hypothesis is wrong, we fold"). These are the _external_ risks that can kill the company even if every internal hypothesis is right. They are not roadmap items; they are watch-list items with explicit mitigations.

| Risk                                                                                                                                                                                                                                | Mitigation                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A regulated incumbent decides this is their lane.** Stripe Connect for AI agents is one product launch away. Circle could vertically integrate. ICE / CME / Coinbase Institutional could announce a competing clearing primitive. | Get 18 months of head start on AgentScore-as-data-feed. Once 5+ external consumers depend on the API, the data moat is harder to replicate than the contract moat. Ship the indexer + factory + ERC draft _before_ any incumbent realizes data is the business.              |
| **The agent economy doesn't consolidate around clearable units.** If every AI agent stays inside its own closed system (OpenAI marketplace, Anthropic marketplace, etc.), there is no neutral clearing layer needed.                | Ship chain-agnostic identity in 2027 to make "any agent, any wallet, any chain" the default expectation before walled gardens harden.                                                                                                                                        |
| **SEC / CFTC classifies Covenant Accounts as collective investment vehicles.** Once real capital flows, this is a _when_ not _if_.                                                                                                  | Day-90 securities-counsel engagement. Structure each Covenant Account as a single-investor mandate enforcement primitive, not a pooled vehicle. Pursue a no-action letter on the clearing-primitive framing before scaling Capital Router.                                   |
| **First high-profile slash that wipes a real depositor produces a media event.**                                                                                                                                                    | Cap individual Covenant Accounts at $10k for 18 months. Ship the slash → recipient flow front-and-center on the frontend so depositors can never claim they didn't know what they were underwriting. Publish a public postmortem template before the first slash, not after. |
| **Circle pivots away from Arc as the agent-economy chain.** If Circle de-prioritizes Arc (mainnet beta slips, dev focus shifts to Base, $222M raise underperforms), Forum's chain-bet becomes a stranded asset.                     | Keep CovenantVault chain-agnostic Solidity. Design the v2 deploy to any USDC-native EVM L1. AgentRegistry on the most-used chain at the time, mirrored elsewhere via CCTP-style attestations.                                                                                |
| **Hashnote permissions Arc-testnet USYC indefinitely.**                                                                                                                                                                             | Yield surface on the Capital Router should be pluggable. If USYC stays gated, swap in Aave / Morpho / sDAI / Ondo USDY. Don't make USYC a single point of failure.                                                                                                           |

## Kill Criteria

If these do not become true, the company is not working:

- external agents refuse to publish receipts;
- allocators do not care about receipt-backed performance;
- real fills cannot be reconciled reliably;
- risk enforcement is too slow or too expensive;
- legal/regulatory constraints make open allocation impossible;
- no one will deposit even tiny capital under a live mandate.

## The Next 10 Ships

Recommended order:

1. Record the hackathon demo.
2. Ship self-serve Covenant Account creation.
3. Build a receipt explorer with pass/fail verification.
4. Build one external adapter.
5. Add venue allowlists and per-market exposure caps.
6. Move frontend reads to an indexer.
7. Ship AgentScore v0.
8. Run a tiny live execution pilot.
9. Reconcile one fee flow.
10. Pitch external teams with "bring your bot, get fundable in one afternoon."

## Final Product Sentence

Forum makes autonomous market agents fundable.

Arc settles the mandate. USDC funds it. Receipts prove it. RiskKernel enforces it. AgentScore ranks it. Capital Router scales it.
