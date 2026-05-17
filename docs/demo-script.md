# Forum — demo video script (2-3 minutes, 720p+)

Target length: 2:30. Cut tight. No music. Voiceover over screen recordings.

## Setup (do once before recording)

1. Browser tabs in this order:
   - **Tab 1:** `https://forum.gudman.xyz` (the Forum frontend)
   - **Tab 2:** `https://agora.thecanteenapp.com/` scrolled to Research section, Hack #02
   - **Tab 3:** `https://testnet.arcscan.app/address/0x730825299821d411146c503915553e37ebdc750c` (BuilderCodeRegistry on arcscan)
   - **Tab 4:** Terminal window in `forum/keeper/` directory
2. Terminal pre-loaded with: `./node_modules/.bin/tsx src/index.ts --markets 1 --interval 8 --publish-every 2 --max-ticks 4 --label forum-demo-keeper`
3. Stop any other recording / notifications. 1920×1080 or higher.

---

## 0:00–0:10  Open (title card)

VOICEOVER:
> "Forum. An Arc-native operator and settlement plane for prediction-market bots."

SCREEN: Just `forum.gudman.xyz` landing, the pitch panel visible.

---

## 0:10–0:40  Problem

VOICEOVER:
> "April 28 this year, Polymarket V2 launched. New contracts, pUSD collateral, and a bytes32 builder-attribution field on every signed order."
> "A wave of new bots followed — directional pickers, market-makers, arbitrage agents. Every one of them needs the same operator infrastructure."
> "A way to claim a builder code. A way to tune live params without redeploying. A way to publish a verifiable performance track record. A way to receive and split USDC fees."
> "Nobody built that layer. Forum does — on Arc."

SCREEN: Scroll the landing page's pitch panel slowly, top to bottom.

---

## 0:40–1:00  Validation (the smoking gun)

VOICEOVER:
> "And we're not guessing — Canteen, the host, asked for exactly this in their own research, ten days before the hackathon launched."

SCREEN: Switch to Tab 2, highlight the Hack #02 paragraph with cursor:
> *"a thin 'agent-as-builder' wrapper that registers any agent framework as a Polymarket V2 builder, exposes its structured outputs as a signed feed, and earns USDC builder fees per fill"*

---

## 1:00–1:45  Live deployment + multi-bot story

VOICEOVER:
> "Four contracts, immutable, deployed live on Arc testnet today."

SCREEN: Switch to Tab 1, scroll to "Live on Arc Testnet" cards. Click `TrackRecord` card.

VOICEOVER:
> "Click any contract — it's right there on arcscan, all four bytecode-verified."

SCREEN: arcscan page loads, scroll to show contract is verified, has events.

VOICEOVER:
> "And we have real bots publishing. Right now, two kinds are live — a MAKER reference keeper that quotes a Polymarket V2 market, and a TAKER bot that picks a direction every cycle. Both publish EIP-712-signed track records every few ticks."

SCREEN: Back to Tab 1, scroll to "Registered bots" table. Point to the two rows.

---

## 1:45–2:15  Run the keeper live

VOICEOVER:
> "Watch the keeper boot. Discovers a Polymarket V2 market. Reads the book. Generates two-sided quotes. Publishes a fresh TrackRecord to Arc."

SCREEN: Switch to Tab 4 terminal. Hit enter on the pre-loaded `tsx src/index.ts` command. Let it run for ~20 seconds, showing:
- Market discovery line
- "Bot already registered"
- tick=1 mid=… bid=… ask=…
- tick=2 same
- "PUBLISH tx=0x…" line
- tick=3 same

VOICEOVER (over the running output):
> "That's a real Arc transaction. Hash. Block number. Real EIP-712 signature from the bot's Agent Wallet. Anyone can verify."

---

## 2:15–2:30  Close

VOICEOVER:
> "Forum: github.com slash Ridwannurudeen slash forum. MIT license. Five-minute integration in TypeScript or Python. Built for the Agora Agents Hackathon, on Arc."

SCREEN: Title card with:
- `github.com/Ridwannurudeen/forum`
- `forum.gudman.xyz`
- "MIT · Paper-mode default · Arc testnet"

---

## Cut list

- Total: ~2:30.
- If overshoot, cut the validation section (1:00–1:20) — keep only the Hack #02 quote on screen, drop the spoken setup.
- If under, extend the keeper-running section, let one more PUBLISH tx land.

## Recording technical notes

- Resolution: at least 1920×1080.
- Codec: H.264 (MP4) is safest for hackathon platforms.
- Audio: voiceover only, no music. Quiet room.
- Cursor: large + visible (macOS: System Settings → Accessibility → Pointer Size; Windows: Settings → Accessibility → Mouse pointer).
- Browser zoom: bump to 110%–125% for readability at video compression.

## Post-record checklist

- [ ] Watch back at 1×. Does it make sense to someone who's never seen Forum?
- [ ] Captions / subtitles uploaded? (Hackathon judges often skim with sound off.)
- [ ] Thumbnail set to the address-cards section of the landing page.
- [ ] Upload to YouTube unlisted; paste URL into `SUBMISSION.md` and the README.
