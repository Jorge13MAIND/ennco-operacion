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
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-xss-protection": "0",
  });
  const csp = response.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
});

test("diagnostic calculates a synthetic range and returns a private PDF", async ({ page, request }) => {
  await page.goto("/diagnostico");
  await page.getByRole("button", { name: "Generar referencia" }).click();
  await expect(page.getByText(/ENN-PRE-/)).toBeVisible();
  await expect(page.getByText("Esta solicitud todavía no cuenta como lead contractual.")).toBeVisible();
  await expect(page.getByText(/Evidencia: synthetic_demo\. Persistencia: SYNTHETIC_NOT_PERSISTED\./)).toBeVisible();

  const pdfUrl = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
  expect(pdfUrl).toBeTruthy();
  const pdf = await request.get(pdfUrl!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["cache-control"]).toBe("private, no-store");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  const tampered = await request.get(`${pdfUrl}x`);
  expect(tampered.status()).toBe(401);
});

test("diagnostic honeypot accepts without creating a visible result", async ({ request }) => {
  const response = await request.post("/api/v1/prequotes", {
    headers: { "Idempotency-Key": `m3-honeypot-${crypto.randomUUID()}` },
    data: { website: "bot.invalid" },
  });
  expect(response.status()).toBe(202);
  await expect(response.json()).resolves.toEqual({ status: "ACCEPTED" });
});

test("conversion analytics accepts only the PII-free allowlist", async ({ request }) => {
  const valid = {
    eventName: "DIAGNOSTIC_VIEWED",
    sessionId: crypto.randomUUID(),
    correlationId: null,
    path: "/diagnostico",
    properties: {},
    occurredAt: new Date().toISOString(),
  };
  const accepted = await request.post("/api/v1/events", {
    headers: { "Idempotency-Key": `m3-analytics-${crypto.randomUUID()}` },
    data: valid,
  });
  expect(accepted.status()).toBe(202);
  await expect(accepted.json()).resolves.toMatchObject({ persistence_status: "SYNTHETIC_NOT_PERSISTED" });

  const rejected = await request.post("/api/v1/events", {
    headers: { "Idempotency-Key": `m3-analytics-${crypto.randomUUID()}` },
    data: { ...valid, properties: { email: "person@example.com" } },
  });
  expect(rejected.status()).toBe(400);
});

test("privacy notice is visible and explicitly remains a legal draft", async ({ page }) => {
  await page.goto("/privacidad");
  await expect(page.getByRole("heading", { level: 1, name: "Aviso de privacidad integral" })).toBeVisible();
  await expect(page.getByText("No aprobado para producción.")).toBeVisible();
  await expect(page.getByText("Versión DRAFT-2026-08-11.")).toBeVisible();
});

test("control room never presents setup as live commercial truth", async ({ page }) => {
  await page.goto("/operacion");
  await expect(page.getByText("synthetic_demo")).toBeVisible();
  await expect(page.getByText("Modo sintético con tráfico cero.")).toBeVisible();
  await expect(page.getByText("Leads contractuales")).toBeVisible();
  await expect(page.getByText("Pipeline estricto")).toBeVisible();
  await expect(page.getByText("BLOQUEADO", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Módulos de operación" })).toBeVisible();
});

test("operations modules preserve synthetic disclosure and an empty operational pipeline", async ({ page }) => {
  await page.goto("/operacion/respuestas");
  await expect(page.getByRole("heading", { level: 1, name: "Bandeja de respuestas" })).toBeVisible();
  await expect(page.getByText("Los renglones marcados SIMULACION no son empresas, respuestas, leads ni oportunidades reales.")).toBeVisible();
  await expect(page.getByText("Planta Alfa, ejemplo anónimo")).toBeVisible();

  await page.goto("/operacion/pipeline");
  await expect(page.getByText("No hay oportunidades reales.")).toBeVisible();

  await page.goto("/operacion/campanas");
  await expect(page.getByText("0/30 gates live")).toBeVisible();
  await expect(page.getByText("0 destinatarios reales")).toBeVisible();
  await expect(page.getByText("HOLD", { exact: true })).toBeVisible();

  await page.goto("/operacion/roadmap");
  await expect(page.getByText("M6. Primer correo")).toBeVisible();
  await expect(page.getByText("Resolver evidencia externa. Mantener HOLD y cero destinatarios hasta que los 30 gates live estén en PASS.")).toBeVisible();

  await page.goto("/operacion/entrega");
  await expect(page.getByRole("heading", { level: 1, name: "Hardening y entrega" })).toBeVisible();
  await expect(page.getByText("Estado local, sin entrega real.")).toBeVisible();
  await expect(page.getByText("EVIDENCE_READY sólo describe el paquete local. UAT, capacitación, transferencia y aceptación ENNCO permanecen en cero.")).toBeVisible();
  await expect(page.getByText("6/6 criterios locales")).toBeVisible();
  await expect(page.getByText("0/10")).toBeVisible();
  await expect(page.getByText("0 aceptaciones")).toBeVisible();
  await expect(page.getByText("No equivale a entrega ENNCO")).toBeVisible();
});

test("synthetic exports are private, empty and explicitly labeled", async ({ request }) => {
  const response = await request.get("/api/v1/exports/companies-contacts");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-evidence-class"]).toBe("synthetic_demo");
  expect(response.headers()["x-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
  const csv = await response.text();
  expect(csv).toContain('"evidence_class","account_name"');
  expect(csv).not.toContain("Planta Alfa");
});

test("Gmail webhook fails closed until the external release gate", async ({ request }) => {
  const response = await request.post("/api/v1/webhooks/gmail", { data: {} });
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ error: "GMAIL_WEBHOOK_NOT_RELEASED" });
});

test("one-click unsubscribe fails closed until its dedicated persistence gate", async ({ request }) => {
  const response = await request.post("/api/v1/unsubscribe?token=synthetic", {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ error: "UNSUBSCRIBE_NOT_RELEASED" });
});

test("visible unsubscribe link renders a private noindex confirmation surface", async ({ request }) => {
  const response = await request.get("/api/v1/unsubscribe?token=synthetic");
  expect(response.status()).toBe(503);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  expect(response.headers()["content-security-policy"]).toContain("form-action 'self'");
  expect(await response.text()).toContain("Enlace no disponible");
});

test("operational mutations cannot persist in synthetic mode", async ({ request }) => {
  const response = await request.post(
    "/api/v1/operations/provider-events/11111111-1111-4111-8111-111111111111/review",
    { data: { classification: "POSITIVE" }, headers: { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" } },
  );
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ error: "SYNTHETIC_MUTATION_DISABLED" });
});

test("commercial evidence cannot be recorded in synthetic mode", async ({ request }) => {
  const response = await request.post(
    "/api/v1/operations/leads/11111111-1111-4111-8111-111111111111/evidence",
    {
      headers: { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" },
      data: {
        criterion: "outside_annex_a",
        value: true,
        sourceUrl: "https://example.invalid/annex",
        sourceName: "Fuente sintética",
        observedAt: new Date().toISOString(),
        confidence: "VERIFIED",
      },
    },
  );
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ error: "SYNTHETIC_MUTATION_DISABLED" });
});

test("canonical commercial operations remain disabled in synthetic mode", async ({ request }) => {
  const headers = { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" };
  const id = "11111111-1111-4111-8111-111111111111";
  const create = await request.post(`/api/v1/operations/leads/${id}/opportunity`, { headers });
  expect(create.status()).toBe(409);
  const meeting = await request.post(`/api/v1/operations/opportunities/${id}/meetings`, {
    headers,
    data: { scheduledAt: "2026-08-13T16:00:00.000Z" },
  });
  expect(meeting.status()).toBe(409);
  const payment = await request.post(`/api/v1/operations/opportunities/${id}/payments`, {
    headers,
    data: {
      amountMxn: 100_000,
      paidAt: "2026-08-12T12:00:00.000Z",
      observedAt: "2026-08-12T12:05:00.000Z",
      sourceUrl: "https://example.invalid/payment",
      sourceName: "Comprobante sintético",
      confidence: "VERIFIED",
    },
  });
  expect(payment.status()).toBe(409);
});

test("operational mutations reject cross-origin requests before authentication", async ({ request }) => {
  const response = await request.post(
    "/api/v1/operations/provider-events/11111111-1111-4111-8111-111111111111/review",
    { data: { classification: "POSITIVE" }, headers: { Origin: "https://evil.invalid", "Sec-Fetch-Site": "cross-site" } },
  );
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: "MUTATION_ORIGIN_MISMATCH" });
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
