#!/usr/bin/env node
// Managed keeper manager — always-on supervisor that auto-runs a bounded Claude
// keeper on every "managed" Covenant Account (operator == the Forum address).
//
// A user who ticks "managed" at vault-creation gets the Forum operator address
// baked into the on-chain mandate, with botId = keccak(FORUM_OP : managed-<creator>).
// This manager discovers those vaults from the public Forum API and, once per
// cycle, runs the existing agora-mind-keeper with --max-ticks 1 --publish-every 1
// so each managed vault publishes exactly one receipt then the child exits.
//
// It SUPERVISES bounded runs — it does not keep long-lived children. It DOES
// post bonds, but only CAPPED auto-bonds: per managed bond-gated vault whose
// botId matches, it tops the SlashBond up to the mandate budget so the vault
// becomes credit-eligible. Forum's USDC spend is HARD-CAPPED two ways — a
// per-vault cap (MAX_AUTO_BOND_USDC) and a cumulative process-lifetime cap
// (MAX_AUTO_BOND_TOTAL_USDC) — and never bonds a vault Forum doesn't operate.
// The keeper signs with the Forum key the service env provides, so for a
// managed vault the keeper's derived botId (keccak(FORUM_OP : managed-<creator>))
// matches the vault's mandate.botId. The botId-match guard below refuses to run
// a keeper whose botId won't match.
//
// Flags:
//   --dry          list which vaults+labels it WOULD service, matched/mismatched
//                  botIds, and the WOULD-BOND/skip decision per matched vault;
//                  does NOT spawn keepers, send tx, load the key, or sleep-loop
//                  (single pass, exit).
//   --no-auto-bond disable the capped auto-bond step (also via AUTO_BOND=0).
//   --once         one real cycle (spawns keepers + auto-bonds) then exit.
//   (default)      loop forever, one cycle every CYCLE_SEC.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import {
  keccak256,
  toHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Constants (configurable via env) --------------------------------------
const FORUM_MANAGED_OPERATOR =
  "0x13585c6004fbA9D7D49219a6435B68348fD30770".toLowerCase();
const MAX_MANAGED = Number(process.env.MAX_MANAGED || 3);
const CYCLE_SEC = Number(process.env.CYCLE_SEC || 300);
const API = (process.env.FORUM_API || "https://forum.gudman.xyz").replace(
  /\/+$/,
  "",
);
const CHILD_TIMEOUT_MS = Number(process.env.CHILD_TIMEOUT_MS || 180_000);

// Keeper lives next to this file; tsx is in keeper/node_modules.
const KEEPER_DIR = __dirname;
const KEEPER_SCRIPT = resolve(KEEPER_DIR, "agora-mind-keeper.mjs");
const KEEPER_ROOT = resolve(KEEPER_DIR, "..");
const TSX_BIN = resolve(
  KEEPER_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

const FLAGS = process.argv.slice(2);
const DRY = FLAGS.includes("--dry");
const ONCE = FLAGS.includes("--once");

// Capped auto-bond: top managed bond-gated vaults up to budget so they become
// credit-eligible. Disabled by --no-auto-bond or AUTO_BOND=0. Spend is hard-
// capped per-vault (MAX_AUTO_BOND_USDC) and cumulatively across the process
// lifetime (MAX_AUTO_BOND_TOTAL_USDC, tracked in autoBondedTotalUsdc).
const AUTO_BOND =
  process.env.AUTO_BOND !== "0" && !FLAGS.includes("--no-auto-bond");
const MAX_AUTO_BOND_USDC = Number(process.env.MAX_AUTO_BOND_USDC || 1);
const MAX_AUTO_BOND_TOTAL_USDC = Number(
  process.env.MAX_AUTO_BOND_TOTAL_USDC || 3,
);
let autoBondedTotalUsdc = 0;

const ARC = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});
const USDC = JSON.parse(
  readFileSync(
    resolve(KEEPER_ROOT, "..", "deployments", "arc-testnet.json"),
    "utf8",
  ),
).usdc;
const usdcAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const bondAbi = parseAbi([
  "function bond(uint256 amount)",
  "function bondBalance() view returns (uint256)",
  "function operator() view returns (address)",
]);

const pub = createPublicClient({ chain: ARC, transport: http() });

// Lazy wallet: only built when a real (non-dry) bond send is needed, so --dry
// never loads the deployer key. Returns the cached wallet+account, or null if
// the loaded account is not the Forum managed operator.
let walletState; // undefined = not loaded, null = wrong-account, object = ready
function getWallet() {
  if (walletState !== undefined) return walletState;
  const pk = readFileSync(
    join(homedir(), ".forum-keys", "deployer.key"),
    "utf8",
  ).trim();
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
  if (account.address.toLowerCase() !== FORUM_MANAGED_OPERATOR) {
    console.error(
      `auto-bond: loaded key ${account.address} != Forum operator ${FORUM_MANAGED_OPERATOR} — bonding disabled`,
    );
    walletState = null;
    return null;
  }
  const wal = createWalletClient({ chain: ARC, transport: http(), account });
  walletState = { account, wal };
  return walletState;
}

// botId the keeper will derive (and the vault mandate was created with) for a
// managed vault. Mirrors ForumV2Bridge: keccak256(toHex(`${op}:${label}`)).
function expectedBotId(label) {
  return keccak256(toHex(`${FORUM_MANAGED_OPERATOR}:${label}`));
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// Capped auto-bond for a single managed vault whose botId already matched.
// Tops the mandate's SlashBond up to budget so the vault is credit-eligible,
// honoring per-vault and process-lifetime USDC caps. Returns a short status
// string; never throws (a failure must not kill the cycle loop). `cov` is the
// covenant JSON already fetched in the cycle loop — not re-fetched here.
async function autoBondIfNeeded(vault, cov) {
  if (!AUTO_BOND) return "auto-bond disabled";

  const bondContract = cov?.mandate?.bondContract;
  const budgetMicros = cov?.mandate?.budgetMicros;
  if (!bondContract || bondContract.toLowerCase() === ZERO_ADDR)
    return "no bond contract";

  const budgetUsdc = Number(budgetMicros) / 1e6;
  if (budgetUsdc > MAX_AUTO_BOND_USDC)
    return `budget ${budgetUsdc} > cap ${MAX_AUTO_BOND_USDC}; skip`;

  let bondOperator;
  try {
    bondOperator = await pub.readContract({
      address: bondContract,
      abi: bondAbi,
      functionName: "operator",
    });
  } catch (e) {
    return `bond operator read failed: ${e.message}`;
  }
  if (bondOperator.toLowerCase() !== FORUM_MANAGED_OPERATOR)
    return "bond not Forum-operated; skip";

  let bonded;
  try {
    bonded = await pub.readContract({
      address: bondContract,
      abi: bondAbi,
      functionName: "bondBalance",
    });
  } catch (e) {
    return `bondBalance read failed: ${e.message}`;
  }
  const deficit = BigInt(budgetMicros) - bonded;
  if (deficit <= 0n) return "already bonded";

  const deficitUsdc = Number(deficit) / 1e6;
  if (autoBondedTotalUsdc + deficitUsdc > MAX_AUTO_BOND_TOTAL_USDC)
    return "session cap reached; skip";

  const wallet = DRY ? null : getWallet();
  if (!DRY && !wallet) return "no Forum wallet; skip";

  const owner = DRY ? FORUM_MANAGED_OPERATOR : wallet.account.address;
  let balance;
  try {
    balance = await pub.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [owner],
    });
  } catch (e) {
    return `USDC balance read failed: ${e.message}`;
  }
  if (balance < deficit) return "insufficient Forum USDC; skip";

  if (DRY) return `WOULD-BOND ${deficitUsdc} USDC to ${bondContract}`;

  try {
    const approveHash = await wallet.wal.writeContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "approve",
      args: [bondContract, deficit],
    });
    await pub.waitForTransactionReceipt({ hash: approveHash });
    const bondHash = await wallet.wal.writeContract({
      address: bondContract,
      abi: bondAbi,
      functionName: "bond",
      args: [deficit],
    });
    await pub.waitForTransactionReceipt({ hash: bondHash });
    autoBondedTotalUsdc += deficitUsdc;
    return `bonded ${deficitUsdc} USDC -> ${bondContract}`;
  } catch (e) {
    return `bond failed: ${e.message}`;
  }
}

// Discover managed vaults: operator == Forum address, newest-first, capped.
// factory-vaults is already sorted newest-first by the indexer.
async function listManagedVaults() {
  const all = await fetchJson(`${API}/api/factory-vaults`);
  if (!Array.isArray(all)) throw new Error("factory-vaults not an array");
  return all
    .filter(
      (v) =>
        typeof v.operator === "string" &&
        v.operator.toLowerCase() === FORUM_MANAGED_OPERATOR,
    )
    .slice(0, MAX_MANAGED);
}

// Run one bounded keeper for a single managed vault. Resolves when the child
// exits (or is killed on timeout). Never throws — caller logs the outcome.
function runKeeper(vault, label) {
  return new Promise((done) => {
    const argv = [
      KEEPER_SCRIPT,
      "--vault",
      vault,
      "--label",
      label,
      "--markets",
      "1",
      "--interval",
      "5",
      "--publish-every",
      "1",
      "--max-ticks",
      "1",
      "--llm-on-publish-only",
      "--receipts-dir",
      "/opt/forum/web/receipts",
      "--receipts-base-url",
      "https://forum.gudman.xyz/receipts",
    ];
    const child = spawn(TSX_BIN, argv, {
      cwd: KEEPER_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const prefix = `[${vault}]`;
    const pipe = (stream, sink) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          sink(`${prefix} ${buf.slice(0, nl)}`);
          buf = buf.slice(nl + 1);
        }
      });
      stream.on("end", () => {
        if (buf.length) sink(`${prefix} ${buf}`);
      });
    };
    pipe(child.stdout, (l) => console.log(l));
    pipe(child.stderr, (l) => console.error(l));

    let settled = false;
    const finish = (note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(note);
    };
    const timer = setTimeout(() => {
      console.error(`${prefix} timeout after ${CHILD_TIMEOUT_MS}ms — killing`);
      child.kill("SIGKILL");
      finish("timeout");
    }, CHILD_TIMEOUT_MS);

    child.on("error", (e) => {
      console.error(`${prefix} spawn error: ${e.message}`);
      finish("spawn-error");
    });
    child.on("exit", (code, signal) => {
      console.log(`${prefix} keeper exited code=${code} signal=${signal}`);
      finish(`exit:${code ?? signal}`);
    });
  });
}

async function cycle() {
  let managed;
  try {
    managed = await listManagedVaults();
  } catch (e) {
    console.error(`cycle: failed to list managed vaults: ${e.message}`);
    return 0;
  }

  if (managed.length === 0) {
    console.log("cycle: 0 managed vaults — nothing to do");
    return 0;
  }
  console.log(
    `cycle: ${managed.length} managed vault(s) (cap ${MAX_MANAGED})${DRY ? " [DRY]" : ""}`,
  );

  // Strictly sequential — never two keepers at once (rate-limit safety).
  let serviced = 0;
  for (const v of managed) {
    try {
      const vault = v.vault;
      const creator = String(v.creator || "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(vault)) {
        console.warn(`skip: bad vault address ${vault}`);
        continue;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(creator)) {
        console.warn(`skip ${vault}: bad creator address ${creator}`);
        continue;
      }
      const label = `managed-${creator.toLowerCase()}`;
      const expected = expectedBotId(label);

      // botId-match guard: read the live mandate and refuse to run a keeper
      // whose derived botId won't match the vault's on-chain mandate.botId.
      let cov;
      let onchainBotId;
      try {
        cov = await fetchJson(`${API}/api/covenant/${vault}`);
        onchainBotId = cov?.mandate?.botId;
      } catch (e) {
        console.warn(`skip ${vault}: covenant read failed: ${e.message}`);
        continue;
      }
      if (typeof onchainBotId !== "string") {
        console.warn(`skip ${vault}: mandate.botId missing`);
        continue;
      }
      const match = onchainBotId.toLowerCase() === expected.toLowerCase();
      if (!match) {
        console.warn(
          `skip ${vault}: botId mismatch label=${label} expected=${expected} mandate=${onchainBotId}`,
        );
        continue;
      }

      if (DRY) {
        console.log(
          `WOULD-SERVICE ${vault} label=${label} botId=${expected} match=ok`,
        );
        console.log(`  auto-bond: ${await autoBondIfNeeded(vault, cov)}`);
        serviced += 1;
        continue;
      }

      console.log(`servicing ${vault} label=${label}`);
      console.log(`  auto-bond: ${await autoBondIfNeeded(vault, cov)}`);
      await runKeeper(vault, label);
      serviced += 1;
    } catch (e) {
      // One vault failing must not kill the loop.
      console.error(`vault ${v?.vault} error: ${e.message}`);
    }
  }
  console.log(`cycle summary: serviced ${serviced}/${managed.length}`);
  return serviced;
}

async function main() {
  console.log("managed-keeper-manager");
  console.log("  operator:    ", FORUM_MANAGED_OPERATOR);
  console.log("  maxManaged:  ", MAX_MANAGED);
  console.log("  cycleSec:    ", CYCLE_SEC);
  console.log("  api:         ", API);
  console.log("  keeper:      ", KEEPER_SCRIPT);
  console.log("  tsx:         ", TSX_BIN);
  console.log("  autoBond:    ", AUTO_BOND);
  console.log("  maxBondUsdc: ", MAX_AUTO_BOND_USDC);
  console.log("  maxBondTotal:", MAX_AUTO_BOND_TOTAL_USDC);
  console.log("  mode:        ", DRY ? "dry" : ONCE ? "once" : "loop");

  if (DRY) {
    await cycle();
    return;
  }
  if (ONCE) {
    await cycle();
    return;
  }
  // Loop forever.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await cycle();
    await new Promise((r) => setTimeout(r, CYCLE_SEC * 1000));
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
