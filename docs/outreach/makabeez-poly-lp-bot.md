# DM template — Makabeez / poly-lp-bot

> Send via GitHub on the `Makabeez/poly-lp-bot` repo (open an issue titled
> "Verifiable track record + USDC fee split — 5 min integration?") or directly
> if you can find their X/Telegram. Keep it short. They lost \$125 running
> their own bot — they'll respect honesty.

---

## Subject

5-min integration that gives `poly-lp-bot` a verifiable on-chain track record + USDC fee splits

## Body

Hey,

I saw `poly-lp-bot` on GitHub — you mention in the README you ran it, lost \$125, and archived it as a V2 CLOB reference. Respect for shipping it and being honest about the result.

I just shipped **Forum** (`github.com/Ridwannurudeen/forum`) — Arc-native operator and settlement plane for prediction-market bots. Four immutable contracts on Arc testnet:

- `BuilderCodeRegistry` — claim a `bytes32` code, prove ownership cryptographically
- `KeeperConfig` — live-tunable params (no SSH-and-edit-YAML)
- `TrackRecord` — append-only EIP-712-signed PnL entries by bot kind
- `FeeDistributor` — per-code attribution → pull-pattern USDC claim

Integration is ~50 lines of Python via the `forum-arc` SDK (built on `web3.py` + `eth-account`). Your existing `poly-lp-bot` SQLite state machine doesn't change — you just call `forum.track_record.publish(...)` after each cycle.

What you get:
1. **Cryptographic track record** — if you ever decide to come back to it (or someone forks it), every PnL claim is signer-attributable and append-only on Arc
2. **Builder-code-bind** — claim a code, the registry proves you own it across venues
3. **Fee splits** — if you take on co-builders or contribute upstream, splits happen on-chain without trust

Happy to write the integration adapter for you (~30 min) and submit it as a PR to `poly-lp-bot`. You'd get co-authorship credit on a hackathon submission Forum is making for the Agora Agents Hackathon (Canteen × Circle × Arc, ending May 25).

Worth 5 minutes?

— Ridwan (`Ridwannurudeen`)
nraheemst@gmail.com
