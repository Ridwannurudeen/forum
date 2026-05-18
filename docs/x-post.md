# Forum Post Drafts

Verify handles before posting. Do not post until the live site, receipt verifier, and CI are green.

## Variant A

```text
Shipping Forum: Covenant Accounts for autonomous market agents.

One USDC vault on Arc. The operator gets bounded credit under an on-chain mandate: budget, drawdown, freshness, expiry, performance fee, slash bond.

Anyone can call enforce(vault). One tx can pause the vault and slash the bond.

Live proof tx:
testnet.arcscan.app/tx/0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13

Repo: github.com/Ridwannurudeen/forum
Demo: forum.gudman.xyz

Built for Agora Agents Hackathon.
```

## Variant B

```text
We built a Covenant Account on Arc and triggered an autonomous slash on-chain.

AgoraMind missed its receipt freshness window. RiskKernelV2.enforce(vault) paused the vault and slashed 1.25 USDC from the operator bond in one transaction.

That is the primitive market agents need before outside capital can safely fund them: bounded credit, public receipts, enforceable risk.

Live demo: forum.gudman.xyz
Repo: github.com/Ridwannurudeen/forum
```

## Discord Draft

```text
Shipped Forum for Agora: Covenant Accounts on Arc.

What is live:
- USDC CovenantVault with budget/drawdown/freshness/expiry/perf-fee mandate
- TrackRecordV2 public receipt ledger
- RiskKernelV2 permissionless enforcement
- SlashBondV1.1 with RiskKernelV2 as attestor
- AgoraMind keeper publishing public receipts
- Browser-side receipt hash verification on the live site

Proof tx:
0x2c8e79a528e2df4b2aa2ca933afefd809a90726ebd758af3c48d731131305d13

Honest scope:
- paper-mode trading
- self-operated demo capital
- no external adapter shipped yet
- CCTP/Gateway/USYC are roadmap, not live dependencies

Repo: github.com/Ridwannurudeen/forum
Frontend: forum.gudman.xyz
```
