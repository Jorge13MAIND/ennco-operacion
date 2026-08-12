import { expect, test } from "@playwright/test";

const publicRoutes = ["/diagnostico", "/privacidad"] as const;
const privatePages = ["/", "/ingreso", "/operacion"] as const;

test("default local release keeps public pages noindex with canonical URLs", async ({ page }) => {
  for (const route of publicRoutes) {
    await page.goto(route);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `http://localhost:3000${route}`,
    );
  }
});

test("HOLD never presents public release labels", async ({ page }) => {
  await page.goto("/diagnostico");
  await expect(page.getByText("Disponible", { exact: true })).toHaveCount(0);
  await expect(page.getByText("live", { exact: true })).toHaveCount(0);

  await page.goto("/privacidad");
  await expect(page.getByText("Publicado", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Vigente", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Borrador legal", { exact: true })).toBeVisible();
  await expect(page.getByText("No publicado.", { exact: true })).toBeVisible();
});

test("the internal root remains noindex in every release state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);
});

test("robots and sitemap stay on HOLD without an explicit validated release", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /");
  expect(await robots.text()).not.toContain("Sitemap:");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain("<loc>");
});

test("portal, auth and APIs are never indexable", async ({ request }) => {
  for (const route of privatePages.slice(1)) {
    const response = await request.get(route);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  }

  const api = await request.get("/api/v1/health");
  expect(api.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
});
