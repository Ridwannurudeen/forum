import { test, expect, Route } from "@playwright/test";

const { startStaticServer } = require("./static-server.cjs");

// XSS regression suite for frontend/index.html.
//
// Every innerHTML sink that touches API or user-controlled data must route
// through escapeHtml / safeShortAddr / safeExplorerAddr. These tests prove that
// even when the indexer API returns hostile payloads, the page renders them as
// literal text and no script executes.
//
// All tests stub /api/* with page.route(); the page still loads viem from
// esm.sh and may attempt the Arc testnet RPC, but those are non-load-bearing
// for XSS coverage.

const MALICIOUS_IMG = `<img src=x onerror="window.__xss_img=true">`;
const MALICIOUS_SCRIPT_BREAKOUT = `</script><script>window.__xss=true</script>`;
const MALICIOUS_SVG = `"><svg onload="window.__xss_svg=true">`;

// Skeleton shapes mirror what keeper/scripts/forum-indexer.mjs returns. We
// only need to populate the fields the frontend renders to innerHTML.
function maliciousAgentsPayload() {
  return [
    {
      botId: `0x${"ab".repeat(32)}`,
      kind: MALICIOUS_IMG, // rendered via escapeHtml at line 3127
      scoreV0: 50,
      recordCount: 1,
      drawdownBps: MALICIOUS_SCRIPT_BREAKOUT, // escapeHtml at 3130
      slashEventCount: 0,
      lastReceiptAt: 0,
      secondsSinceLastReceipt: 10,
    },
  ];
}

function maliciousFactoryVaultsPayload() {
  return [
    {
      vault: "0x" + "11".repeat(20),
      creator: "0x" + "22".repeat(20),
      // Frontend reads `budgetMicros` (line 2945) — Number-coerces, so a
      // hostile string falls to NaN. We also include the brief's requested
      // `mandate.budgetUsdc` so the test data covers both shapes.
      budgetMicros: MALICIOUS_SCRIPT_BREAKOUT,
      mandate: { budgetUsdc: MALICIOUS_SCRIPT_BREAKOUT },
    },
  ];
}

function maliciousRouterActivityPayload() {
  return [
    {
      kind: MALICIOUS_IMG,
      txHash: "0x" + "33".repeat(32),
      user: "0x" + "44".repeat(20),
    },
  ];
}

function maliciousFeesPayload() {
  return {
    splitCount: 1,
    totalRoutedMicros: 0,
    splits: [
      {
        splitId: MALICIOUS_SCRIPT_BREAKOUT,
        creator: "0x" + "55".repeat(20),
        totalRoutedMicros: 0,
        recipients: ["0x" + "66".repeat(20)],
        bps: [10000],
      },
    ],
    recipientClaimableMicros: {},
  };
}

function maliciousFeeStatementPayload() {
  return {
    vaultCount: MALICIOUS_SCRIPT_BREAKOUT,
    totalOperatorClaimableMicros: 0,
    vaults: [
      {
        vault: "0x" + "77".repeat(20),
        state: MALICIOUS_SCRIPT_BREAKOUT,
        perfFeeBps: 100,
        operatorClaimableMicros: 0,
        perSharePriceAboveHwm: false,
      },
    ],
    router: { splitCount: 0 },
  };
}

function maliciousProofPayload() {
  return {
    fills: [{ builderCodeAttached: true }],
    forum: {
      verifiedFillCount: 1,
      verifierResult: MALICIOUS_IMG,
      receiptUri: "javascript:window.__xss_link=true",
      arcscan: "data:text/html,<script>window.__xss_link=true</script>",
    },
    fees: { builderFeeStatus: MALICIOUS_SCRIPT_BREAKOUT },
  };
}

async function installApiMocks(page) {
  await page.route("https://fonts.googleapis.com/**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.route("https://fonts.gstatic.com/**", (route: Route) =>
    route.abort(),
  );
  await page.route("https://esm.sh/viem@2.50.4", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        const ZERO32 = "0x" + "00".repeat(32);
        export function defineChain(chain) { return chain; }
        export function http() { return {}; }
        export function custom(provider) { return provider; }
        export function encodeDeployData() { return "0x"; }
        export function encodeFunctionData() { return "0x"; }
        export function parseAbiItem(item) { return item; }
        export function toHex(value) {
          const text = typeof value === "string" ? value : JSON.stringify(value);
          return "0x" + Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
        export function keccak256() { return ZERO32; }
        export function createWalletClient() {
          return { sendTransaction: async () => ZERO32, writeContract: async () => ZERO32 };
        }
        export function createPublicClient() {
          return {
            chain: { id: 5042002 },
            getBlockNumber: async () => 1n,
            getLogs: async () => [],
            waitForTransactionReceipt: async () => ({ status: "success", gasUsed: 0n }),
            readContract: async ({ functionName }) => {
              if (functionName === "state" || functionName === "evaluate") return 0;
              if (functionName === "perSharePrice") return 1000000000000000000n;
              if (functionName === "recordCount") return 0n;
              if (functionName === "recordAt") return { seq: 1, evidenceHash: ZERO32 };
              return 0n;
            },
          };
        }
      `,
    }),
  );
  // Each /api path touched by these tests gets a deterministic hostile payload
  // so we exercise every render path that reads from the indexer.
  await page.route("**/api/agents", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maliciousAgentsPayload()),
    }),
  );
  await page.route("**/api/factory-vaults**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maliciousFactoryVaultsPayload()),
    }),
  );
  await page.route("**/api/router/activity**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maliciousRouterActivityPayload()),
    }),
  );
  await page.route("**/api/fees", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maliciousFeesPayload()),
    }),
  );
  await page.route("**/api/fee-statement", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maliciousFeeStatementPayload()),
    }),
  );
  await page.route("**/api/proof", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(maliciousProofPayload()),
    }),
  );
  // Receipt JSON fetched by verifyAnyReceipt() — covered in its own test.
  // /api/bots/:botId/records is only triggered by openAgentInspector clicks,
  // which we exercise in test (c).
}

// Sentinel poller: any of the four globals being set means a script executed.
async function readXssFlags(page) {
  return page.evaluate(() => ({
    __xss: (window as any).__xss,
    __xss_img: (window as any).__xss_img,
    __xss_svg: (window as any).__xss_svg,
    __xss_script: (window as any).__xss_script,
  }));
}

test.describe("XSS regression", () => {
  let staticServer: { close: (callback: (err?: Error) => void) => void };

  test.beforeAll(async () => {
    const started = await startStaticServer();
    staticServer = started.server;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      staticServer.close((err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  test("a) /api/agents with <img onerror> renders as literal text", async ({
    page,
  }) => {
    await installApiMocks(page);
    // Navigate straight to the console route so the agents table is mounted
    // and visible (the router gates sections via the `data-route-active` attr).
    await page.goto("/index.html#/console?t=agents", {
      waitUntil: "domcontentloaded",
    });

    // The agents table is inside an app-tab panel; loadAgents() writes the row
    // via innerHTML regardless of tab visibility. `state: 'attached'` is what
    // we need — the XSS question is about DOM contents, not paint state.
    await page.waitForSelector("[data-botid]", {
      state: "attached",
      timeout: 30_000,
    });

    // 1. No real <img> element with the attacker's src was injected anywhere.
    const imgs = await page.locator("img[src='x']").count();
    expect(imgs).toBe(0);

    // 2. The literal text appears in the DOM (proves escapeHtml kicked in).
    const rowText = await page.locator("[data-botid]").first().innerText();
    // innerText collapses whitespace; check for the load-bearing substring.
    expect(rowText).toContain("<img");

    // 3. No sentinel flag set.
    const flags = await readXssFlags(page);
    expect(flags.__xss_img).toBeUndefined();
    expect(flags.__xss).toBeUndefined();
  });

  test("b) /api/factory-vaults with </script><script> breakout does not execute", async ({
    page,
  }) => {
    await installApiMocks(page);
    // The "recent factory vaults" panel sits inside #live-mandate on /console.
    await page.goto("/index.html#/console", { waitUntil: "domcontentloaded" });

    // The recent factory vaults panel renders into #recent-factory-vaults.
    await page.waitForSelector("#recent-factory-vaults [data-vault]", {
      state: "attached",
      timeout: 30_000,
    });

    // No injected <script> tag with attacker-controlled body should exist.
    const injectedScripts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("script")).filter(
        (s) => s.textContent && s.textContent.includes("__xss"),
      ).length;
    });
    expect(injectedScripts).toBe(0);

    const flags = await readXssFlags(page);
    expect(flags.__xss).toBeUndefined();
  });

  test("c) malicious receipt JSON schema does not execute via verifyAnyReceipt", async ({
    page,
  }) => {
    await installApiMocks(page);
    // Intercept the user-supplied https:// receipt URL. The host must be in
    // frontend/index.html's connect-src CSP or the browser blocks fetch before
    // Playwright can fulfill the route.
    const RECEIPT_URL =
      "https://forum.gudman.xyz/receipts/test/malicious-receipt.json";
    await page.route(RECEIPT_URL, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema: MALICIOUS_SVG,
          botId: `0x${"cd".repeat(32)}`,
          seq: 1,
          fills: [],
        }),
      }),
    );

    // #vr-url + #vr-verify-btn live in the /proof route's #receipts section.
    await page.goto("/index.html#/proof", { waitUntil: "domcontentloaded" });

    // verifyAnyReceipt rejects non-v1 schemas via textContent.
    await page.fill("#vr-url", RECEIPT_URL);
    await page.click("#vr-verify-btn");

    // We only care that no script executes.
    await expect(page.locator("#vr-status")).toContainText('"><svg');

    // Confirm no SVG element with onload was injected anywhere in the DOM.
    const dangerousSvg = await page.locator("svg[onload]").count();
    expect(dangerousSvg).toBe(0);

    // The literal text must appear *somewhere* in the verify widget area
    // (textContent path on #vr-botid OR escaped error in #vr-status).
    const bodyText = await page.evaluate(() => document.body.textContent || "");
    expect(bodyText).toContain('"><svg');

    const flags = await readXssFlags(page);
    expect(flags.__xss_svg).toBeUndefined();
    expect(flags.__xss).toBeUndefined();
  });

  test("d) /api/proof cannot inject script links into console verify", async ({
    page,
  }) => {
    await installApiMocks(page);
    await page.goto("/index.html#/console?t=verify", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector("#verify-proof-links a", {
      state: "attached",
      timeout: 10_000,
    });

    const linkHrefs = await page
      .locator("#verify-proof-links a")
      .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    expect(linkHrefs[0]).not.toContain("javascript:");
    expect(linkHrefs[1]).not.toContain("data:");

    const imgs = await page.locator("img[src='x']").count();
    expect(imgs).toBe(0);
    const flags = await readXssFlags(page);
    expect(flags.__xss_img).toBeUndefined();
    expect(flags.__xss).toBeUndefined();
  });

  test("e) bridge relays Arc redeem when Rabby cannot switch to Arc", async ({
    page,
  }) => {
    await installApiMocks(page);
    await page.route("**/api/cctp/redeem", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          txHash: "0x" + "34".repeat(32),
          status: "success",
        }),
      }),
    );
    const wallet = "0x" + "12".repeat(20);
    await page.addInitScript(
      ({ wallet }) => {
        localStorage.setItem(
          "forum.bridge.flow.v1",
          JSON.stringify({
            burnTx: "0x" + "ab".repeat(32),
            sourceDomain: 6,
            message: "0x1234",
            attestation: "0xabcd",
            redeemed: false,
            amount: "1",
            recipient: wallet,
            vault: "",
          }),
        );
        type WalletRequest = {
          method: string;
          params?: Array<{ chainId?: string }>;
        };
        Object.defineProperty(window, "ethereum", {
          configurable: true,
          value: {
            request: async ({ method, params }: WalletRequest) => {
              if (method === "eth_requestAccounts") return [wallet];
              if (method === "eth_chainId") return "0x14a34";
              if (method === "wallet_addEthereumChain") return null;
              if (method === "wallet_switchEthereumChain") {
                const chainId = params?.[0]?.chainId;
                if (chainId === "0x4cef52") {
                  throw new Error(
                    "[From https://rpc.testnet.arc.network] invalid chain ID",
                  );
                }
                return null;
              }
              throw new Error(`unexpected wallet method ${method}`);
            },
          },
        });
      },
      { wallet },
    );

    await page.goto("/index.html#/console?t=bridge", {
      waitUntil: "domcontentloaded",
    });
    await page.click("#br-connect-btn");
    await page.click("#br-action-btn");

    await expect(page.locator("#br-status")).toContainText(
      "Vault deposit was skipped",
    );
    await expect(page.locator("#br-redeem-tx")).toContainText("Arc tx");
  });
});
