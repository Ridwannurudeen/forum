# What was built in the window

Baseline: tag `tameion-start` at commit `bcba46f` (2026-06-13). The repository had not moved since
that date, so everything below is in-window work and the diff is unambiguous.

```
git diff --stat tameion-start..HEAD
```

## New

| File | Lines | What |
|---|---|---|
| `src/PolicyVault.sol` | 299 | The contract. A non-custodial spend policy: it holds no funds and moves USDC `owner → payee` under an allowance |
| `test/PolicyVault.t.sol` | 709 | 38 tests against a **real** `TrackRecordV2`, not a mock |
| `script/DeployPolicyVault.s.sol` | 33 | Deploy for Arc mainnet 5042, with `registerBot` before the vault |
| `keeper/scripts/policy-keeper.mjs` | 209 | The agent side: preflight `canPay`, build the record from chain state, sign, pay |
| `frontend/policy.html` | 324 | The live page. Every number read from chain in the browser; no indexer |
| `deployments/arc-mainnet.json` | 70 | The mainnet manifest, including what is deliberately **not** deployed and **not** claimed |

## Changed

Three documents were corrected, because they made claims that are checkable on-chain and wrong:

- **The "organic slash" claim** (`README.md`, `GRANT.md`, `docs/STATUS.md`). The enforcement did fire
  with no human in the loop, but the `enforce()` call came from the keeper's own kernel nudge rather
  than a third party, and `SlashBondV1_1` was configured with `recipient == operator` — so every slash
  moved the operator's own USDC back to the operator. Real figures now stated: `totalSlashed()`
  4.910909 USDC, `bondBalance()` 0.089091 of the original 5.00.
- **The USYC claim** (`README.md`, `GRANT.md`). It said real Treasury yield was "one Circle Support
  request away". The adapter targets `ITeller.buy`/`sell`, which do not exist on the deployed Teller —
  only `deposit(uint256,address)` and `redeem(uint256,address,address)` do — and USYC is restricted to
  non-US institutions under Regulation S with a $100,000 minimum.

## Test suite

| | Before | After |
|---|---|---|
| Suites | 22 | 23 |
| Tests | 233 | **271** |
| Failing | 0 | **0** |

Verified with `forge test` on Foundry 1.7.1.

## What the new tests actually pin down

- A payment to a blocklisted payee reverts **and** leaves `lastSeq` at 0 with every counter untouched —
  the record and the counters unwind atomically with the transfer.
- `approve(0)` blocks every payment, and `canPay` reports it.
- The agent cannot register a payee, set a category, or unpause.
- A successfully social-engineered owner who registers an attacker's address still cannot have it paid
  for 24 hours.
- One payee cannot exceed its own daily cap by splitting a payment across two categories.
- A record with a future `periodEnd` is rejected, so a keeper clock bug cannot brick the record chain.
- The counters never exceed any cap, under fuzzing.
- Summing `pnlMicros` across the record chain equals `-totalPaidUsdc`.

## Security review

Reviewed by a party that did not write the contract. **No must-fix defect**; no path found where
anyone moves the owner's USDC outside the registry and caps, and no state that survives a failed
transfer. Five hardening items were raised and all five were implemented before this was written:

1. A per-payee daily cap, because category caps were additive and the agent picks the category.
2. `periodEnd <= block.timestamp` in `pay()`, closing the record-chain brick.
3. `canPay` reports an unregistered bot, instead of returning "yes" for a vault that can never pay.
4. The constructor rejects an unregistered `botId`, turning a forgotten `registerBot` into a failed
   deploy rather than a dead vault found a day later.
5. `registerPayee` rejects the vault's own address, which would otherwise strand funds.

## Deployed

Live on Arc mainnet (chain 5042) since 2026-10-14. Addresses, transaction hashes and the configured
policy are in `deployments/arc-mainnet.json`; the live page is https://forum.gudman.xyz/policy.html.

| | |
|---|---|
| `PolicyVault` | `0xAACe70a50573cB077f65D601cD19103afC4aeF9d` |
| `TrackRecordV2` | `0x730825299821D411146c503915553E37eBDc750c` |
| Policy | one category, 5 USDC per payment, 10 per day, 50 per 30 days; one payee capped at 5 per day |
| Allowance | 10 USDC, which is the real ceiling on what the vault can ever move |

## Still open

The first payment. The payee was registered at 07:01 UTC on 2026-10-14 and the 24-hour cooling period
is a contract constant, so the earliest it can be paid is 07:01 UTC on 2026-10-15. Until then `canPay`
returns `(false, 4)`, which is the policy working. The contract is unaudited and the pilot is capped by
the allowance.
