import { expect, test } from "@playwright/test";

const criticalSurfaces = [
  { path: "/", name: "home" },
  { path: "/diagnostico", name: "diagnostic" },
  { path: "/privacidad", name: "privacy" },
  { path: "/ingreso", name: "identity" },
  { path: "/operacion", name: "control-room" },
] as const;

for (const surface of criticalSurfaces) {
  test(`${surface.name} preserves its main landmark without horizontal page overflow`, async ({ page }) => {
    await page.goto(surface.path);
    await expect(page.locator("main#main-content")).toHaveCount(1);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });
}

test("320 CSS pixel reflow equivalent keeps critical surfaces free of page-level horizontal scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-standard", "One deterministic Chromium reflow run is sufficient.");
  await page.setViewportSize({ width: 320, height: 900 });
  for (const surface of criticalSurfaces) {
    await page.goto(surface.path);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `${surface.name} overflowed at 320 CSS px`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test("skip link bypasses repeated navigation and moves focus to the main landmark", async ({ page }) => {
  await page.goto("/diagnostico");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Saltar al contenido principal" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
  await expect(page).toHaveURL(/#main-content$/);
});

test("Control Room keeps ENNCO identity, private context, grouped navigation and session exit", async ({ page }) => {
  await page.goto("/operacion");

  const header = page.locator("header.site-header-operations");
  await expect(header.locator("img[src='/brand/ennco-lockup.svg']")).toBeVisible();
  await expect(header.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.getByText("Demo sintético", { exact: true })).toBeVisible();
  await expect(page.getByText("synthetic_demo", { exact: true })).toHaveCount(0);
  await expect(page.getByText("BLOCKED_EXTERNAL", { exact: true })).toHaveCount(0);

  const viewportWidth = page.viewportSize()?.width ?? 1440;
  if (viewportWidth > 860) {
    await expect(header.getByText("Control Room", { exact: true })).toBeVisible();
    await expect(header.getByText("Operación privada", { exact: true })).toBeVisible();
    const desktopNavigation = page.locator("aside.operations-sidebar");
    await expect(desktopNavigation.getByRole("heading", { name: "Control" })).toBeVisible();
    await expect(desktopNavigation.getByRole("heading", { name: "Comercial" })).toBeVisible();
    await expect(desktopNavigation.getByRole("heading", { name: "Gobierno" })).toBeVisible();
  } else {
    await page.getByText("Menú de operación", { exact: true }).click();
    const mobileNavigation = page.getByRole("navigation", { name: "Módulos de operación" });
    await expect(mobileNavigation.getByRole("heading", { name: "Control" })).toBeVisible();
    await expect(mobileNavigation.getByRole("heading", { name: "Comercial" })).toBeVisible();
    await expect(mobileNavigation.getByRole("heading", { name: "Gobierno" })).toBeVisible();
  }

  const authorization = page.getByRole("region", { name: "Autorización efectiva" });
  const commercialTruth = page.getByRole("region", { name: "Verdad comercial" });
  await expect(authorization).toBeVisible();
  await expect(commercialTruth).toBeVisible();
  expect((await authorization.boundingBox())?.y ?? Number.POSITIVE_INFINITY)
    .toBeLessThan((await commercialTruth.boundingBox())?.y ?? Number.NEGATIVE_INFINITY);
});

test("session exit returns to an explicit signed-out access state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-standard", "One deterministic server-action run is sufficient.");
  await page.goto("/operacion");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/ingreso\?reason=signed_out$/);
  await expect(page.getByText("La sesión se cerró correctamente.")).toBeVisible();
});

test("production CSP nonce is propagated to every executable script and hydration remains available", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  test.skip(
    csp.includes("'unsafe-eval'"),
    "The general E2E suite uses next dev; exact nonce propagation is enforced by the production M23 gate.",
  );
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const scriptNonces = await page.locator("script").evaluateAll((scripts) => scripts.map((script) => script.nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((scriptNonce) => scriptNonce === nonce)).toBe(true);

  await page.goto("/diagnostico");
  await page.getByRole("button", { name: "Generar referencia" }).click();
  await expect(page.getByText(/ENN-PRE-/)).toBeVisible();
});

test("diagnostic journey is keyboard operable with visible focus and an announced result", async ({ page }) => {
  const failedRequests: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.method() === "GET" && new URL(request.url()).searchParams.has("_rsc")) return;
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  await page.goto("/diagnostico");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  const focusOrder: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeInViewport({ ratio: 0.5 });
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        label: element.getAttribute("aria-label")
          ?? element.getAttribute("name")
          ?? element.textContent?.trim()
          ?? element.tagName,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    expect(focused, "Keyboard focus escaped to the document body").not.toBeNull();
    if (!focused) continue;
    focusOrder.push(focused.label);
    expect(focused.outlineStyle).not.toBe("none");
    expect(focused.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(focused.rect.right).toBeGreaterThan(0);
    expect(focused.rect.left).toBeLessThan(focused.viewport.width);
    expect(focused.rect.bottom).toBeGreaterThan(0);
    expect(focused.rect.top).toBeLessThan(focused.viewport.height);
    if (focused.label === "Generar referencia") break;
  }

  expect(focusOrder).toContain("needType");
  expect(focusOrder).toContain("monthlySpendMxn");
  expect(focusOrder).toContain("consent");
  expect(focusOrder.at(-1)).toBe("Generar referencia");

  await page.keyboard.press("Enter");
  await expect(page.getByText(/ENN-PRE-/)).toBeVisible();
  await expect(page.locator("aside[aria-live='polite']")).toContainText("Esta solicitud todavía no cuenta como lead contractual.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Descargar PDF" })).toBeFocused();

  expect(failedRequests).toEqual([]);
});
