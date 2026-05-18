# Forum — demo video script (2-3 minutes, 720p+)

Target length: 2:30. Cut tight. No music. Voiceover over screen recordings.

The hero of this video is **one tx**: the first autonomous on-chain pause+slash settled by `RiskKernelV2.enforce(CovenantVaultV1.1)`. Short form `0x2c8e79a5...05d13`. Full hash lives in `deployments/arc-testnet.json` (read it once, paste the full URL into Tab 2 below). Everything else in the script is context for that tx.

## Setup (do once, ≥30 min before recording — required for "Option A" live re-fire)

1. Stop the AgoraMind keeper so its bound vault becomes stale-eligible:
   ```
   ssh root@gudman.xyz "systemctl stop forum-agora-mind.service"
   ```
   Note the time. The vault's `receiptFreshnessSec` is 1800 (30 min). Wait until at least `last_publish_timestamp + 1800 + 60`.

2. Browser tabs in this order:
   - **Tab 1:** `https://forum.gudman.xyz` (the live frontend)
   - **Tab 2:** `https://testnet.arcscan.app/tx/<full-demo-tx-hash>` — copy the full hash from `deployments/arc-testnet.json` (or click the hero link on `forum.gudman.xyz` which already wires it)
   - **Tab 3:** `https://forum.gudman.xyz/receipts/201c8909dca1/` (live receipt JSON listing)
   - **Tab 4:** Terminal window in `forum/` directory of the local clone

3. Terminal pre-loaded with the commands (don't hit enter yet — paste each at its cue):
   ```
   node keeper/scripts/demo-violation.mjs
   node keeper/scripts/revive-and-seed-v12.mjs
   ```

4. Stop all other recording / notifications. Target 1920×1080. Cursor enlarged for video readability.

5. Restart the keeper *after* the recording so the live site stays fresh:
   ```
   ssh root@gudman.xyz "systemctl start forum-agora-mind.service"
   ```

> **Option B (safe fallback)** — if Setup step 1 wasn't done early enough, the demo-violation script will show diagnostics + countdown instead of firing. Narrate "here is the script that produced the `0x2c8e79a5…` tx on screen" and walk through the diagnostic output. Still works as a video, just slightly less dramatic.

---

## 0:00–0:10 · Open (title card)

VOICEOVER:
> "Forum. Covenant Accounts — programmable USDC credit lines for AI trading agents."

SCREEN: Tab 1, top of `forum.gudman.xyz`, hero headline visible.

---

## 0:10–0:35 · Problem

VOICEOVER:
> "Today, capital can't trust an AI trading agent. Three bad options: hand over the private key and the operator can run with the money. Use a managed account and you're back to multi-day onboarding, incompatible with a bot that acts in milliseconds. Or every team rebuilds the same custom audit pipeline."
> "So capital sits out, and every twelve-percent-A-P-Y screenshot is unverifiable marketing."

SCREEN: Slowly scroll the "Capital can't trust an AI agent" two-column block on Tab 1.

---

## 0:35–1:00 · Solution

VOICEOVER:
> "Forum's primitive is one immutable contract on Arc. Depositors put in USDC. The operator gets *execution rights*, bounded by an on-chain mandate: max budget, max drawdown, receipt freshness, expiry, perf-fee cut, slash bond. They never custody the funds."
> "And — anyone — can call risk-kernel-V-two dot enforce on the vault. One tx. Flips the vault to paused. Slashes the operator's bond. Same tx. No operator click required."

SCREEN: Tab 1, scroll down to the "Three contracts. One credit line." section. Pause on it. Then continue to the live "Live mandate · CovenantVaultV1.2" tiles section showing ACTIVE / TVL / bond balance.

---

## 1:00–1:35 · The proof tx

VOICEOVER:
> "Here is that happening. One tx, on Arc testnet, days ago. The AgoraMind keeper missed a thirty-minute publish window. Anyone could then call enforce. This is the call that did."

SCREEN: Switch to **Tab 2** — the arcscan page for the proof tx. Scroll to:
- "Status: Success"
- "Gas used: 162,960"
- The input data showing `enforce(address)` decoded
- The token transfer log showing 1.25 USDC moving out of SlashBondV1.1

VOICEOVER (over the scroll):
> "Status: success. One-hundred-sixty-two-thousand-nine-hundred-sixty gas. The internal call flipped the vault state from active to paused. The token-transfer log shows one-point-two-five USDC moving out of the operator's bond to the recipient. Atomic. No oracle. No off-chain step."

---

## 1:35–2:05 · Trigger it live yourself

VOICEOVER:
> "And anyone can re-run it. Here is the script that produced that tx — same script, talking to the same contracts."

SCREEN: Switch to **Tab 4** terminal. Paste `node keeper/scripts/demo-violation.mjs` and hit enter. Let it run.

**Option A (keeper stopped ≥30 min ago)**: the script reads vault state, sees `verdict=PAUSE_STALE`, calls `enforce(vault)`, prints the tx hash, then prints AFTER state with `state: PAUSED` and the new slashed amount.

VOICEOVER (over the output):
> "Reads state. Confirms verdict is pause-stale. Sends the enforce tx. Block lands in under a second on Arc. After-state shows the vault is now paused and an additional twenty-five percent of the bond just moved to the recipient. That's two slashes settled by the same primitive, days apart."

**Option B (keeper running, verdict=ALLOW)**: the script prints diagnostics + countdown ("vault is ALLOW, X seconds til stale, re-run after stopping keeper") and exits without sending a tx.

VOICEOVER (Option B):
> "Right now the vault is ALLOW — the keeper just published. The script tells you what to do to trigger it: stop the keeper, wait the freshness window, re-run. This is exactly the script that produced the tx you just saw on screen."

---

## 2:05–2:20 · What it proves

SCREEN: Cut back to Tab 1, scroll to the "Architecture · 9 immutable contracts" grouped grid + the "Nine immutable contracts" headline.

VOICEOVER:
> "Thirteen immutable contracts live on Arc. Eighty-five Foundry tests green on every push. Every receipt the AI agent publishes is signed, sequenced, hash-chained, replay-rejected — and its source JSON is served at a public U-R-L so anyone can recompute the hash off-chain."

SCREEN: Briefly switch to **Tab 3** showing the receipts directory listing (`/receipts/201c8909dca1/` with numbered JSON files), then back to Tab 1.

---

## 2:20–2:30 · Close

VOICEOVER:
> "Forum. Covenant Accounts on Arc. Repo at github.com slash Ridwan-Nurudeen slash forum. M-I-T license. Built for the Agora Agents Hackathon."

SCREEN: Title card with:
- `forum.gudman.xyz`
- `github.com/Ridwannurudeen/forum`
- "Built for Agora · Canteen × Circle × Arc"
- "MIT · Arc testnet · Not financial advice"

---

## Cut list

- Total: ~2:30.
- If overshoot, drop the receipts directory beat in section 2:05–2:20 — keep only the "13 contracts, 85 tests" narration over the contracts grid.
- If under, in section 1:00–1:35 click into one of the transfer logs on arcscan to show the recipient address resolves; that's another ~10s of credibility.

## Recording technical notes

- Resolution: at least 1920×1080.
- Codec: H.264 (MP4) is the safe choice for hackathon submission platforms.
- Audio: voiceover only, no music. Quiet room.
- Cursor: enlarged + high-contrast for video readability (macOS: Accessibility → Pointer Size; Windows: Settings → Accessibility → Mouse pointer).
- Browser zoom: 110–125% so addresses and tx hashes survive compression.
- Frontend: confirm `Live mandate · CovenantVaultV1.2` shows `ACTIVE · 1 USDC` before recording (run `node keeper/scripts/revive-and-seed-v12.mjs` if not — it's idempotent).

## Post-record checklist

- [ ] Watch back at 1×. Does it make sense to someone who has never opened the Forum repo?
- [ ] Captions / subtitles uploaded (judges often skim with sound off).
- [ ] Thumbnail set to the "First autonomous slash" hero card on the landing page.
- [ ] Upload to YouTube unlisted, paste URL into `SUBMISSION.md` and the README.
- [ ] **Restart the AgoraMind keeper if you stopped it for Option A** — `ssh root@gudman.xyz "systemctl start forum-agora-mind.service"` then `systemctl status` to confirm.
