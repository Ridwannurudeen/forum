import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MockLlmProvider,
  AnthropicProvider,
  reasoningHash,
  type AgoraContext,
} from "../src/agora-mind.js";

function ctx(
  midprice: number,
  inventory: number = 0,
  overrides: Partial<AgoraContext> = {},
): AgoraContext {
  return {
    marketSlug: "will-x-happen",
    marketQuestion: "Will X happen?",
    book: {
      bestBid: midprice - 0.005,
      bestAsk: midprice + 0.005,
      midprice,
      bidDepth: 100,
      askDepth: 100,
    },
    recentMidprices: [midprice],
    inventory,
    variance: 0.0001,
    ts: 1700000000,
    ...overrides,
  };
}

/** Build a stubbed Anthropic Messages API response carrying `text`. */
function stubAnthropic(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: "text", text }] }),
    })),
  );
}

describe("MockLlmProvider", () => {
  const p = new MockLlmProvider();

  it("BUYs when midprice < 0.45", async () => {
    const d = await p.decide(ctx(0.3));
    expect(d.action).toBe("BUY");
    expect(d.sizeUsdc).toBeGreaterThan(0);
    expect(d.reasoning).toContain("underpriced YES");
  });

  it("SELLs when midprice > 0.55", async () => {
    const d = await p.decide(ctx(0.7));
    expect(d.action).toBe("SELL");
    expect(d.sizeUsdc).toBeGreaterThan(0);
    expect(d.reasoning).toContain("overpriced YES");
  });

  it("HOLDs in the uncertainty band", async () => {
    const d = await p.decide(ctx(0.5));
    expect(d.action).toBe("HOLD");
    expect(d.sizeUsdc).toBe(0);
    expect(d.spreadSkewBps).toBeGreaterThan(0); // widens
  });

  it("stamps mock-v1 as the model", async () => {
    const d = await p.decide(ctx(0.5));
    expect(d.model).toBe("mock-v1");
  });

  it("reasoning contains structured context", async () => {
    const d = await p.decide(ctx(0.5, 7));
    expect(d.reasoning).toContain("midprice=0.5000");
    expect(d.reasoning).toContain("inventory=7");
  });
});

describe("reasoningHash", () => {
  it("produces a deterministic 32-byte hash", async () => {
    const p = new MockLlmProvider();
    const a = await p.decide(ctx(0.4));
    const b = await p.decide(ctx(0.4));
    expect(reasoningHash(a)).toBe(reasoningHash(b));
    expect(reasoningHash(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("differs across different reasoning", async () => {
    const p = new MockLlmProvider();
    const a = await p.decide(ctx(0.3));
    const b = await p.decide(ctx(0.7));
    expect(reasoningHash(a)).not.toBe(reasoningHash(b));
  });
});

describe("AnthropicProvider", () => {
  it("falls back to mock when no API key", async () => {
    const p = new AnthropicProvider({ apiKey: "" });
    const d = await p.decide(ctx(0.3));
    expect(d.model).toBe("mock-v1");
    expect(d.action).toBe("BUY");
  });
});

describe("MockLlmProvider self-governance", () => {
  const p = new MockLlmProvider();

  it("reports conviction in range, higher for directional than HOLD", async () => {
    const buy = await p.decide(ctx(0.3));
    const hold = await p.decide(ctx(0.5));
    expect(buy.convictionPct).toBeGreaterThanOrEqual(40);
    expect(buy.convictionPct).toBeLessThanOrEqual(100);
    expect(hold.convictionPct).toBeLessThanOrEqual(25);
  });

  it("stays normal posture under benign conditions", async () => {
    const d = await p.decide(ctx(0.3));
    expect(d.riskPosture).toBe("normal");
    expect(d.requestPause).toBe(false);
  });

  it("halts and requests pause when the vault is already paused", async () => {
    const d = await p.decide(
      ctx(0.3, 0, {
        covenant: { budgetUsdc: 200, maxDrawdownBps: 500, vaultState: 1 },
      }),
    );
    expect(d.riskPosture).toBe("halt");
    expect(d.requestPause).toBe(true);
  });

  it("derisks (smaller size) when volatility spikes", async () => {
    const d = await p.decide(ctx(0.3, 0, { variance: 0.01 }));
    expect(d.riskPosture).toBe("derisk");
    expect(d.requestPause).toBe(false);
    expect(d.sizeUsdc).toBeLessThan(5);
  });
});

describe("AnthropicProvider parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a structured decision with the new fields", async () => {
    stubAnthropic(
      '{"action":"BUY","sizeUsdc":7,"spreadSkewBps":-12,"convictionPct":80,"riskPosture":"derisk","requestPause":false}\n\nEdge is positive and momentum supports it.',
    );
    const p = new AnthropicProvider({ apiKey: "test-key" });
    const d = await p.decide(ctx(0.3));
    expect(d.model).toBe("claude-opus-4-7");
    expect(d.action).toBe("BUY");
    expect(d.sizeUsdc).toBe(7);
    expect(d.spreadSkewBps).toBe(-12);
    expect(d.convictionPct).toBe(80);
    expect(d.riskPosture).toBe("derisk");
    expect(d.requestPause).toBe(false);
    expect(d.reasoning).toContain("momentum");
  });

  it("clamps out-of-range numbers from the model", async () => {
    stubAnthropic(
      '{"action":"SELL","sizeUsdc":50,"spreadSkewBps":999,"convictionPct":150,"riskPosture":"normal","requestPause":false}',
    );
    const p = new AnthropicProvider({ apiKey: "test-key" });
    const d = await p.decide(ctx(0.7));
    expect(d.sizeUsdc).toBe(10);
    expect(d.spreadSkewBps).toBe(50);
    expect(d.convictionPct).toBe(100);
  });

  it("forces requestPause when posture is halt", async () => {
    stubAnthropic(
      '{"action":"HOLD","sizeUsdc":0,"spreadSkewBps":0,"convictionPct":10,"riskPosture":"halt","requestPause":false}',
    );
    const p = new AnthropicProvider({ apiKey: "test-key" });
    const d = await p.decide(ctx(0.5));
    expect(d.riskPosture).toBe("halt");
    expect(d.requestPause).toBe(true);
  });

  it("falls back to mock when the model returns no parseable decision", async () => {
    stubAnthropic("I cannot decide right now.");
    const p = new AnthropicProvider({ apiKey: "test-key" });
    const d = await p.decide(ctx(0.3));
    expect(d.model).toBe("mock-v1");
    expect(d.action).toBe("BUY");
  });
});
