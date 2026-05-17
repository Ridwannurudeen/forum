// AgoraMind — LLM-driven decision engine for prediction-market bots.
//
// At each keeper tick, AgoraMind receives a structured context (current
// book state, recent fills, inventory, variance, recent price history)
// and returns a structured decision (BUY / SELL / HOLD with size and
// spread-skew advice) PLUS a reasoning trace.
//
// The reasoning trace is hashed and included in the Forum Receipt so it
// can be persisted and recomputed off-chain. This implements:
//
//   - Canteen Research Hack #01 (reasoning traces as the product)
//   - Canteen Research Hack #02 (agent-as-builder wrapper)
//
// Provider abstraction:
//   - `MockLlmProvider`  — deterministic, no network. Used in tests and
//     for the no-API-key demo path. Decisions are still meaningful:
//     buy when midprice < 0.45, sell when > 0.55, hold otherwise.
//   - `AnthropicProvider` — calls Claude via the Messages API. Reads
//     `ANTHROPIC_API_KEY` from env. Falls back to MockLlmProvider if
//     the env is unset or the request fails.

import type { Hex } from "viem";
import { keccak256, toHex } from "viem";

export interface BookSnapshotInput {
  bestBid: number | null;
  bestAsk: number | null;
  midprice: number;
  bidDepth: number;
  askDepth: number;
}

export interface AgoraContext {
  marketSlug: string;
  marketQuestion: string;
  book: BookSnapshotInput;
  recentMidprices: number[]; // last N (e.g., 20) midprices
  inventory: number; // signed shares
  variance: number; // EWMA σ² estimate
  ts: number;
}

export type Action = "BUY" | "SELL" | "HOLD";

export interface Decision {
  action: Action;
  sizeUsdc: number;
  /** Spread adjustment, in basis points. Positive widens; negative tightens. */
  spreadSkewBps: number;
  /** Free-text reasoning trace. Hashed and committed to the receipt. */
  reasoning: string;
  /** Model identifier (e.g., 'claude-opus-4-7', 'mock-v1'). */
  model: string;
  /** Decision timestamp (unix seconds). */
  ts: number;
}

export interface LlmProvider {
  decide(ctx: AgoraContext): Promise<Decision>;
}

/** Returns keccak256(reasoning) for committing to the on-chain receipt. */
export function reasoningHash(decision: Decision): Hex {
  return keccak256(toHex(decision.reasoning));
}

/** Mock provider — used in tests + when ANTHROPIC_API_KEY is unset.
 *  Decision rule:
 *    - midprice < 0.45  → BUY  ($5 size, tighten 10bps to attract fills)
 *    - midprice > 0.55  → SELL ($5 size, tighten 10bps)
 *    - otherwise        → HOLD (widen 20bps)
 *  Reasoning is structured + reproducible. */
export class MockLlmProvider implements LlmProvider {
  async decide(ctx: AgoraContext): Promise<Decision> {
    const mid = ctx.book.midprice;
    const imbalance =
      ctx.book.bidDepth + ctx.book.askDepth > 0
        ? (ctx.book.bidDepth - ctx.book.askDepth) /
          (ctx.book.bidDepth + ctx.book.askDepth)
        : 0;
    let action: Action;
    let spreadSkewBps: number;
    let rationale: string;
    if (mid < 0.45) {
      action = "BUY";
      spreadSkewBps = -10;
      rationale = `midprice ${mid.toFixed(3)} < 0.45 implies underpriced YES; recent imbalance ${imbalance.toFixed(2)} (bid-heavy if positive); inventory ${ctx.inventory.toFixed(2)} permits BUY`;
    } else if (mid > 0.55) {
      action = "SELL";
      spreadSkewBps = -10;
      rationale = `midprice ${mid.toFixed(3)} > 0.55 implies overpriced YES; recent imbalance ${imbalance.toFixed(2)}; inventory ${ctx.inventory.toFixed(2)} permits SELL`;
    } else {
      action = "HOLD";
      spreadSkewBps = 20;
      rationale = `midprice ${mid.toFixed(3)} in [0.45, 0.55] uncertainty band; variance σ² ${ctx.variance.toExponential(2)}; widen spread, defer directional view`;
    }
    return {
      action,
      sizeUsdc: action === "HOLD" ? 0 : 5,
      spreadSkewBps,
      reasoning:
        `[AgoraMind/mock-v1 on ${ctx.marketSlug}]\n` +
        `Question: ${ctx.marketQuestion}\n` +
        `Context: midprice=${mid.toFixed(4)} bidDepth=${ctx.book.bidDepth} askDepth=${ctx.book.askDepth} inventory=${ctx.inventory} variance=${ctx.variance.toExponential(2)}\n` +
        `Rationale: ${rationale}\n` +
        `Decision: ${action} size=${action === "HOLD" ? 0 : 5} skew=${spreadSkewBps}bps`,
      model: "mock-v1",
      ts: ctx.ts,
    };
  }
}

/** Anthropic provider — calls Claude via the Messages API.
 *  Falls back to MockLlmProvider on any failure (no key, network, parse). */
export class AnthropicProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallback: LlmProvider;
  constructor(opts?: {
    apiKey?: string;
    model?: string;
    fallback?: LlmProvider;
  }) {
    this.apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = opts?.model ?? "claude-opus-4-7";
    this.fallback = opts?.fallback ?? new MockLlmProvider();
  }

  async decide(ctx: AgoraContext): Promise<Decision> {
    if (!this.apiKey) return this.fallback.decide(ctx);

    const userPrompt = buildPrompt(ctx);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 600,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) return this.fallback.decide(ctx);
      const body = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (body.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const parsed = parseDecision(text, ctx);
      if (!parsed) return this.fallback.decide(ctx);
      parsed.model = this.model;
      return parsed;
    } catch {
      return this.fallback.decide(ctx);
    }
  }
}

function buildPrompt(ctx: AgoraContext): string {
  return [
    `You are AgoraMind, an autonomous prediction-market trading agent.`,
    `You are quoting a Polymarket V2 binary market. Decide whether to BUY YES, SELL YES, or HOLD this tick.`,
    ``,
    `Market: "${ctx.marketQuestion}" (slug: ${ctx.marketSlug})`,
    `Current state:`,
    `  midprice:  ${ctx.book.midprice}`,
    `  best bid:  ${ctx.book.bestBid}`,
    `  best ask:  ${ctx.book.bestAsk}`,
    `  bid depth: ${ctx.book.bidDepth}`,
    `  ask depth: ${ctx.book.askDepth}`,
    `  inventory: ${ctx.inventory} (signed shares of YES)`,
    `  variance σ²: ${ctx.variance.toExponential(3)}`,
    `  recent midprices: ${ctx.recentMidprices
      .slice(-10)
      .map((p) => p.toFixed(3))
      .join(", ")}`,
    ``,
    `Reply with a JSON object on a single line, then your free-text reasoning. Schema:`,
    `{"action":"BUY"|"SELL"|"HOLD","sizeUsdc":<number 0..10>,"spreadSkewBps":<integer -50..50>}`,
    `Then a blank line, then ≤120 words of reasoning that another analyst could check.`,
  ].join("\n");
}

function parseDecision(text: string, ctx: AgoraContext): Decision | null {
  const m = text.match(/\{[^{}]*"action"\s*:\s*"(BUY|SELL|HOLD)"[^{}]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as {
      action: Action;
      sizeUsdc: number;
      spreadSkewBps: number;
    };
    return {
      action: obj.action,
      sizeUsdc: Math.max(0, Math.min(10, obj.sizeUsdc)),
      spreadSkewBps: Math.max(-50, Math.min(50, Math.round(obj.spreadSkewBps))),
      reasoning: text.trim(),
      model: "",
      ts: ctx.ts,
    };
  } catch {
    return null;
  }
}
