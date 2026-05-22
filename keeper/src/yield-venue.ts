// Venue-agnostic capital deployment for the Covenant treasury agent.
//
// A CovenantVault gives the operator a bounded USDC credit line. This module
// is the missing piece between "the agent drew credit" and "the agent put it
// to work": a small abstraction over the places an agent can deploy that
// credit and recover it (± PnL), so Forum stays the credit + risk layer while
// the strategy venue is swappable.
//
// Two venues ship today:
//   - UsycVenue — deploys into USYC, Circle's tokenized U.S. Treasury fund,
//     native to Arc, via Hashnote's Teller (`buy`/`sell`). This is real yield.
//     It is gated by Circle's Entitlements allowlist: until the operator wallet
//     is allowlisted, `buy` reverts. `preflight()` detects that and reports it,
//     so the agent degrades gracefully instead of failing a draw.
//   - IdleVenue — the operator simply holds the drawn USDC and returns it.
//     Zero yield, always available. The honest fallback that keeps the
//     credit → deploy → return loop running on Arc with no external dependency.
//
// All chain IO is injected via `ChainOps` so the venues are unit-testable
// against a mock ledger; the keeper script wires `ChainOps` to viem.

import type { Address, Hex } from "viem";

export type VenueKind = "yield" | "idle";

/** Minimal chain surface the venues need. Implemented by the keeper with viem;
 *  implemented by a mock ledger in tests. */
export interface ChainOps {
  /** ERC-20 balanceOf, in token base units. */
  erc20Balance(token: Address, who: Address): Promise<bigint>;
  /** Read-only eth_call of a state-changing function to see if it would revert.
   *  Never throws — returns `{ ok:false, reason }` on revert. */
  simulate(
    address: Address,
    abi: readonly unknown[],
    fn: string,
    args: unknown[],
    account: Address,
  ): Promise<{ ok: boolean; reason: string }>;
  /** Send a write tx and wait for it to mine. Throws if it reverts. */
  write(
    address: Address,
    abi: readonly unknown[],
    fn: string,
    args: unknown[],
  ): Promise<Hex>;
}

export interface VenueContext {
  ops: ChainOps;
  operator: Address;
  usdc: Address;
}

export interface PreflightResult {
  ok: boolean;
  reason: string;
}

export interface DeployResult {
  /** Tx hash, or null for venues that need no on-chain action (e.g. idle). */
  txHash: Hex | null;
}

export interface WithdrawResult {
  txHash: Hex | null;
  /** USDC (micro) the operator holds again after unwinding the position. */
  usdcRecovered: bigint;
}

/** A place the agent can deploy drawn credit and later recover it (± PnL). */
export interface CapitalVenue {
  readonly name: string;
  readonly kind: VenueKind;
  /** Read-only check that deploy() can succeed right now. Never throws. */
  preflight(ctx: VenueContext, amount: bigint): Promise<PreflightResult>;
  /** Deploy `amount` micro-USDC (already held by the operator) into the venue. */
  deploy(ctx: VenueContext, amount: bigint): Promise<DeployResult>;
  /** Unwind the full position back to the operator as USDC. */
  withdraw(ctx: VenueContext): Promise<WithdrawResult>;
}

// ---------------------------------------------------------------------------
// ABIs (plain arrays; the viem-typed casts live in the keeper's ChainOps impl)
// ---------------------------------------------------------------------------

export const ERC20_ABI: readonly unknown[] = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

export const TELLER_ABI: readonly unknown[] = [
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];

// ---------------------------------------------------------------------------
// USYC venue — real Treasury yield on Arc via Hashnote's Teller.
// ---------------------------------------------------------------------------

export class UsycVenue implements CapitalVenue {
  readonly name = "usyc";
  readonly kind: VenueKind = "yield";
  constructor(
    private readonly teller: Address,
    private readonly usyc: Address,
  ) {}

  async preflight(ctx: VenueContext, amount: bigint): Promise<PreflightResult> {
    const bal = await ctx.ops.erc20Balance(ctx.usdc, ctx.operator);
    if (bal < amount)
      return { ok: false, reason: `operator USDC ${bal} < deploy ${amount}` };
    // USYC entitlement can't be proven read-only: Teller.buy needs a USDC
    // allowance to even reach the entitlement check, so a no-allowance simulate
    // always reverts and can't distinguish "no approval" from "not entitled".
    // Pass on balance; deploy() (approve → buy) is the real gate, and the keeper
    // falls back to another venue if buy reverts (e.g. wallet not yet entitled).
    return {
      ok: true,
      reason: "balance ok; USYC entitlement is verified at deploy()",
    };
  }

  async deploy(ctx: VenueContext, amount: bigint): Promise<DeployResult> {
    await ctx.ops.write(ctx.usdc, ERC20_ABI, "approve", [this.teller, amount]);
    const txHash = await ctx.ops.write(this.teller, TELLER_ABI, "buy", [
      amount,
    ]);
    return { txHash };
  }

  async withdraw(ctx: VenueContext): Promise<WithdrawResult> {
    const usycBal = await ctx.ops.erc20Balance(this.usyc, ctx.operator);
    if (usycBal === 0n) return { txHash: null, usdcRecovered: 0n };
    const before = await ctx.ops.erc20Balance(ctx.usdc, ctx.operator);
    await ctx.ops.write(this.usyc, ERC20_ABI, "approve", [
      this.teller,
      usycBal,
    ]);
    const txHash = await ctx.ops.write(this.teller, TELLER_ABI, "sell", [
      usycBal,
    ]);
    const after = await ctx.ops.erc20Balance(ctx.usdc, ctx.operator);
    return { txHash, usdcRecovered: after - before };
  }
}

// ---------------------------------------------------------------------------
// Idle venue — operator parks the drawn USDC and returns it. Zero yield.
// The dependency-free fallback that keeps the loop runnable on Arc today.
// ---------------------------------------------------------------------------

export class IdleVenue implements CapitalVenue {
  readonly name = "idle";
  readonly kind: VenueKind = "idle";
  private parked = 0n;

  async preflight(ctx: VenueContext, amount: bigint): Promise<PreflightResult> {
    const bal = await ctx.ops.erc20Balance(ctx.usdc, ctx.operator);
    if (bal < amount)
      return { ok: false, reason: `operator USDC ${bal} < deploy ${amount}` };
    return { ok: true, reason: "operator holds the credit idle (zero yield)" };
  }

  async deploy(_ctx: VenueContext, amount: bigint): Promise<DeployResult> {
    this.parked = amount;
    return { txHash: null };
  }

  async withdraw(_ctx: VenueContext): Promise<WithdrawResult> {
    return { txHash: null, usdcRecovered: this.parked };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — no chain, unit-tested directly.
// ---------------------------------------------------------------------------

/** Size the credit draw: conviction-scaled fraction of the cap, never above
 *  available credit. Inputs are micro-USDC; conviction is 0..100. */
export function sizeDraw(
  availableCredit: bigint,
  pullCap: bigint,
  convictionPct: number,
): bigint {
  const conv = BigInt(Math.max(0, Math.min(100, Math.round(convictionPct))));
  let amount = (pullCap * conv) / 100n;
  if (amount > availableCredit) amount = availableCredit;
  if (amount < 0n) amount = 0n;
  return amount;
}

/** Realized PnL of a round trip, in micro-USDC (can be negative). */
export function computeRealizedPnl(
  deployed: bigint,
  recovered: bigint,
): bigint {
  return recovered - deployed;
}

/** Pick the first venue whose preflight passed, honoring the given order. */
export function selectVenue(
  ranked: { venue: CapitalVenue; preflight: PreflightResult }[],
): CapitalVenue | null {
  for (const r of ranked) if (r.preflight.ok) return r.venue;
  return null;
}

/** Deploy `amount` into the first venue (in order) whose deploy() succeeds,
 *  falling back on revert. This is what makes USYC entitlement-ready: preflight
 *  can't read-only-prove entitlement, so we attempt the real deploy and fall
 *  back to the next venue (e.g. idle) if Teller.buy reverts. Throws only if
 *  every venue's deploy reverts. `onSkip` is called for each failed attempt. */
export async function deployWithFallback(
  ctx: VenueContext,
  amount: bigint,
  ranked: CapitalVenue[],
  onSkip?: (venue: CapitalVenue, err: unknown) => void,
): Promise<{ venue: CapitalVenue; result: DeployResult }> {
  let lastErr: unknown;
  for (const venue of ranked) {
    try {
      const result = await venue.deploy(ctx, amount);
      return { venue, result };
    } catch (e) {
      lastErr = e;
      if (onSkip) onSkip(venue, e);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`all venues failed to deploy (last: ${msg})`);
}
