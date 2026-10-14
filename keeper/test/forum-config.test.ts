import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultCovenantVault,
  deploymentsPath,
  indexerContracts,
  irisApiBase,
  parseDeployment,
  vaultFactory,
} from "../src/forum-config.js";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TESTNET_JSON = readFileSync(
  resolve(REPO_ROOT, "deployments", "arc-testnet.json"),
  "utf8",
);
const testnet = parseDeployment(
  TESTNET_JSON,
  "arc-testnet",
  "arc-testnet.json",
);

// The deployed mainnet V2 stack: exactly these contract keys, no legacy ones.
const MAINNET_JSON = readFileSync(
  resolve(__dirname, "fixtures", "arc-mainnet.contracts.json"),
  "utf8",
);
const mainnet = parseDeployment(
  MAINNET_JSON,
  "arc-mainnet",
  "arc-mainnet.contracts.json",
);
const TRACK_RECORD_V2 = "0x730825299821D411146c503915553E37eBDc750c";
const RISK_KERNEL_V2 = "0x0574257629e8221D560cF4AAce0F3cD7226bE2a0";
const FACTORY_V2 = "0x33bb03F40aD46884cd56871D532980154Ef9e5Bf";
const CAPITAL_ROUTER = "0xfF67e845b6d5561680df11C005B8eC8A5F72DaCD";
const FEE_ROUTER = "0x88E48f0ff21BDDe5385706dDa096ca3C60c54342";
const SLASH_BOND = "0x142e68E47b9107604F7b7F67B7A032BBff262d5B";
const VAULT_V3 = "0x8Ea637Dc3d4399c42c372D97DCb64a52b06A421E";

describe("deploymentsPath", () => {
  it("defaults to deployments/<chain>.json under the repo root", () => {
    expect(deploymentsPath("/repo", {})).toBe(
      resolve("/repo", "deployments", "arc-testnet.json"),
    );
    expect(deploymentsPath("/repo", { FORUM_CHAIN: "arc-mainnet" })).toBe(
      resolve("/repo", "deployments", "arc-mainnet.json"),
    );
  });

  it("FORUM_DEPLOYMENTS overrides the default", () => {
    expect(
      deploymentsPath("/repo", {
        FORUM_DEPLOYMENTS: "/opt/forum/deployments/arc-mainnet.json",
      }),
    ).toBe(resolve("/opt/forum/deployments/arc-mainnet.json"));
  });
});

describe("parseDeployment", () => {
  it("accepts the committed testnet manifest for arc-testnet", () => {
    expect(testnet.chainId).toBe(5042002);
    expect(testnet.contracts.TrackRecordV2?.address).toMatch(/^0x/);
  });

  it("refuses a manifest whose chainId disagrees with FORUM_CHAIN", () => {
    expect(() =>
      parseDeployment(TESTNET_JSON, "arc-mainnet", "x.json"),
    ).toThrow(/chainId 5042002 does not match FORUM_CHAIN=arc-mainnet/);
    expect(() =>
      parseDeployment(MAINNET_JSON, "arc-testnet", "x.json"),
    ).toThrow(/chainId 5042 does not match/);
  });

  it("accepts the committed mainnet manifest for arc-mainnet", () => {
    const json = readFileSync(
      resolve(REPO_ROOT, "deployments", "arc-mainnet.json"),
      "utf8",
    );
    const m = parseDeployment(json, "arc-mainnet", "arc-mainnet.json");
    expect(m.chainId).toBe(5042);
    expect(indexerContracts(m).initialCursor).toBe(25883049n);
  });
});

describe("indexerContracts — testnet manifest (today's behaviour)", () => {
  const c = indexerContracts(testnet);

  it("starts the cursor at BuilderCodeRegistry, the oldest deploy", () => {
    expect(c.initialCursor).toBe(
      BigInt(testnet.contracts.BuilderCodeRegistry!.block!),
    );
    expect(c.initialCursor).toBe(42553657n);
  });

  it("wires every legacy contract", () => {
    expect(c.trackRecordV1).toBe(testnet.contracts.TrackRecord!.address);
    expect(c.riskKernelV2).toBe(testnet.contracts.RiskKernelV2!.address);
    expect(Object.keys(c.vaults)).toEqual(["v1", "v1_1", "v1_2"]);
    expect(c.bond).toEqual({
      address: testnet.contracts.SlashBondV1_1!.address,
      label: "SlashBondV1.1",
    });
    expect(c.factory).toBe(testnet.contracts.CovenantVaultFactory!.address);
    expect(c.factoryDeployBlock).toBe(42824603n);
    expect(c.factoryV2).toBe(testnet.contracts.CovenantVaultFactoryV2!.address);
    expect(c.capitalRouterDeployBlock).toBe(42843308n);
    expect(c.trackRecordV2DeployBlock).toBe(42661961n);
  });

  it("keeps the v1 factory and the v1.2 vault as defaults", () => {
    expect(vaultFactory(testnet)).toBe(
      testnet.contracts.CovenantVaultFactory!.address,
    );
    expect(defaultCovenantVault(testnet)).toBe(
      testnet.contracts.CovenantVaultV1_2!.address,
    );
  });
});

describe("indexerContracts — deployed mainnet manifest (fixture)", () => {
  const c = indexerContracts(mainnet);

  it("starts the cursor at the TrackRecordV2 deploy block", () => {
    expect(c.initialCursor).toBe(25883049n);
    expect(c.trackRecordV2DeployBlock).toBe(25883049n);
  });

  it("leaves every legacy feature undefined instead of throwing", () => {
    expect(c.trackRecordV1).toBeUndefined();
    expect(c.factory).toBeUndefined();
    expect(c.factoryDeployBlock).toBeUndefined();
    expect(c.vaults).toEqual({ v3: VAULT_V3 });
  });

  it("wires the V2 stack", () => {
    expect(c.trackRecordV2).toBe(TRACK_RECORD_V2);
    expect(c.riskKernelV2).toBe(RISK_KERNEL_V2);
    expect(c.factoryV2).toBe(FACTORY_V2);
    expect(c.factoryV2DeployBlock).toBe(25925053n);
    expect(c.capitalRouterDeployBlock).toBe(25925056n);
    expect(c.capitalRouter).toBe(CAPITAL_ROUTER);
    expect(c.feeRouter).toBe(FEE_ROUTER);
    expect(c.bond).toEqual({
      address: SLASH_BOND,
      label: "forum-agora-mind-mainnet-v1",
    });
  });

  it("falls back to FactoryV2 and the V3 vault", () => {
    expect(vaultFactory(mainnet)).toBe(FACTORY_V2);
    expect(defaultCovenantVault(mainnet)).toBe(VAULT_V3);
  });

  it("requires TrackRecordV2", () => {
    expect(() =>
      indexerContracts({
        ...mainnet,
        contracts: { PolicyVault: mainnet.contracts.PolicyVault },
      }),
    ).toThrow(/TrackRecordV2/);
  });
});

describe("irisApiBase", () => {
  it("uses Circle production on mainnet and the sandbox on testnet", () => {
    expect(irisApiBase("arc-mainnet")).toBe("https://iris-api.circle.com");
    expect(irisApiBase("arc-testnet")).toBe(
      "https://iris-api-sandbox.circle.com",
    );
  });
});
