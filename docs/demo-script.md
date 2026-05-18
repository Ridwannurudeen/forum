# Forum Demo Video Script

Target: 2-4 minutes, 720p or higher, real voiceover, live contract pages and live site.

Do not submit the video or form without explicit approval.

## Tabs

1. `https://forum.gudman.xyz/`
2. `https://testnet.arcscan.app/tx/0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13`
3. `https://forum.gudman.xyz/receipts/201c8909dca1/000014.json`
4. Terminal in the repo root.

## Terminal Commands

```bash
cd keeper
npx tsx scripts/verify-receipt.mjs https://forum.gudman.xyz/receipts/201c8909dca1/000014.json
cd ..
node keeper/scripts/demo-violation.mjs
```

`demo-violation.mjs` only sends a transaction if the vault is currently in violation. If the vault is `ALLOW`, use the existing proof tx and explain that the script shows the live verdict and countdown.

## 0:00-0:20 Open

Show the hero on `forum.gudman.xyz`.

Voiceover:

> Forum is Covenant Accounts for autonomous market agents: programmable USDC credit lines, receipt-backed performance, and permissionless pause plus slash enforcement on Arc.

## 0:20-0:50 Problem

Show the problem block.

Voiceover:

> Capital wants exposure to AI trading agents, but it cannot safely hand the agent an unrestricted wallet. Managed accounts are too slow, and PnL screenshots are marketing. Forum gives the agent bounded credit and gives depositors an enforceable mandate.

## 0:50-1:25 Product

Show the "How it works" and live mandate sections.

Voiceover:

> Depositors put USDC into a CovenantVault. The operator can pull credit only up to the mandate budget and only while the vault is active. TrackRecordV2 receives signed public receipts. RiskKernelV2 can pause the vault if receipts go stale, drawdown breaches, the mandate expires, or outstanding credit exceeds budget.

## 1:25-2:05 Proof Transaction

Show the Arc explorer proof tx.

Voiceover:

> This transaction is the core proof. One call to RiskKernelV2.enforce on the live vault paused the vault and slashed 1.25 USDC from the operator bond in the same transaction. The trigger was a stale receipt window, and the result is visible on Arc.

Show:

- status success;
- gas used;
- decoded `enforce(address)`;
- token transfer/slash logs if available.

## 2:05-2:40 Receipt Verification

Show receipt JSON, then terminal verifier output.

Voiceover:

> Each TrackRecordV2 record commits to a public evidence URI and evidence hash. The verifier fetches the JSON, canonicalizes it, hashes it, and checks the PnL accounting where the receipt has attributable fills. The live frontend performs the hash check in-browser.

## 2:40-3:10 Close

Return to the live site.

Voiceover:

> Forum is not the strategy. It is the account primitive that makes market agents fundable: bounded USDC credit, public receipts, and enforceable risk. Built for the Agora Agents Hackathon on Arc.

End card:

- `forum.gudman.xyz`
- `github.com/Ridwannurudeen/forum`
- Arc testnet
- MIT
- Not financial advice

## Pre-Submit Checklist

- Confirm live site loads without console errors.
- Confirm latest GitHub Actions run is green.
- Confirm `npx tsx keeper/scripts/verify-receipt.mjs <receipt>` prints `pnl: valid`.
- Confirm `SUBMISSION.md` has the final video URL.
- Submit only after explicit approval.
