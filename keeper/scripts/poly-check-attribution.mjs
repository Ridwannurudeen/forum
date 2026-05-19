import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, "..", ".."));
const KEY_DIR = "C:/Users/gudma/Music";
const pk = readFileSync(`${KEY_DIR}/polymarket-eoa-0x4f9efa49-signer.key`, "utf8").trim();
const apiKey = readFileSync(`${KEY_DIR}/polymarket-api-key`, "utf8").trim();
const apiSecret = readFileSync(`${KEY_DIR}/polymarket-api-secret`, "utf8").trim();
const apiPassphrase = readFileSync(`${KEY_DIR}/polymarket-api-passphrase`, "utf8").trim();
const builderCode = readFileSync(`${KEY_DIR}/polymarket-builder-code`, "utf8").trim();
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const clob = await import(pathToFileURL(resolve("keeper/node_modules/@polymarket/clob-client-v2/dist/index.cjs")).href);
const cli = new clob.ClobClient({
  host: "https://clob.polymarket.com", chain: 137, signer: walletClient,
  creds: { key: apiKey, secret: apiSecret, passphrase: apiPassphrase },
  funderAddress: "0xcD6c77F267aa1745b9B57986Ad1A9C749212D1d8", signatureType: 3,
  builderConfig: { builderCode },
});
console.log("builderCode in use:", builderCode);
console.log();
console.log("getBuilderTrades({ builder_code }):");
try {
  const t = await cli.getBuilderTrades({ builder_code: builderCode });
  console.log(JSON.stringify(t, null, 2).slice(0, 1500));
} catch (e) {
  console.log("failed:", e.message);
}
console.log();
console.log("getBuilderFeeRates() if available:");
try {
  const f = await cli.getBuilderFeeRates();
  console.log(JSON.stringify(f, null, 2));
} catch (e) {
  console.log("not available:", e.message);
}
