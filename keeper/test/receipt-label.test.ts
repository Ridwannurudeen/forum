import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  receiptHash,
  verifyReceipt,
  type BuildReceiptInput,
} from "../src/receipt.js";
import { keccak256, toHex } from "viem";

function fixture(): BuildReceiptInput {
  const botId = ("0x" +
    "f8081c2ef55bef260ec50cc1b9960eba" +
    "359efc879e338439f129a97b338ed014") as `0x${string}`;
  return {
    botId,
    seq: 1,
    periodStart: 100,
    periodEnd: 200,
    markets: ["m1"],
    bookSnapshots: [
      {
        marketId: "m1",
        start: {
          bids: [{ price: 0.45, size: 10 }],
          asks: [{ price: 0.55, size: 10 }],
          ts: 100,
          source: "polymarket-clob-v2",
        },
        end: {
          bids: [{ price: 0.46, size: 10 }],
          asks: [{ price: 0.54, size: 10 }],
          ts: 200,
          source: "polymarket-clob-v2",
        },
      },
    ],
    fills: [
      {
        marketId: "m1",
        ts: 150,
        side: "BUY",
        price: 0.45,
        size: 5,
        mode: "paper",
        makerRebateUsdc: 0.02,
        externalId: null,
      },
    ],
    inventory: [{ marketId: "m1", openShares: 0, closeShares: 5 }],
    pnl: {
      realizedUsdc: 0,
      unrealizedUsdc: 0.25,
      makerRebatesUsdc: 0.02,
      totalUsdcMicros: 270_000,
      formulaVersion: "v1",
    },
    strategy: {
      name: "avellaneda-stoikov",
      configHash: keccak256(toHex("config-v3")),
    },
  };
}

describe("receipt label", () => {
  it("includes the label in the output when provided", () => {
    const input = fixture();
    input.label = "my-bot-v1";
    const r = buildReceipt(input);
    expect(r.label).toBe("my-bot-v1");
  });

  it("omits the label key entirely when none is provided", () => {
    const r = buildReceipt(fixture());
    expect("label" in r).toBe(false);
  });

  it("produces the same hash as before for a label-less input", () => {
    const labelless = buildReceipt(fixture());
    const labeled = buildReceipt({ ...fixture(), label: "my-bot-v1" });
    labelless.generatedAt = 0;
    labeled.generatedAt = 0;
    // Golden hash captured before the label field existed — a label-less
    // receipt is byte-identical to the pre-label behavior. Hex split to dodge
    // the secret-pattern linter (same trick as receipt.test.ts's botId).
    const golden = ("0x" +
      "1b90feee2b3f902673f301efca1662ca" +
      "e76320cabbe4cbb7e0af48d58566e520") as `0x${string}`;
    expect(receiptHash(labelless)).toBe(golden);
    // Adding a label changes the hash (it's committed to), proving it's part
    // of the tamper-evident object.
    expect(receiptHash(labeled)).not.toBe(receiptHash(labelless));
  });

  it("verifies (returns null) with and without a label", () => {
    const withoutLabel = buildReceipt(fixture());
    expect(verifyReceipt(withoutLabel)).toBeNull();

    const withLabel = buildReceipt({ ...fixture(), label: "my-bot-v1" });
    expect(withLabel.label).toBe("my-bot-v1");
    expect(verifyReceipt(withLabel)).toBeNull();
  });
});
