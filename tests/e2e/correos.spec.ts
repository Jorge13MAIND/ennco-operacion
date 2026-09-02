import { expect, test } from "@playwright/test";

test("Correos module renders the direct lane in synthetic mode without leaking raw codes", async ({ page }) => {
  await page.goto("/operacion/correos");
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Motor de");
  await expect(page.getByText("Modo sintético.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buzones" })).toBeVisible();
  await expect(page.getByText("francisco@enncoindustrial.com").first()).toBeVisible();
  await expect(page.getByText("contacto@ennco.com.mx").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campaña" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Respuestas del carril" })).toBeVisible();
  await expect(page.getByText("synthetic_demo", { exact: true })).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("Correos appears in the Control Room navigation", async ({ page }) => {
  await page.goto("/operacion");
  const nav = page.locator("nav.operations-nav");
  const viewportWidth = page.viewportSize()?.width ?? 1440;
  if (viewportWidth > 860) {
    await expect(nav.getByRole("link", { name: "Correos" })).toBeVisible();
  } else {
    await page.getByText("Menú de operación").click();
    await expect(page.getByRole("link", { name: "Correos" }).first()).toBeVisible();
  }
});

test("the public invitation page explains what is missing without a token", async ({ page }) => {
  await page.goto("/correos/conectar");
  await expect(page.getByText("Falta la liga de invitación.")).toBeVisible();
  await page.goto("/correos/conectar?estado=vencida");
  await expect(page.getByText("La invitación venció o ya se usó.")).toBeVisible();
});
