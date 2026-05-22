# Forum Demo Video Script - v4

Target: **2:40-3:10**, 1080p screen capture, real human voiceover.
Tone: direct, allocator-facing, honest about scope.

> Do not submit the video or hackathon form without explicit user approval.

## Pre-flight

Run these before recording:

```bash
# live indexer is fresh
curl -s https://forum.gudman.xyz/api/health

# real Polymarket proof is live
curl -s https://forum.gudman.xyz/api/proof

# live Claude trace exists
curl -s https://forum.gudman.xyz/receipts/201c8909dca1/traces/000145.json

# real-fill receipt verifies
cd keeper
npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json
```

Expected evidence:

- `/api/health` is fresh and not stale.
- `/api/proof` shows two real Polymarket V2 fills.
- trace `000145` includes `model: "claude-sonnet-4-6"`.
- verifier returns `pnl: valid` for the real-fill receipt.

## Tabs To Pre-open

1. `https://forum.gudman.xyz/#/console?t=polymarket`
2. `https://forum.gudman.xyz/#/console?t=agents`
3. `https://forum.gudman.xyz/#/console?t=router`
4. `https://forum.gudman.xyz/#/console?t=fees`
5. `https://forum.gudman.xyz/#/console?t=bridge`
6. Arc explorer tab for the slash tx from `SUBMISSION.md`
7. `https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json`
8. Terminal in `keeper/`

## Storyboard

### 0:00-0:20 - Open With The Claim

On screen: console header and evidence strip.

Voiceover:

> Forum is a USDC control layer for AI market agents. A depositor funds a
> Covenant Account on Arc. The operator receives bounded credit, posts a
> slashable bond, publishes receipts, and can be paused or slashed by a public
> risk kernel if the mandate is breached.

### 0:20-0:55 - What Is Real Today

On screen: Verify tab.

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

### 0:55-1:20 - The Funded Covenant Account

On screen: Agents tab. Click the real-fill bot if visible.

Voiceover:

> The real-fill bot is now bound to a funded Covenant Account. That means the
> same bot identity that has a recomputable Polymarket receipt also has a
> slashable, risk-enforced vault on Arc. This is the core Forum object:
> a fundable agent account with public evidence and enforceable limits.

Point at:

- bot `0x75d6577d...0ef0`;
- linked vault `0x4B78...E61d`;
- `verifiedPnl: recomputed-from-fills`.

### 1:20-1:45 - Autonomous Risk Enforcement

On screen: Arc explorer slash transaction.

Voiceover:

> The risk kernel is permissionless. In this transaction, anyone could call
> `enforce(vault)`. The vault paused and the operator bond was slashed in the
> same on-chain action. This is why Forum is different from a leaderboard:
> bad or stale behavior has an automatic capital consequence.

### 1:45-2:05 - Claude Agent Reasoning

On screen: latest Claude trace JSON or the agent inspector reasoning panel.

Voiceover:

> AgoraMind is now a real Claude Sonnet 4.6 keeper, not the old mock policy.
> It publishes decision traces with action, conviction, risk posture, size,
> and reasoning. D95 throttles model calls to publish cycles, so the agent is
> live without burning API budget every tick.

### 2:05-2:30 - Router And Fees

On screen: Router tab, then Fees tab.

Voiceover:

> The router proves the allocator side. Five USDC is routed across two vault
> targets on a strategist weight table, and anyone can rebalance. Fee Router
> proves the revenue side: operators, researchers, and referrers can receive
> pull-based splits. Today this is self-operated demo capital, not third-party
> adoption, but the mechanism is on-chain and live.

### 2:30-2:50 - Circle Bridge

On screen: Bridge tab.

Voiceover:

> Funding can come from native USDC using Circle CCTP V2. The browser builds
> the burn-and-mint route from source testnets into Arc and can deposit into a
> vault. A full recorded end-to-end transfer still needs source-chain testnet
> gas and USDC, so do not oversell this as completed mainnet flow.

### 2:50-3:05 - Close

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
- "External users have adopted it."
- "The bridge has been recorded end-to-end" unless you actually run it on camera.

## Technical Judge Appendix

Use these if a judge asks for reproducibility:

```bash
cd keeper
npx tsc --noEmit
npx vitest run --reporter=default
npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/75d6577d49ef/000001.json

cd ../sdk-ts
npx tsc --noEmit
```
