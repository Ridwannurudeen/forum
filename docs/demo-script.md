# Forum Demo Video Script — v2 (post-D53 hero rewrite)

Target: **2:30–3:00**, 1080p screen capture, real human voiceover.
Tone: confident, allocator-facing. **No emojis. No bragging. Plain English where possible.**

> **Do not submit the video or hackathon form without explicit user approval.**

The full proof tx hash referenced as `0x2c8e79a5...05d13` below lives in `README.md` under **Verifiable Proofs**. Copy it from there into the browser; do not retype it.

---

## Pre-flight (run before pressing record)

```bash
# 1. CI is green
gh run list --branch main --limit 1 --json conclusion

# 2. Live site loads + indexer is fresh
curl -s https://forum.gudman.xyz/api/health
# expect: ok:true, freshnessSec < 60

# 3. Receipt URL serves
curl -s -o /dev/null -w "%{http_code}\n" \
  https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
# expect: 200

# 4. Verifier runs clean
cd keeper && npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
# expect: pnl: valid (or unverified-paper-mode for v1)

# 5. Vault status (paused = use existing proof tx; active = can demo a live enforce)
cd .. && node keeper/scripts/demo-violation.mjs --dry-run
```

If anything above fails, **don't record yet** — fix it first.

---

## Tabs to pre-open (in this order)

1. `https://forum.gudman.xyz/` — landing
2. `https://forum.gudman.xyz/#/console?t=create` — App console, Create tab
3. `https://forum.gudman.xyz/#/console?t=agents` — App console, Agents tab
4. `https://forum.gudman.xyz/#/console?t=markets` — App console, Markets tab
5. `https://forum.gudman.xyz/#/console?t=router` — App console, Router tab
6. `https://forum.gudman.xyz/#/console?t=fees` — App console, Fees tab
7. `https://testnet.arcscan.app/tx/<full proof tx hash from README>` — the slash tx
8. `https://forum.gudman.xyz/receipts/201c8909dca1/000014.json` — a real signed receipt
9. Terminal in the repo root with the verifier ready to paste

---

## Recording notes

- **Resolution**: 1920×1080 or higher. Browser zoom 100%. Hide bookmarks bar.
- **Mic**: real mic if you have one, AirPods otherwise. Quiet room.
- **Cursor**: visible, but don't wiggle.
- **Do NOT show**: wallet addresses you control (privacy), localhost terminals with secrets, browser history, Slack/email tabs.
- **Pace**: ~140 words/min. The voiceover below is timed for that.

---

## Storyboard + voiceover (read this verbatim)

### 0:00 → 0:15 — Open on the new hero

**On screen**: `https://forum.gudman.xyz/` — full landing, hero in view.

**Voiceover**:

> Forum is programmable credit for AI trading agents. Depositors fund a USDC
> vault on Arc. The agent gets bounded execution rights, not your private key.
> A public risk kernel pauses the vault and slashes the operator bond the
> moment the mandate is breached — one transaction, no admin click.

---

### 0:15 → 0:35 — The problem, in one breath

**On screen**: scroll slowly to the "The gap / Forum's primitive" two-column block.

**Voiceover**:

> Capital wants exposure to autonomous market agents. The choices today are
> bad: hand over a private key and trust the operator, use a managed account
> and lose the millisecond loop bots need, or trust a Sharpe screenshot.
> Forum makes an agent fundable without blind trust.

---

### 0:35 → 1:00 — Proof: one transaction, paused and slashed

**On screen**: switch to the Arc explorer tab on the proof tx
`0x2c8e79a5...05d13`. Highlight: status success, `enforce(address)` decoded,
the USDC transfer out of the bond.

**Voiceover**:

> This is the core proof. One permissionless call to RiskKernelV2.enforce on
> the live vault. The vault flipped from active to paused, and one-and-a-quarter
> USDC moved out of the operator's bond — same transaction, no operator
> click required. The trigger was a stale receipt window. Anyone on Arc
> could have made this call.

---

### 1:00 → 1:25 — The product surface, in one screen

**On screen**: back to `https://forum.gudman.xyz/`. Scroll to the App console.
Click through tabs in this order, ~3 seconds each: Create → Manage → Agents →
Markets → Router → Fees.

**Voiceover**:

> Six surfaces, one wallet. Anyone can create a Covenant Account with a
> mandate in one transaction. Operators post bond and depositors withdraw
> from Manage. Agents shows a live reputation leaderboard ranked by
> drawdown, slash history, and receipt freshness. Markets is an oracle-free
> prediction market that prices the probability of an agent being slashed.
> Router pools depositor USDC across whitelisted vaults. Fees splits
> performance fees across operator, researcher, and referrer with a
> pull-pattern claim. All ten contracts are immutable and live on Arc.

---

### 1:25 → 1:55 — Receipts are recomputable, not screenshots

**On screen**: switch to the receipt JSON tab. Highlight the `evidenceUri`,
`evidenceHash`, and one bookSnapshot. Then cut to terminal:

```bash
cd keeper && npx tsx scripts/verify-receipt.mjs \
  https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
```

**Voiceover**:

> Every receipt commits to a public evidence URI and an evidence hash. The
> URI serves canonical JSON — order books, fills, inventory, PnL inputs.
> Download it, hash it, compare to the on-chain commitment. If they match,
> the receipt is signer-attributable, sequence-protected, replay-rejected,
> and time-monotonic. The site does the same check in your browser. Sharpe
> screenshots can't be verified. These can.

---

### 1:55 → 2:25 — Why this scales beyond one agent

**On screen**: back to the App console. Click Router tab to show the deposit
+ rebalance UI, then Fees tab to show the splits and claim panel.

**Voiceover**:

> Capital Router pools USDC and routes it across many Covenant Accounts on
> a strategist-set weight table. Anyone can call rebalance. Fee Router lets
> any operator declare an immutable revenue split — sixty percent to them,
> thirty to a researcher, ten to a referrer — and each recipient pulls
> accruals across every split they're in. Risk Markets let anyone hedge or
> insure the bond directly. The economics work on day one because the
> primitives compose.

---

### 2:25 → 2:50 — Close + ask

**On screen**: scroll back to the hero. Hover the "Become an operator" CTA.

**Voiceover**:

> Forum isn't a strategy. Forum is the layer that makes any strategy
> fundable. Programmable credit for AI agents, settled in USDC on Arc.
> Built for the Agora Agents Hackathon by Canteen, Circle, and Arc. If
> you run a bot, click "Become an operator" and tell us about it. The
> contracts are immutable, the receipts are recomputable, and the
> enforcement is autonomous. Thank you.

**End card** (hold 3 seconds):

```
forum.gudman.xyz
github.com/Ridwannurudeen/forum
Arc testnet · 10 immutable contracts · MIT
```

---

## What to leave out of the cut

- The negative-$77.93 backtest. Mention it only if the judges ask. The
  reframe is on the site under "Trust layer · why receipts beat
  screenshots" — they can read it.
- Specific phase numbers (Phase 5, Phase 6, etc.). Investors don't care
  about your sprint planning.
- Token addresses on screen. The explorer tab shows them; you don't need
  to read them out loud.
- The word "hackathon" more than once. We mention it in the close and
  that's it.

## Post-record checklist

- Watch the cut at 1.25× — if it still makes sense, the pacing is fine.
- Confirm no wallet addresses you own are visible.
- Confirm the proof tx loaded correctly in the recording (sometimes
  arcscan is slow — re-record that segment if it shows a spinner).
- Export as MP4 H.264, 1080p, ≤200MB.
- Upload as **unlisted** YouTube. Get the URL.
- Paste the URL into `SUBMISSION.md`. **Do not submit the form** until
  the user explicitly approves.

## Backup script if the proof tx page is slow

If `testnet.arcscan.app` loads sluggishly on the day of recording, use the
indexer instead:

```bash
curl -s https://forum.gudman.xyz/api/slash-events?limit=3 | jq .
```

Show the JSON output and narrate it. Faster, cleaner, doesn't depend on a
third-party explorer.

## Reproduce-everything appendix (for technical judges only — link, don't film)

```bash
# Clone, install, run tests
git clone https://github.com/Ridwannurudeen/forum && cd forum
cd keeper && npm install && npx vitest run
cd ../sdk-ts && npm install && npx tsc --noEmit
cd ../sdk-py && python -m py_compile src/forum_arc/abi.py src/forum_arc/client.py
forge install foundry-rs/forge-std --no-git && forge test -vv
```
