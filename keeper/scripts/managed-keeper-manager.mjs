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
// It SUPERVISES bounded runs — it does not keep long-lived children, and it does
// NOT fund bonds or touch operator capital. The keeper signs with the Forum key
// the service env provides, so for a managed vault the keeper's derived botId
// (keccak(FORUM_OP : managed-<creator>)) matches the vault's mandate.botId. The
// botId-match guard below refuses to run a keeper whose botId won't match.
//
// Flags:
//   --dry    list which vaults+labels it WOULD service and matched/mismatched
//            botIds; does NOT spawn keepers or sleep-loop (single pass, exit).
//   --once   one real cycle (spawns keepers) then exit.
//   (default) loop forever, one cycle every CYCLE_SEC.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { keccak256, toHex } from "viem";

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
      let onchainBotId;
      try {
        const cov = await fetchJson(`${API}/api/covenant/${vault}`);
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
        serviced += 1;
        continue;
      }

      console.log(`servicing ${vault} label=${label}`);
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
