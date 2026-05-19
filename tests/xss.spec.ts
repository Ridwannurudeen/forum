import { test, expect, Route } from "@playwright/test";

// XSS regression suite for frontend/index.html.
//
// Codex's audit pass escaped every innerHTML sink that touches API or
// user-controlled data via escapeHtml / safeShortAddr / safeExplorerAddr.
// These tests prove that even when the indexer API returns hostile payloads,
// the page renders them as literal text and no script executes.
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

async function installApiMocks(page) {
  // Catch-all: every /api/* hit gets a deterministic hostile payload so we
  // exercise every render path that reads from the indexer.
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

test.describe("XSS regression — Codex audit follow-up", () => {
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
      timeout: 15_000,
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
    // Wait for the malicious creator address to land in the DOM.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("recent-factory-vaults");
        return el && el.querySelectorAll("a").length > 0;
      },
      { timeout: 10_000 },
    );

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

  test("c) malicious receipt JSON (botId with svg-onload) does not execute via verifyAnyReceipt", async ({
    page,
  }) => {
    await installApiMocks(page);
    // Intercept the user-supplied https:// receipt URL.
    const RECEIPT_URL = "https://example.com/malicious-receipt.json";
    await page.route(RECEIPT_URL, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema: "forum.receipt.v1",
          botId: MALICIOUS_SVG,
          seq: 1,
          fills: [],
        }),
      }),
    );

    // #vr-url + #vr-verify-btn live in the /proof route's #receipts section.
    await page.goto("/index.html#/proof", { waitUntil: "domcontentloaded" });

    // verifyAnyReceipt reads from #vr-url and writes the botId into the
    // #vr-botid <span> via textContent (line 2617) and into #vr-status via
    // innerHTML (the success/fail span). On the unhappy path (chain read
    // fails because the botId isn't 0x-hex) the error message is also fed
    // through escapedError → escapeHtml.
    await page.fill("#vr-url", RECEIPT_URL);
    await page.click("#vr-verify-btn");

    // Give the verify flow a moment to fail (chain read against the malicious
    // botId will throw); we only care that no script executes.
    await page.waitForTimeout(2000);

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
});
