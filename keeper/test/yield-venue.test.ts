import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import {
  IdleVenue,
  UsycVenue,
  sizeDraw,
  computeRealizedPnl,
  selectVenue,
  deployWithFallback,
  type ChainOps,
  type VenueContext,
} from "../src/yield-venue.js";

const USDC = "0x3600000000000000000000000000000000000000" as Address;
const USYC = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as Address;
const TELLER = "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" as Address;
const OP = "0x13585c6004fbA9D7D49219a6435B68348fD30770" as Address;

/** In-memory ERC-20 ledger + a USYC Teller model (allowlist gate + yield). */
class MockChainOps implements ChainOps {
  bal: Record<string, Record<string, bigint>> = {};
  allowlisted = true;
  /** Extra USDC returned on sell, in bps of the position (e.g. 500 = +5%). */
  yieldBps = 0n;
  constructor(private operator: Address) {}

  set(token: Address, who: Address, amt: bigint) {
    (this.bal[token] ??= {})[who] = amt;
  }
  async erc20Balance(token: Address, who: Address): Promise<bigint> {
    return this.bal[token]?.[who] ?? 0n;
  }
  async simulate(
    address: Address,
    _abi: readonly unknown[],
    fn: string,
    args: unknown[],
    account: Address,
  ): Promise<{ ok: boolean; reason: string }> {
    if (address === TELLER && fn === "buy") {
      if (!this.allowlisted) return { ok: false, reason: "not allowlisted" };
      const amt = args[0] as bigint;
      if ((this.bal[USDC]?.[account] ?? 0n) < amt)
        return { ok: false, reason: "insufficient balance" };
      return { ok: true, reason: "" };
    }
    return { ok: true, reason: "" };
  }
  async write(
    address: Address,
    _abi: readonly unknown[],
    fn: string,
    args: unknown[],
  ): Promise<`0x${string}`> {
    if (fn === "approve") return "0xapprove";
    if (address === TELLER && fn === "buy") {
      if (!this.allowlisted)
        throw new Error("Teller.buy reverted: not allowlisted");
      const amt = args[0] as bigint;
      this.set(
        USDC,
        this.operator,
        (this.bal[USDC]?.[this.operator] ?? 0n) - amt,
      );
      this.set(
        USYC,
        this.operator,
        (this.bal[USYC]?.[this.operator] ?? 0n) + amt,
      );
      return "0xbuy";
    }
    if (address === TELLER && fn === "sell") {
      const amt = args[0] as bigint;
      const proceeds = amt + (amt * this.yieldBps) / 10000n;
      this.set(
        USYC,
        this.operator,
        (this.bal[USYC]?.[this.operator] ?? 0n) - amt,
      );
      this.set(
        USDC,
        this.operator,
        (this.bal[USDC]?.[this.operator] ?? 0n) + proceeds,
      );
      return "0xsell";
    }
    return "0xnoop";
  }
}

function ctxFor(ops: ChainOps): VenueContext {
  return { ops, operator: OP, usdc: USDC };
}

describe("sizeDraw", () => {
  it("scales the cap by conviction", () => {
    expect(sizeDraw(10_000_000n, 2_000_000n, 50)).toBe(1_000_000n);
    expect(sizeDraw(10_000_000n, 2_000_000n, 100)).toBe(2_000_000n);
  });
  it("never exceeds available credit", () => {
    expect(sizeDraw(500_000n, 2_000_000n, 100)).toBe(500_000n);
  });
  it("clamps conviction to 0..100 and returns 0 at zero conviction", () => {
    expect(sizeDraw(10_000_000n, 2_000_000n, 0)).toBe(0n);
    expect(sizeDraw(10_000_000n, 2_000_000n, 999)).toBe(2_000_000n);
    expect(sizeDraw(10_000_000n, 2_000_000n, -5)).toBe(0n);
  });
});

describe("computeRealizedPnl", () => {
  it("is recovered minus deployed (signed)", () => {
    expect(computeRealizedPnl(1_000_000n, 1_050_000n)).toBe(50_000n);
    expect(computeRealizedPnl(1_000_000n, 1_000_000n)).toBe(0n);
    expect(computeRealizedPnl(1_000_000n, 980_000n)).toBe(-20_000n);
  });
});

describe("IdleVenue", () => {
  it("preflights ok when the operator holds enough, fails otherwise", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 1_000_000n);
    const v = new IdleVenue();
    expect((await v.preflight(ctxFor(ops), 1_000_000n)).ok).toBe(true);
    expect((await v.preflight(ctxFor(ops), 2_000_000n)).ok).toBe(false);
  });
  it("round-trips the parked amount with zero PnL and no tx", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 1_000_000n);
    const v = new IdleVenue();
    const dep = await v.deploy(ctxFor(ops), 1_000_000n);
    expect(dep.txHash).toBeNull();
    const w = await v.withdraw(ctxFor(ops));
    expect(w.usdcRecovered).toBe(1_000_000n);
    expect(computeRealizedPnl(1_000_000n, w.usdcRecovered)).toBe(0n);
  });
});

describe("UsycVenue", () => {
  it("preflight passes on balance even when not yet entitled (deferred to deploy)", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 5_000_000n);
    ops.allowlisted = false; // entitlement can't be read-only-checked
    const v = new UsycVenue(TELLER, USYC);
    const pf = await v.preflight(ctxFor(ops), 1_000_000n);
    expect(pf.ok).toBe(true); // verified at deploy(), not preflight
  });
  it("deploy reverts when the operator is not entitled", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 5_000_000n);
    ops.allowlisted = false;
    const v = new UsycVenue(TELLER, USYC);
    await expect(v.deploy(ctxFor(ops), 1_000_000n)).rejects.toThrow();
  });
  it("preflight fails when the operator is underfunded", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 500_000n);
    const v = new UsycVenue(TELLER, USYC);
    expect((await v.preflight(ctxFor(ops), 1_000_000n)).ok).toBe(false);
  });
  it("deploys to USYC and recovers principal + yield on withdraw", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 5_000_000n);
    ops.yieldBps = 500n; // +5%
    const v = new UsycVenue(TELLER, USYC);
    expect((await v.preflight(ctxFor(ops), 2_000_000n)).ok).toBe(true);
    const dep = await v.deploy(ctxFor(ops), 2_000_000n);
    expect(dep.txHash).toBe("0xbuy");
    // operator now holds 2 USYC, 3 USDC
    expect(await ops.erc20Balance(USYC, OP)).toBe(2_000_000n);
    const w = await v.withdraw(ctxFor(ops));
    expect(w.usdcRecovered).toBe(2_100_000n); // 2.0 + 5%
    expect(computeRealizedPnl(2_000_000n, w.usdcRecovered)).toBe(100_000n);
  });
  it("withdraw is a no-op when there is no position", async () => {
    const ops = new MockChainOps(OP);
    const v = new UsycVenue(TELLER, USYC);
    const w = await v.withdraw(ctxFor(ops));
    expect(w.txHash).toBeNull();
    expect(w.usdcRecovered).toBe(0n);
  });
});

describe("deployWithFallback", () => {
  it("falls back to idle when the yield venue's deploy reverts (not entitled)", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 5_000_000n);
    ops.allowlisted = false; // USYC deploy will revert
    const usyc = new UsycVenue(TELLER, USYC);
    const idle = new IdleVenue();
    const skipped: string[] = [];
    const { venue } = await deployWithFallback(
      ctxFor(ops),
      1_000_000n,
      [usyc, idle],
      (v) => skipped.push(v.name),
    );
    expect(venue).toBe(idle);
    expect(skipped).toEqual(["usyc"]);
  });
  it("uses the first venue whose deploy succeeds (entitled → USYC)", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 5_000_000n); // allowlisted true by default
    const usyc = new UsycVenue(TELLER, USYC);
    const idle = new IdleVenue();
    const { venue } = await deployWithFallback(ctxFor(ops), 1_000_000n, [
      usyc,
      idle,
    ]);
    expect(venue).toBe(usyc);
  });
  it("throws when every venue's deploy reverts", async () => {
    const ops = new MockChainOps(OP);
    ops.set(USDC, OP, 5_000_000n);
    ops.allowlisted = false;
    await expect(
      deployWithFallback(ctxFor(ops), 1_000_000n, [
        new UsycVenue(TELLER, USYC),
      ]),
    ).rejects.toThrow();
  });
});

describe("selectVenue", () => {
  it("prefers the first venue whose preflight passed", () => {
    const usyc = new UsycVenue(TELLER, USYC);
    const idle = new IdleVenue();
    expect(
      selectVenue([
        { venue: usyc, preflight: { ok: true, reason: "" } },
        { venue: idle, preflight: { ok: true, reason: "" } },
      ]),
    ).toBe(usyc);
  });
  it("falls back to idle when the yield venue is gated", () => {
    const usyc = new UsycVenue(TELLER, USYC);
    const idle = new IdleVenue();
    expect(
      selectVenue([
        { venue: usyc, preflight: { ok: false, reason: "not allowlisted" } },
        { venue: idle, preflight: { ok: true, reason: "" } },
      ]),
    ).toBe(idle);
  });
  it("returns null when nothing is deployable", () => {
    expect(
      selectVenue([
        { venue: new IdleVenue(), preflight: { ok: false, reason: "broke" } },
      ]),
    ).toBeNull();
  });
});
