#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keccak256, toHex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));

const fileUrl = (p) => pathToFileURL(resolve(p)).href;
const { ForumV2Bridge } = await import(fileUrl("keeper/src/forum-v2.ts"));
const { buildReceipt } = await import(fileUrl("keeper/src/receipt.ts"));

const FILL = {
  orderId: "0xf5fd3fff190ba0ed093d5092aa86210198c7b2a72329e8158f69ed63d151f1b0",
  polygonTxHash: "0x5207a5294ccbb52d9fadd6f2613c9920a1936095a0b7815f3ca1e3b0428b80c0",
  marketSlug: "will-the-republican-party-win-the-tx-04-house-seat",
  tokenId: "99191934701178264053575235515836228615210495042696817144148145261389254003310",
  side: "BUY",
  price: 0.86,
  shareSize: 2.32558,
  pUsdPaidMicros: 2011198,
  fillTsApprox: 1779188855,
};
const PERIOD_START = 1779188800;
const PERIOD_END = 1779188900;
const LABEL = "phase3-live-tx04-2026-05-19";

const bridge = new ForumV2Bridge({
  deploymentPath: `${process.cwd()}/deployments/arc-testnet.json`,
  botLabel: LABEL,
  receiptsDir: "/tmp/forum-receipts-local",
  receiptsBaseUrl: "https://forum.gudman.xyz/receipts",
});
console.log(`signer: ${bridge.account.address}`);
console.log(`botId:  ${bridge.botId}`);

const reg = await bridge.ensureRegistered(0);
console.log(reg.alreadyRegistered ? "bot already registered" : `registered: ${reg.txHash}`);

const seq = (await bridge.lastSeq()) + 1;
const prevHash = await bridge.lastRecordHash();
console.log(`next seq=${seq}, prevHash=${prevHash}`);

const OPEN_AVG_PX = 0.86;
const CLOSING_MARK = 0.855;
const closingShares = FILL.shareSize;
const unrealizedUsdc = closingShares * (CLOSING_MARK - OPEN_AVG_PX);
const realizedUsdc = 0;
const makerRebatesUsdc = 0;
const totalUsdcMicros = Math.round((realizedUsdc + unrealizedUsdc + makerRebatesUsdc) * 1_000_000);

const bookSnapshot = {
  marketId: FILL.tokenId,
  start: {
    bids: [{ price: 0.85, size: 5 }],
    asks: [{ price: 0.86, size: 1027 }],
    ts: PERIOD_START,
    source: "polymarket-clob-v2",
  },
  end: {
    bids: [{ price: 0.85, size: 5 }],
    asks: [{ price: 0.86, size: 1024.674 }],
    ts: PERIOD_END,
    source: "polymarket-clob-v2",
  },
};

const fillEntry = {
  marketId: FILL.tokenId,
  ts: FILL.fillTsApprox,
  side: FILL.side,
  price: FILL.price,
  size: FILL.shareSize,
  mode: "live",
  externalId: FILL.orderId,
  makerRebateUsdc: 0,
};

const receipt = buildReceipt({
  botId: bridge.botId,
  seq,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  markets: [FILL.marketSlug],
  bookSnapshots: [bookSnapshot],
  fills: [fillEntry],
  inventory: [{
    marketId: FILL.tokenId,
    openShares: 0,
    closeShares: closingShares,
  }],
  pnl: {
    realizedUsdc,
    unrealizedUsdc,
    makerRebatesUsdc,
    totalUsdcMicros,
    formulaVersion: "v1",
  },
  strategy: {
    name: LABEL,
    configHash: keccak256(toHex(`${LABEL}-cfg-v1`)),
  },
  decisionTrace: {
    traceUri: "",
    traceHash: ("0x" + "0".repeat(64)),
  },
});

const { uri, hash, localPath } = bridge.writeReceipt(seq, receipt);
console.log(`RECEIPT seq=${seq} hash=${hash}`);
console.log(`  uri:   ${uri}`);

const metaHash = keccak256(
  toHex(`seq=${seq};label=${LABEL};polygon-tx=${FILL.polygonTxHash}`),
);

const { txHash, recordHash } = await bridge.publishRecordAwait({
  seq,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  pnlMicros: BigInt(totalUsdcMicros),
  fills: 1,
  metaHash,
  evidenceUri: uri,
  evidenceHash: hash,
  prevRecordHash: prevHash,
});
console.log(`PUBLISH-V2 tx=${txHash} recordHash=${recordHash}`);
console.log(``);
console.log(`PHASE 3 PROOF COMPLETE:`);
console.log(`  Polygon fill tx:    https://polygonscan.com/tx/${FILL.polygonTxHash}`);
console.log(`  Forum receipt uri:  ${uri}`);
console.log(`  Forum publish tx:   https://testnet.arcscan.app/tx/${txHash}`);
console.log(`  botId:              ${bridge.botId}`);
