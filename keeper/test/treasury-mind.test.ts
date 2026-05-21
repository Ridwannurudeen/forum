import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MockTreasuryProvider,
  AnthropicTreasuryProvider,
  type TreasuryContext,
} from "../src/treasury-mind.js";

function ctx(overrides: Partial<TreasuryContext> = {}): TreasuryContext {
  return {
    availableCreditUsdc: 100,
    budgetUsdc: 200,
    maxDrawdownBps: 500,
    vaultState: 0,
    venues: [
      { name: "usyc", kind: "yield", available: true, reason: "ok" },
      { name: "idle", kind: "idle", available: true, reason: "ok" },
    ],
    ts: 1000,
    ...overrides,
  };
}

describe("MockTreasuryProvider", () => {
  const p = new MockTreasuryProvider();

  it("deploys into the yield venue with high conviction when active", async () => {
    const d = await p.decide(ctx());
    expect(d.venue).toBe("usyc");
    expect(d.convictionPct).toBe(85);
    expect(d.deployUsdc).toBeCloseTo(85);
    expect(d.riskPosture).toBe("normal");
    expect(d.requestPause).toBe(false);
  });

  it("falls back to idle (lower conviction) when only idle is available", async () => {
    const d = await p.decide(
      ctx({
        venues: [
          { name: "usyc", kind: "yield", available: false, reason: "gated" },
          { name: "idle", kind: "idle", available: true, reason: "ok" },
        ],
      }),
    );
    expect(d.venue).toBe("idle");
    expect(d.convictionPct).toBe(50);
    expect(d.deployUsdc).toBeCloseTo(50);
  });

  it("halts and requests pause when the vault is paused", async () => {
    const d = await p.decide(ctx({ vaultState: 1 }));
    expect(d.riskPosture).toBe("halt");
    expect(d.requestPause).toBe(true);
    expect(d.deployUsdc).toBe(0);
  });

  it("holds when no venue is available", async () => {
    const d = await p.decide(
      ctx({
        venues: [
          { name: "idle", kind: "idle", available: false, reason: "broke" },
        ],
      }),
    );
    expect(d.deployUsdc).toBe(0);
    expect(d.venue).toBe("none");
  });
});

describe("AnthropicTreasuryProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubClaude(text: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ content: [{ type: "text", text }] }),
      })),
    );
  }

  it("parses + clamps a valid Claude allocation", async () => {
    stubClaude(
      '{"deployUsdc":80,"venue":"usyc","convictionPct":70,"riskPosture":"normal","requestPause":false}\n\nDeploy into USYC.',
    );
    const p = new AnthropicTreasuryProvider({ apiKey: "k" });
    const d = await p.decide(ctx());
    expect(d.venue).toBe("usyc");
    expect(d.deployUsdc).toBe(80);
    expect(d.convictionPct).toBe(70);
    expect(d.model).toBe("claude-sonnet-4-6");
  });

  it("clamps deployUsdc to available and rejects an unknown venue", async () => {
    stubClaude(
      '{"deployUsdc":9999,"venue":"ponzi","convictionPct":99,"riskPosture":"normal","requestPause":false}',
    );
    const p = new AnthropicTreasuryProvider({ apiKey: "k" });
    const d = await p.decide(ctx());
    expect(d.venue).toBe("none");
    expect(d.deployUsdc).toBe(0); // venue none => no deploy
  });

  it("halt from Claude forces deployUsdc 0 + requestPause", async () => {
    stubClaude(
      '{"deployUsdc":50,"venue":"usyc","convictionPct":40,"riskPosture":"halt","requestPause":false}',
    );
    const p = new AnthropicTreasuryProvider({ apiKey: "k" });
    const d = await p.decide(ctx());
    expect(d.riskPosture).toBe("halt");
    expect(d.deployUsdc).toBe(0);
    expect(d.requestPause).toBe(true);
  });

  it("falls back to the mock on malformed output", async () => {
    stubClaude("no json here");
    const p = new AnthropicTreasuryProvider({ apiKey: "k" });
    const d = await p.decide(ctx());
    expect(d.model).toBe("mock-treasury-v1");
  });

  it("uses the mock when no API key is set", async () => {
    const p = new AnthropicTreasuryProvider({ apiKey: "" });
    const d = await p.decide(ctx());
    expect(d.model).toBe("mock-treasury-v1");
  });
});
