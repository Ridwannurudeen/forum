#!/usr/bin/env node

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseGwei,
  parseUnits,
  recoverAddress,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REFUSALS = [
  "ok",
  "paused",
  "payee unknown",
  "payee inactive",
  "payee cooling",
  "category unknown",
  "over per-transaction cap",
  "over payee day cap",
  "over category day cap",
  "over epoch budget",
  "owner spendable short",
  "bot not registered",
];

const POLICY_ABI = [
  { type: "function", name: "botId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "canPay", stateMutability: "view", inputs: [{ name: "payeeId", type: "bytes32" }, { name: "categoryId", type: "bytes32" }, { name: "amount", type: "uint128" }], outputs: [{ name: "ok", type: "bool" }, { name: "code", type: "uint8" }] },
  { type: "function", name: "paymentMeta", stateMutability: "view", inputs: [{ name: "payeeId", type: "bytes32" }, { name: "categoryId", type: "bytes32" }, { name: "amount", type: "uint128" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "pay", stateMutability: "nonpayable", inputs: [{ name: "payeeId", type: "bytes32" }, { name: "categoryId", type: "bytes32" }, { name: "amount", type: "uint128" }, { name: "rec", type: "tuple", components: [{ name: "seq", type: "uint64" }, { name: "periodStart", type: "uint64" }, { name: "periodEnd", type: "uint64" }, { name: "pnlMicros", type: "int128" }, { name: "fills", type: "uint64" }, { name: "metaHash", type: "bytes32" }, { name: "evidenceUri", type: "string" }, { name: "evidenceHash", type: "bytes32" }, { name: "prevRecordHash", type: "bytes32" }] }, { name: "recSig", type: "bytes" }], outputs: [{ name: "paymentIndex", type: "uint64" }] },
  { type: "event", name: "Paid", inputs: [{ name: "payeeId", type: "bytes32", indexed: true }, { name: "categoryId", type: "bytes32", indexed: true }, { name: "account", type: "address", indexed: true }, { name: "amount", type: "uint128", indexed: false }, { name: "recordMeta", type: "bytes32", indexed: false }, { name: "recordSeq", type: "uint64", indexed: false }, { name: "paymentIndex", type: "uint64", indexed: false }] },
];

const TRACK_RECORD_ABI = [
  { type: "function", name: "lastSeq", stateMutability: "view", inputs: [{ name: "botId", type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "lastRecordHash", stateMutability: "view", inputs: [{ name: "botId", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "lastPeriodEnd", stateMutability: "view", inputs: [{ name: "botId", type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "botKind", stateMutability: "view", inputs: [{ name: "botId", type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "botSigner", stateMutability: "view", inputs: [{ name: "botId", type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
];

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = { mode: "dry-run" };
  const valued = new Set(["--payee", "--category", "--amount", "--evidence-uri", "--evidence-hash"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--broadcast") {
      if (options.modeExplicit) throw new Error("Choose only one of --dry-run or --broadcast.");
      options.mode = arg.slice(2);
      options.modeExplicit = true;
    } else if (valued.has(arg)) {
      if (options[arg]) throw new Error(`Duplicate option: ${arg}`);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg] = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  for (const required of ["--payee", "--category", "--amount"]) {
    if (!options[required]) throw new Error(`Required option missing: ${required}`);
  }
  return options;
}

function resolveId(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? value : keccak256(toBytes(value));
}

function stringify(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const requiredEnv = ["ARC_RPC_URL", "POLICY_VAULT_ADDRESS", "TRACK_RECORD_ADDRESS", "AGENT_PRIVATE_KEY"];
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);

  const vaultAddress = getAddress(process.env.POLICY_VAULT_ADDRESS);
  const trackRecordAddress = getAddress(process.env.TRACK_RECORD_ADDRESS);
  const privateKey = process.env.AGENT_PRIVATE_KEY.startsWith("0x")
    ? process.env.AGENT_PRIVATE_KEY
    : `0x${process.env.AGENT_PRIVATE_KEY}`;
  const account = privateKeyToAccount(privateKey);
  const payeeId = resolveId(options["--payee"]);
  const categoryId = resolveId(options["--category"]);
  const amount = parseUnits(options["--amount"], 6);
  if (amount <= 0n || amount >= 1n << 127n) throw new Error("Amount must be positive and fit the policy int128 payment record.");
  const evidenceUri = options["--evidence-uri"] ?? "";
  const evidenceHash = options["--evidence-hash"] ?? keccak256(toBytes(""));
  if (!/^0x[0-9a-fA-F]{64}$/.test(evidenceHash)) throw new Error("--evidence-hash must be a 32-byte 0x-prefixed hex value.");

  const publicClient = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });
  const chainId = await publicClient.getChainId();
  // Native gas uses 18 decimals; USDC amounts below remain 6 decimals.
  const arcChain = {
    id: chainId,
    name: chainId === 5042 ? "Arc" : "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ARC_RPC_URL] } },
  };

  // This is deliberately the first RPC call: the policy gate must pass before record work.
  const [ok, code] = await publicClient.readContract({
    address: vaultAddress,
    abi: POLICY_ABI,
    functionName: "canPay",
    args: [payeeId, categoryId, amount],
  });
  if (!ok) {
    const refusal = REFUSALS[Number(code)] ?? "unknown refusal";
    console.error(`canPay refused: code ${code} (${refusal}); failed check: ${refusal}. No payment sent.`);
    process.exitCode = 1;
  } else {
    const botId = await publicClient.readContract({ address: vaultAddress, abi: POLICY_ABI, functionName: "botId" });
    const lastSeq = await publicClient.readContract({ address: trackRecordAddress, abi: TRACK_RECORD_ABI, functionName: "lastSeq", args: [botId] });
    const seq = lastSeq + 1n;
    const prevRecordHash = await publicClient.readContract({ address: trackRecordAddress, abi: TRACK_RECORD_ABI, functionName: "lastRecordHash", args: [botId] });
    const lastPeriodEnd = await publicClient.readContract({ address: trackRecordAddress, abi: TRACK_RECORD_ABI, functionName: "lastPeriodEnd", args: [botId] });
    const periodStart = lastPeriodEnd + 1n;
    const latest = (await publicClient.getBlock()).timestamp;
    if (periodStart > latest) {
      console.log("waiting for the next second");
      process.exitCode = 0;
    } else {
      const periodEnd = latest >= periodStart ? latest : periodStart;
      const metaHash = await publicClient.readContract({ address: vaultAddress, abi: POLICY_ABI, functionName: "paymentMeta", args: [payeeId, categoryId, amount] });
      const kind = await publicClient.readContract({ address: trackRecordAddress, abi: TRACK_RECORD_ABI, functionName: "botKind", args: [botId] });
      const domainSeparator = await publicClient.readContract({ address: trackRecordAddress, abi: TRACK_RECORD_ABI, functionName: "DOMAIN_SEPARATOR" });
      const botSigner = await publicClient.readContract({ address: trackRecordAddress, abi: TRACK_RECORD_ABI, functionName: "botSigner", args: [botId] });
      const record = {
        seq,
        periodStart,
        periodEnd,
        pnlMicros: -amount,
        fills: 1n,
        metaHash,
        evidenceUri,
        evidenceHash,
        prevRecordHash,
      };
      const recordTypeHash = keccak256(toBytes("RecordV2(bytes32 botId,uint8 kind,uint64 seq,uint64 periodStart,uint64 periodEnd,int128 pnlMicros,uint64 fills,bytes32 metaHash,bytes32 evidenceUriHash,bytes32 evidenceHash,bytes32 prevRecordHash)"));
      const evidenceUriHash = keccak256(toBytes(evidenceUri));
      const structHash = keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "int128" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
        [recordTypeHash, botId, kind, seq, periodStart, periodEnd, record.pnlMicros, record.fills, metaHash, evidenceUriHash, evidenceHash, prevRecordHash],
      ));
      const digest = keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`);
      const signature = await account.sign({ hash: digest });
      const recoveredSigner = await recoverAddress({ hash: digest, signature });

      console.log(`Mode: ${options.mode}`);
      console.log(`payeeId: ${payeeId}`);
      console.log(`categoryId: ${categoryId}`);
      console.log(`botId: ${botId}`);
      console.log(`metaHash: ${metaHash}`);
      console.log(`record:\n${stringify(record)}`);
      console.log(`signer recovered from signature: ${recoveredSigner}`);
      console.log(`trackRecord.botSigner(botId): ${botSigner}`);
      if (recoveredSigner.toLowerCase() !== botSigner.toLowerCase()) {
        console.error("WARNING: SIGNER MISMATCH: this record will be rejected by TrackRecordV2.");
      }

      if (options.mode === "broadcast") {
        const walletClient = createWalletClient({ account, chain: arcChain, transport: http(process.env.ARC_RPC_URL) });
        const txHash = await walletClient.writeContract({
          chain: arcChain,
          address: vaultAddress,
          abi: POLICY_ABI,
          functionName: "pay",
          args: [payeeId, categoryId, amount, record, signature],
          maxFeePerGas: parseGwei("21"),
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error(`Payment transaction reverted: ${txHash}`);
        const paid = receipt.logs.map((log) => {
          try {
            const decoded = decodeEventLog({ abi: POLICY_ABI, data: log.data, topics: log.topics });
            return decoded.eventName === "Paid" ? decoded.args : undefined;
          } catch {
            return undefined;
          }
        }).find(Boolean);
        if (!paid) throw new Error(`Payment succeeded but Paid event was not found in receipt ${txHash}`);
        console.log(`transactionHash: ${txHash}`);
        console.log(`gasUsed: ${receipt.gasUsed}`);
        console.log(`Paid.paymentIndex: ${paid.paymentIndex}`);
        console.log(`Paid.recordSeq: ${paid.recordSeq}`);
      }
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
