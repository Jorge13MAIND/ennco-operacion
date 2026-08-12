import { expect, test } from "@playwright/test";

test("home exposes the two primary surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("De la planta correcta");
  await expect(page.getByRole("link", { name: "Abrir diagnóstico" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver Control Room" })).toBeVisible();
});

test("application surfaces return the security header baseline", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()).toMatchObject({
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
});

test("diagnostic calculates a synthetic range", async ({ page }) => {
  await page.goto("/diagnostico");
  await page.getByRole("button", { name: "Generar referencia" }).click();
  await expect(page.getByText(/ENN-PRE-/)).toBeVisible();
  await expect(page.getByText("DRAFT_REVIEW_REQUIRED")).toBeVisible();
  await expect(page.getByText("synthetic_demo", { exact: true })).toBeVisible();
});

test("control room never presents setup as live commercial truth", async ({ page }) => {
  await page.goto("/operacion");
  await expect(page.getByText("synthetic_demo")).toBeVisible();
  await expect(page.getByText("Datos sintéticos. Ninguna actividad comercial real ha sido ejecutada.")).toBeVisible();
  await expect(page.getByText("Kill switch activo")).toBeVisible();
});

test("identity surface keeps real access separate from the local demo", async ({ page }) => {
  await page.goto("/ingreso");
  await expect(page.getByRole("heading", { level: 1, name: "Control Room ENNCO" })).toBeVisible();
  await expect(page.getByText("Modo local con tráfico cero.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir demo sintético" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Correo" })).toHaveCount(0);
});

test("golden path is executable and idempotent", async ({ page }) => {
  await page.goto("/operacion");
  await page.getByRole("button", { name: "Ejecutar golden path" }).click();
  await expect(page.getByText("COMPLETED")).toBeVisible();
  await expect(page.getByText("Creado")).toBeVisible();
  await expect(page.getByRole("list", { name: "Traza del golden path" }).getByRole("listitem")).toHaveCount(8);
  await expect(page.getByText("NEXT_ACTION_CREATED")).toBeVisible();
  await page.getByRole("button", { name: "Repetir con la misma llave" }).click();
  await expect(page.getByText("DUPLICATE", { exact: true })).toBeVisible();
});

test("suppression stops the synthetic path before message creation", async ({ request }) => {
  const response = await request.post("/api/v1/internal/synthetic/golden-path", {
    data: { idempotencyKey: `suppressed-${crypto.randomUUID()}`, suppressed: true },
  });
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    external_side_effects: 0,
    result: {
      status: "SUPPRESSED",
      trace: [
        { sequence: 1, stage: "COMPANY_REGISTERED" },
        { sequence: 2, stage: "SUPPRESSION_BLOCKED" },
      ],
    },
  });
});

test("assistant fails closed until its release gate", async ({ request }) => {
  const response = await request.post("/api/v1/assistant/messages", { data: { message: "¿Cuál es la garantía?" } });
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ error: "ASSISTANT_NOT_RELEASED" });
});
