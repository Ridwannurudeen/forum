import { describe, it, expect } from 'vitest';
import { MockLlmProvider, AnthropicProvider, reasoningHash, type AgoraContext } from '../src/agora-mind.js';

function ctx(midprice: number, inventory: number = 0): AgoraContext {
  return {
    marketSlug: 'will-x-happen',
    marketQuestion: 'Will X happen?',
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
  };
}

describe('MockLlmProvider', () => {
  const p = new MockLlmProvider();

  it('BUYs when midprice < 0.45', async () => {
    const d = await p.decide(ctx(0.30));
    expect(d.action).toBe('BUY');
    expect(d.sizeUsdc).toBeGreaterThan(0);
    expect(d.reasoning).toContain('underpriced YES');
  });

  it('SELLs when midprice > 0.55', async () => {
    const d = await p.decide(ctx(0.70));
    expect(d.action).toBe('SELL');
    expect(d.sizeUsdc).toBeGreaterThan(0);
    expect(d.reasoning).toContain('overpriced YES');
  });

  it('HOLDs in the uncertainty band', async () => {
    const d = await p.decide(ctx(0.50));
    expect(d.action).toBe('HOLD');
    expect(d.sizeUsdc).toBe(0);
    expect(d.spreadSkewBps).toBeGreaterThan(0); // widens
  });

  it('stamps mock-v1 as the model', async () => {
    const d = await p.decide(ctx(0.50));
    expect(d.model).toBe('mock-v1');
  });

  it('reasoning contains structured context', async () => {
    const d = await p.decide(ctx(0.50, 7));
    expect(d.reasoning).toContain('midprice=0.5000');
    expect(d.reasoning).toContain('inventory=7');
  });
});

describe('reasoningHash', () => {
  it('produces a deterministic 32-byte hash', async () => {
    const p = new MockLlmProvider();
    const a = await p.decide(ctx(0.40));
    const b = await p.decide(ctx(0.40));
    expect(reasoningHash(a)).toBe(reasoningHash(b));
    expect(reasoningHash(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('differs across different reasoning', async () => {
    const p = new MockLlmProvider();
    const a = await p.decide(ctx(0.30));
    const b = await p.decide(ctx(0.70));
    expect(reasoningHash(a)).not.toBe(reasoningHash(b));
  });
});

describe('AnthropicProvider', () => {
  it('falls back to mock when no API key', async () => {
    const p = new AnthropicProvider({ apiKey: '' });
    const d = await p.decide(ctx(0.30));
    expect(d.model).toBe('mock-v1');
    expect(d.action).toBe('BUY');
  });
});
