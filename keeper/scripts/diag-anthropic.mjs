#!/usr/bin/env node
// Diagnostic: call Claude with a representative AgoraMind prompt and show the
// RAW response + whether the keeper's decision-parse regex matches. Reads the
// key from env (never printed). Run on VPS sourcing the env file:
//   set -a; . /root/.forum-keys/agora.env; set +a
//   cd /opt/forum/keeper && ./node_modules/.bin/tsx scripts/diag-anthropic.mjs

const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
if (!key) { console.error("no ANTHROPIC_API_KEY in env"); process.exit(2); }

const prompt = [
  "You are AgoraMind, an autonomous prediction-market trading agent operating a Covenant Account.",
  "Decide whether to BUY YES, SELL YES, or HOLD this tick, size it, and judge your own risk.",
  'Market: "Will X happen?" (slug: will-x)',
  "Order book: midprice 0.405, best bid 0.40, best ask 0.41, bid depth 120, ask depth 80",
  "Position & signals: inventory 0, variance 4.0e-4, recent midprices: 0.400, 0.410, 0.405, 0.408, 0.405",
  "Covenant mandate: budget 200 USDC, max drawdown 500 bps, vault ACTIVE",
  "",
  "Reply with a JSON object on a single line, then a blank line, then <=120 words of reasoning. Schema:",
  '{"action":"BUY"|"SELL"|"HOLD","sizeUsdc":<number 0..10>,"spreadSkewBps":<integer -50..50>,"convictionPct":<integer 0..100>,"riskPosture":"normal"|"derisk"|"halt","requestPause":<boolean>}',
].join("\n");

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
});
console.log("model:", model);
console.log("status:", res.status, res.ok ? "OK" : "NOT OK");
const body = await res.json();
if (!res.ok) { console.log("error body:", JSON.stringify(body).slice(0, 400)); process.exit(0); }
const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
console.log("=== RAW TEXT ===\n" + text + "\n=== END ===");
const m = text.match(/\{[^{}]*"action"\s*:\s*"(BUY|SELL|HOLD)"[^{}]*\}/);
console.log("parse regex match:", m ? m[0] : "NO MATCH (this is why it falls back to mock)");
