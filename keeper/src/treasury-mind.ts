// TreasuryMind — LLM-driven capital-allocation engine for the Covenant treasury
// agent. Distinct from AgoraMind (which decides BUY/SELL/HOLD on a Polymarket
// order book): TreasuryMind decides HOW MUCH of the vault's bounded credit to
// deploy into WHICH yield venue under the mandate, and whether to derisk/pause.
//
// Providers mirror agora-mind.ts:
//   - MockTreasuryProvider  — deterministic, no network. Policy: put idle credit
//     to work in the best available venue; halt if the vault is paused.
//   - AnthropicTreasuryProvider — Claude via the Messages API; falls back to the
//     mock on any failure. The reasoning is committed to the receipt.

import type { Hex } from "viem";
import { keccak256, toHex } from "viem";

export interface VenueOption {
  name: string;
  kind: "yield" | "idle";
  /** Did the venue's preflight pass (deployable right now)? */
  available: boolean;
  reason: string;
}

export interface TreasuryContext {
  availableCreditUsdc: number;
  budgetUsdc: number;
  maxDrawdownBps: number;
  /** 0 = ACTIVE; non-zero = vault paused/closed on-chain. */
  vaultState: number;
  venues: VenueOption[];
  ts: number;
}

export interface AllocationDecision {
  /** USDC to deploy this cycle (0 = hold). */
  deployUsdc: number;
  /** Chosen venue name, or "none". */
  venue: string;
  convictionPct: number;
  riskPosture: "normal" | "derisk" | "halt";
  /** Ask the risk kernel to pause the mandate (self-governance). */
  requestPause: boolean;
  reasoning: string;
  model: string;
  ts: number;
}

export interface TreasuryProvider {
  decide(ctx: TreasuryContext): Promise<AllocationDecision>;
}

export function allocationReasoningHash(d: AllocationDecision): Hex {
  return keccak256(toHex(d.reasoning));
}

function preferredVenue(ctx: TreasuryContext): VenueOption | undefined {
  const open = ctx.venues.filter((v) => v.available);
  return open.find((v) => v.kind === "yield") ?? open[0];
}

/** Deterministic treasury policy: deploy idle credit to the best available
 *  venue (yield preferred); halt when the vault is already paused. */
export class MockTreasuryProvider implements TreasuryProvider {
  async decide(ctx: TreasuryContext): Promise<AllocationDecision> {
    const active = ctx.vaultState === 0;
    const chosen = preferredVenue(ctx);
    if (!active) {
      return {
        deployUsdc: 0,
        venue: "none",
        convictionPct: 0,
        riskPosture: "halt",
        requestPause: true,
        reasoning:
          `[TreasuryMind/mock-v1] vault state ${ctx.vaultState} (paused/closed) — ` +
          `halt: deploy nothing and request the mandate stay paused.`,
        model: "mock-treasury-v1",
        ts: ctx.ts,
      };
    }
    if (!chosen || ctx.availableCreditUsdc <= 0) {
      return {
        deployUsdc: 0,
        venue: "none",
        convictionPct: 10,
        riskPosture: "normal",
        requestPause: false,
        reasoning:
          `[TreasuryMind/mock-v1] no deployable venue or no idle credit ` +
          `(available ${ctx.availableCreditUsdc} USDC) — hold.`,
        model: "mock-treasury-v1",
        ts: ctx.ts,
      };
    }
    // Treasury bias: idle USDC should be earning. Higher conviction into real
    // yield than into the idle fallback.
    const convictionPct = chosen.kind === "yield" ? 85 : 50;
    const deployUsdc = (ctx.availableCreditUsdc * convictionPct) / 100;
    return {
      deployUsdc,
      venue: chosen.name,
      convictionPct,
      riskPosture: "normal",
      requestPause: false,
      reasoning:
        `[TreasuryMind/mock-v1] vault ACTIVE; available ${ctx.availableCreditUsdc} USDC.\n` +
        `Deploy ${convictionPct}% (${deployUsdc.toFixed(6)} USDC) into ${chosen.name} (${chosen.kind}); ` +
        `${chosen.kind === "yield" ? "real yield available" : "yield venue gated, idle keeps capital safe"}.\n` +
        `Mandate budget ${ctx.budgetUsdc} USDC, max drawdown ${ctx.maxDrawdownBps} bps.`,
      model: "mock-treasury-v1",
      ts: ctx.ts,
    };
  }
}

/** Claude-driven allocation. Falls back to the mock on any failure. */
export class AnthropicTreasuryProvider implements TreasuryProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallback: TreasuryProvider;
  constructor(opts?: {
    apiKey?: string;
    model?: string;
    fallback?: TreasuryProvider;
  }) {
    this.apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model =
      opts?.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
    this.fallback = opts?.fallback ?? new MockTreasuryProvider();
  }

  async decide(ctx: TreasuryContext): Promise<AllocationDecision> {
    if (!this.apiKey) return this.fallback.decide(ctx);
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
          messages: [{ role: "user", content: buildPrompt(ctx) }],
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

function buildPrompt(ctx: TreasuryContext): string {
  const venues = ctx.venues
    .map(
      (v) =>
        `  - ${v.name} (${v.kind}): ${v.available ? "AVAILABLE" : "unavailable"} — ${v.reason}`,
    )
    .join("\n");
  return [
    `You are TreasuryMind, an autonomous treasury agent operating a Covenant Account: a bounded USDC credit line on Arc that a permissionless on-chain risk kernel can pause and slash if you breach your mandate.`,
    `Each cycle you decide how much idle credit to deploy into a yield venue, and whether to keep operating or throttle/pause yourself. You are conservative: idle USDC should earn safe yield, but never breach the mandate.`,
    ``,
    `Mandate:`,
    `  available credit: ${ctx.availableCreditUsdc} USDC`,
    `  budget:           ${ctx.budgetUsdc} USDC`,
    `  max drawdown:     ${ctx.maxDrawdownBps} bps`,
    `  vault state:      ${ctx.vaultState === 0 ? "ACTIVE" : `PAUSED/CLOSED (${ctx.vaultState})`}`,
    `Venues:`,
    venues,
    ``,
    `If the vault is paused, request a halt. Prefer a real-yield venue when available; otherwise the idle venue keeps capital safe. Reply with a JSON object on one line, then a blank line, then <=100 words of reasoning. Schema:`,
    `{"deployUsdc":<number 0..${ctx.availableCreditUsdc}>,"venue":"<one of the venue names or none>","convictionPct":<integer 0..100>,"riskPosture":"normal"|"derisk"|"halt","requestPause":<boolean>}`,
  ].join("\n");
}

function parseDecision(
  text: string,
  ctx: TreasuryContext,
): AllocationDecision | null {
  const m = text.match(/\{[^{}]*"deployUsdc"[^{}]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as {
      deployUsdc: number;
      venue: string;
      convictionPct?: number;
      riskPosture?: "normal" | "derisk" | "halt";
      requestPause?: boolean;
    };
    const names = new Set(ctx.venues.map((v) => v.name));
    const venue = names.has(obj.venue) ? obj.venue : "none";
    const riskPosture =
      obj.riskPosture === "derisk" || obj.riskPosture === "halt"
        ? obj.riskPosture
        : "normal";
    const deployUsdc = Math.max(
      0,
      Math.min(ctx.availableCreditUsdc, Number(obj.deployUsdc) || 0),
    );
    return {
      deployUsdc: venue === "none" || riskPosture === "halt" ? 0 : deployUsdc,
      venue,
      convictionPct: Math.max(
        0,
        Math.min(100, Math.round(Number(obj.convictionPct) || 0)),
      ),
      riskPosture,
      requestPause: obj.requestPause === true || riskPosture === "halt",
      reasoning: text.trim(),
      model: "",
      ts: ctx.ts,
    };
  } catch {
    return null;
  }
}
