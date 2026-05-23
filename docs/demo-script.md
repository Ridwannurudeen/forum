# Forum Demo Video Script - v5

Target: **3:00-3:30**, 1080p screen capture, real human voiceover.
Tone: direct, allocator-facing, honest about scope.

> Do not submit the video or hackathon form without explicit user approval.

> v5 changes: the console was restructured — tabs are now **Operations / Create /
> Fund / Vault / Agents / Verify**. The old `polymarket`, `router`, and `fees`
> tabs no longer exist (those deep-links now fall back to Operations). v5 re-cuts
> those beats to where the data now lives and adds the strongest current assets:
> the watch-your-vault view on a live demo Covenant Account, a live autonomous
> slash, and three real external operators.

## Pre-flight

Run these before recording (all verified live 2026-05-23):

```bash
# live indexer is fresh
curl -s https://forum.gudman.xyz/api/health

# real Polymarket proof is live
curl -s https://forum.gudman.xyz/api/proof

# live demo Covenant Account: ACTIVE, 1.24 USDC outstanding
curl -s https://forum.gudman.xyz/api/covenant/0xf6Cc85fa088B35c4A28c822486E3aAb51Ffc3766

# slash drill vault: PAUSED
curl -s https://forum.gudman.xyz/api/covenant/0x49E7332a054481a5aa641627D29C999D19541FF9

# live Claude trace exists
curl -s https://forum.gudman.xyz/receipts/201c8909dca1/traces/000145.json

# real-fill receipt verifies
cd keeper
npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json

# a real external operator's receipt also verifies
npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/9a5ace3b071b/000001.json
```

Expected evidence:

- `/api/health` is fresh and not stale.
- `/api/proof` shows two real Polymarket V2 fills, `verifiedFillCount: 1`, builder fee `0 bps`.
- demo vault `state: ACTIVE`, `outstandingMicros: 1240000`.
- slash vault `state: PAUSED`.
- trace `000145` includes `model: "claude-sonnet-4-6"`.
- verifier returns `pnl: valid` for both the real-fill and the external-operator receipt.

## Tabs To Pre-open

1. `https://forum.gudman.xyz/#/console?t=verify` - real Polymarket fill proof + builder-fee status + receipt verifier
2. `https://forum.gudman.xyz/#/console?t=agents` - AgentScore leaderboard with three external operators (badged)
3. `https://forum.gudman.xyz/#/console?t=vault&v=0xf6Cc85fa088B35c4A28c822486E3aAb51Ffc3766` - live demo Covenant Account (ACTIVE / ALLOW / 1.24 USDC outstanding / Claude reasoning)
4. `https://forum.gudman.xyz/#/console?t=vault&v=0x49E7332a054481a5aa641627D29C999D19541FF9` - slashed vault (PAUSED / PAUSE_STALE / bond slashed)
5. `https://forum.gudman.xyz/#/console?t=overview` - Operations dashboard (keeper status, router split, RiskKernel verdict)
6. `https://forum.gudman.xyz/#/console?t=bridge` - Circle CCTP V2 bridge
7. `https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json` - raw recomputable receipt
8. Terminal in `keeper/`

## Storyboard

### 0:00-0:20 - Open With The Claim

On screen: console Operations tab / landing header.

Voiceover:

> Forum is a USDC control layer for AI market agents. A depositor funds a
> Covenant Account on Arc. The operator receives bounded credit, posts a
> slashable bond, publishes receipts, and can be paused or slashed by a public
> risk kernel if the mandate is breached.

### 0:20-0:55 - What Is Real Today

On screen: **Verify** tab.

Voiceover:

> This is not just a dashboard mock. Forum has real Arc contracts, a fresh
> indexer, a live Claude Sonnet keeper, and real Polymarket V2 mainnet fills.
> The Polygon settlements are on-chain. Builder attribution is confirmed by
> Polymarket's attribution API. The fill is anchored back to Arc as a
> TrackRecordV2 receipt, and the verifier recomputes PnL from the fill data.

Point at:

- two real fills;
- `verifiedPnl: recomputed-from-fills`;
- `verifiedFillCount: 1`;
- builder fee rate `0 bps`.

Say this caveat clearly:

> The historical Polymarket fill was not funded from the Arc vault. That
> vault binding happened after the fill. What is proven here is the account,
> receipt, attribution, and risk-control layer. Full vault-USDC to Polymarket
> pUSD automation is the next capital-flow milestone.

### 0:55-1:25 - Real External Operators

On screen: **Agents** tab.

Voiceover:

> Forum is not just my own wallet talking to itself. Three external operators
> have onboarded their own agents - each with its own signer, its own published
> receipts, and an "external" badge here on the leaderboard. One ran on a
> genuinely separate machine. And every receipt is content-pinned: the indexer
> only hosts it if its hash matches the on-chain TrackRecordV2 evidence hash, so
> the chain itself is the gate.

Point at:

- the three "external" badges + the external-operator count chip;
- the real-fill bot `0x75d6577d...0ef0` with linked vault `0x4B78...E61d` and `verifiedPnl: recomputed-from-fills`.

### 1:25-1:55 - The Funded Covenant Account, Live

On screen: **Vault** watch view on the demo vault `0xf6Cc85fa...3766`.

Voiceover:

> This is one Covenant Account, live. Five USDC deposited. A real Claude
> Sonnet 4.6 keeper reasons over the market, and 1.24 USDC of credit has been
> drawn under its mandate - you can see it outstanding right here. The risk
> kernel verdict is ALLOW. The same screen shows the bond, the full mandate,
> and the agent's latest decision with conviction and reasoning. Money in, AI
> reasons, verifiable receipt, risk verdict - on one screen.

Point at:

- `state: ACTIVE`;
- RiskKernel verdict `ALLOW`;
- `outstanding 1.24 USDC`;
- the Claude reasoning panel.

### 1:55-2:20 - Autonomous Risk Enforcement

On screen: **Vault** watch view on the slash vault `0x49E7332a...1FF9` (optionally the Arc explorer enforce tx linked from it).

Voiceover:

> The risk kernel is permissionless. On this vault the mandate was breached -
> receipts went stale - so anyone could call `enforce`. In one on-chain action
> the vault paused and twenty-five percent of the operator bond was slashed. The
> verdict reads PAUSE_STALE, the bond dropped from one USDC to seventy-five
> cents, and a quarter of a USDC of real bond was moved. This is why Forum is
> different from a leaderboard: bad or stale behavior has an automatic capital
> consequence.

Point at:

- `state: PAUSED`;
- verdict `PAUSE_STALE`;
- bond `0.75 USDC`, `totalSlashed 0.25 USDC`.

### 2:20-2:40 - Claude Agent Reasoning

On screen: latest Claude trace JSON, or the reasoning panel in the watch view.

Voiceover:

> AgoraMind is a real Claude Sonnet 4.6 keeper, not the old mock policy. It
> publishes decision traces with action, conviction, risk posture, size, and
> reasoning. Model calls are throttled to publish cycles, so the agent is live
> without burning API budget every tick.

### 2:40-3:00 - Allocator Rails: Router And Fees

On screen: **Operations** tab (router split), then **Verify** tab (fee statement).

Voiceover:

> The allocator side is on-chain too. The Operations dashboard shows five USDC
> routed across two vault targets on a strategist weight table, and anyone can
> rebalance. The Verify tab carries the fee statement: operators, researchers,
> and referrers can receive pull-based USDC splits. Today this is self-operated
> demo capital, not third-party adoption, but the mechanism is on-chain and live.

### 3:00-3:15 - Circle Bridge

On screen: **Bridge** tab.

Voiceover:

> Funding can come from native USDC using Circle CCTP V2. The browser builds
> the burn-and-mint route from source testnets into Arc and can deposit into a
> vault. A full recorded end-to-end transfer still needs source-chain testnet
> gas and USDC, so do not oversell this as completed mainnet flow.

### 3:15-3:30 - Close

On screen: console or landing page.

Voiceover:

> Forum is not claiming a finished multi-party economy. It is claiming the
> primitive: programmable USDC credit lines for AI agents, verifiable receipts,
> autonomous risk enforcement, and a path for allocators to fund agents without
> handing over keys.

End card:

```text
forum.gudman.xyz
github.com/Ridwannurudeen/forum
Arc testnet - USDC - CCTP V2 - Polymarket proof
```

## Do Not Say

- "Vault-funded Polymarket trading is complete."
- "Builder attribution is confirmed on-chain."
- "Real fee revenue is live."
- "External users have adopted it." (Three external *operators* have onboarded; that is real. Do not claim paying *users* or third-party *allocators*.)
- "The bridge has been recorded end-to-end" unless you actually run it on camera.

## Technical Judge Appendix

Use these if a judge asks for reproducibility:

```bash
cd keeper
npx tsc --noEmit
npx vitest run --reporter=default

# real-fill receipt verifies
npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json

# external operator receipt verifies (third-party traction)
npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/9a5ace3b071b/000001.json

cd ../sdk-ts
npx tsc --noEmit
```

On-chain risk verdicts and the slash, read directly from Arc
(`RiskKernelV2 0x0aF356...4055`, RPC `https://rpc.testnet.arc.network`):

- `evaluate(0xf6Cc85fa...3766)` (demo vault)  -> `ALLOW`
- `evaluate(0x49E7332a...1FF9)` (slash vault)  -> `PAUSE_STALE`
- `SlashBond 0xeAa46B1a...95c9c` (slash vault bond): `bondBalance 0.75 USDC`, `totalSlashed 0.25 USDC`
