// Env-driven network configuration shared by the keeper, the indexer and the
// operator scripts. Pure except for loadDeployment (one readFileSync), so the
// manifest-shape handling is vitest-coverable with fixtures.
//
//   FORUM_CHAIN        arc-testnet (default) | arc-mainnet
//   FORUM_DEPLOYMENTS  manifest path; default deployments/<FORUM_CHAIN>.json
//   ARC_RPC_URL        RPC override honoured everywhere (see chain.ts)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";
import { FORUM_CHAINS, forumChainName, type ForumChainName } from "./chain.js";

export interface DeploymentContract {
  address: Address;
  block?: number;
  label?: string;
}

export interface DeploymentManifest {
  chainId: number;
  usdc: Address;
  contracts: Record<string, DeploymentContract | undefined>;
}

export function deploymentsPath(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.FORUM_DEPLOYMENTS) return resolve(env.FORUM_DEPLOYMENTS);
  return resolve(repoRoot, "deployments", `${forumChainName(env)}.json`);
}

/** Parse a manifest and refuse one written for a different chain than FORUM_CHAIN selects. */
export function parseDeployment(
  json: string,
  chainName: ForumChainName,
  source: string,
): DeploymentManifest {
  const manifest = JSON.parse(json) as DeploymentManifest;
  const expected = FORUM_CHAINS[chainName].id;
  if (manifest.chainId !== expected) {
    throw new Error(
      `${source}: manifest chainId ${manifest.chainId} does not match FORUM_CHAIN=${chainName} (${expected})`,
    );
  }
  if (!manifest.contracts || typeof manifest.contracts !== "object") {
    throw new Error(`${source}: manifest has no contracts`);
  }
  return manifest;
}

export function loadDeployment(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): DeploymentManifest {
  const path = deploymentsPath(repoRoot, env);
  return parseDeployment(readFileSync(path, "utf8"), forumChainName(env), path);
}

/** The vault the AgoraMind keeper binds to when no --vault is given. */
export function defaultCovenantVault(
  manifest: DeploymentManifest,
): Address | undefined {
  const c = manifest.contracts;
  return (c.CovenantVaultV3 ?? c.CovenantVaultV1_2 ?? c.CovenantVault)?.address;
}

/** The vault factory whose allVaults() enumerates the fee-statement / idle-policy set. */
export function vaultFactory(
  manifest: DeploymentManifest,
): Address | undefined {
  const c = manifest.contracts;
  return (c.CovenantVaultFactory ?? c.CovenantVaultFactoryV2)?.address;
}

export interface IndexerContracts {
  trackRecordV1?: Address;
  trackRecordV2: Address;
  trackRecordV2DeployBlock: bigint;
  riskKernelV2?: Address;
  /** Hard-coded labelled vaults: v1 / v1_1 / v1_2 / v3, only the keys present. */
  vaults: Record<string, Address>;
  bond?: { address: Address; label: string };
  factory?: Address;
  factoryDeployBlock?: bigint;
  factoryV2?: Address;
  factoryV2DeployBlock?: bigint;
  feeRouter?: Address;
  capitalRouter?: Address;
  capitalRouterDeployBlock?: bigint;
  /** Lowest deploy block among the manifest's contracts: where a fresh index starts. */
  initialCursor: bigint;
}

function block(c: DeploymentContract | undefined): bigint | undefined {
  return c?.block ? BigInt(c.block) : undefined;
}

export function indexerContracts(
  manifest: DeploymentManifest,
): IndexerContracts {
  const c = manifest.contracts;
  if (!c.TrackRecordV2) throw new Error("manifest has no TrackRecordV2");
  const blocks = Object.values(c)
    .map(block)
    .filter((b): b is bigint => b !== undefined);
  if (blocks.length === 0) throw new Error("manifest has no deploy blocks");
  const initialCursor = blocks.reduce((min, b) => (b < min ? b : min));

  const vaults: Record<string, Address> = {};
  for (const [label, key] of [
    ["v1", "CovenantVault"],
    ["v1_1", "CovenantVaultV1_1"],
    ["v1_2", "CovenantVaultV1_2"],
    ["v3", "CovenantVaultV3"],
  ] as const) {
    const addr = c[key]?.address;
    if (addr) vaults[label] = addr;
  }

  // SlashBondV1_1 (testnet) and the mainnet SlashBond share the
  // bondBalance()/totalSlashed() read surface the indexer uses.
  const bond = c.SlashBondV1_1
    ? { address: c.SlashBondV1_1.address, label: "SlashBondV1.1" }
    : c.SlashBond
      ? {
          address: c.SlashBond.address,
          label: c.SlashBond.label ?? "SlashBond",
        }
      : undefined;

  return {
    trackRecordV1: c.TrackRecord?.address,
    trackRecordV2: c.TrackRecordV2.address,
    trackRecordV2DeployBlock: block(c.TrackRecordV2) ?? initialCursor,
    riskKernelV2: c.RiskKernelV2?.address,
    vaults,
    bond,
    factory: c.CovenantVaultFactory?.address,
    factoryDeployBlock: block(c.CovenantVaultFactory),
    factoryV2: c.CovenantVaultFactoryV2?.address,
    factoryV2DeployBlock: block(c.CovenantVaultFactoryV2),
    feeRouter: c.FeeRouterV1?.address,
    capitalRouter: c.CapitalRouter?.address,
    capitalRouterDeployBlock: block(c.CapitalRouter),
    initialCursor,
  };
}

/** Circle Iris (CCTP attestation) API for the selected network. */
export function irisApiBase(chainName: ForumChainName): string {
  return chainName === "arc-mainnet"
    ? "https://iris-api.circle.com"
    : "https://iris-api-sandbox.circle.com";
}
