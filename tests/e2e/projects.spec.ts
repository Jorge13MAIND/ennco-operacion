import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

test.skip(
  process.env.ENNCO_PROJECTS_E2E !== "true",
  "Usar playwright.projects.config.ts con el ambiente temporal de proyectos.",
);
const apiHeaders = () => ({
  "Idempotency-Key": createHash("sha256").update(randomUUID()).digest("hex"),
  Origin: process.env.PROJECTS_E2E_BASE_URL ?? "http://localhost:3017",
  "Sec-Fetch-Site": "same-origin",
});
const panel = (page: Page, name: string) =>
  page
    .locator("section.projects-panel")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
async function seedRecord(
  request: APIRequestContext,
  id: string,
  kind: string,
  data: object,
) {
  const current = await (await request.get(`/api/v1/projects/${id}`)).json();
  const response = await request.post(`/api/v1/projects/${id}/records`, {
    headers: apiHeaders(),
    data: { expectedVersion: current.project.version, kind, data },
  });
  expect(response.status(), `Registro ${kind}: ${await response.text()}`).toBe(
    200,
  );
  const result = await response.json();
  return result.records
    .filter((record: { kind: string }) => record.kind === kind)
    .at(-1);
}
async function createThroughForm(page: Page, segment: string) {
  await page.goto("/operacion/proyectos/lista");
  await page
    .getByRole("button", { name: "+ Nuevo proyecto", exact: true })
    .click();
  const form = panel(page, "Nuevo proyecto");
  const name = `Demostración ${segment} ${randomUUID().slice(0, 6)}`;
  await form.getByLabel("Nombre del proyecto", { exact: false }).fill(name);
  await form
    .getByLabel("Tipo de proyecto", { exact: false })
    .selectOption(segment);
  await form
    .getByLabel("Cliente o razón social", { exact: false })
    .fill("Cliente ficticio para validación");
  await form
    .getByLabel("Ubicación del proyecto", { exact: false })
    .fill("Sitio de demostración, México");
  await form
    .getByRole("button", { name: "Crear expediente", exact: true })
    .click();
  await expect(page).toHaveURL(/\/operacion\/proyectos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("/").at(-1)!;
}

test("los tres segmentos se crean desde el formulario y conservan su expediente", async ({
  page,
}) => {
  for (const segment of ["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"]) {
    const id = await createThroughForm(page, segment);
    await page.reload();
    await expect(page.locator(".projects-tabs")).toBeVisible();
    await expect(page.locator(".projects-tabs a")).toHaveCount(12);
    const saved = await (
      await page.request.get(`/api/v1/projects/${id}`)
    ).json();
    expect(saved.project.segment).toBe(segment);
    expect(saved.project.data.opportunityId).toBeUndefined();
  }
});

test("recibo confirmado, revisión de ingeniería y anticipo liberan el seguimiento real del expediente", async ({
  page,
}) => {
  const id = await createThroughForm(page, "RESIDENTIAL");
  await page
    .locator(".projects-tabs")
    .getByRole("link", { name: "Recibos", exact: true })
    .click();
  const receipt = panel(page, "Registrar consumo");
  await receipt.getByLabel("Tarifa CFE", { exact: false }).fill("PDBT");
  await receipt
    .getByLabel("Inicio del periodo", { exact: false })
    .fill("2026-08-01");
  await receipt
    .getByLabel("Fin del periodo", { exact: false })
    .fill("2026-08-31");
  await receipt.getByLabel("Energía consumida", { exact: false }).fill("480");
  await receipt.getByLabel("Total del recibo", { exact: false }).fill("1600");
  await receipt
    .getByRole("checkbox", { name: /confirmo esta lectura/ })
    .check();
  await receipt
    .getByRole("button", { name: "Guardar registro", exact: true })
    .click();
  await expect(
    panel(page, "Historial de consumo").getByText("480", { exact: true }),
  ).toBeVisible();
  await expect(receipt.getByRole("status")).toHaveText("Información guardada.");

  await page
    .locator(".projects-tabs")
    .getByRole("link", { name: "Ingeniería", exact: true })
    .click();
  const engineering = panel(page, "Desarrollar la ingeniería");
  await engineering
    .getByRole("checkbox", {
      name: "Consumo y escenario tarifario",
      exact: true,
    })
    .uncheck();
  await engineering
    .getByRole("checkbox", {
      name: "Separación de filas y sombras",
      exact: true,
    })
    .check();
  await engineering
    .getByLabel("Longitud inclinada del panel", { exact: false })
    .fill("2");
  await engineering.getByLabel("Inclinación (°)", { exact: false }).fill("20");
  await engineering
    .getByLabel("Elevación solar de diseño", { exact: false })
    .fill("30");
  await engineering
    .getByLabel("Altura adicional de obstáculo", { exact: false })
    .fill("0");
  await engineering
    .getByLabel("Fuente de la condición de diseño", { exact: false })
    .fill("Levantamiento sintético validado");
  await engineering
    .getByRole("button", { name: "Calcular y guardar revisión" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Otros resultados", exact: true }),
  ).toBeVisible();
  const calculated = await (
    await page.request.get(`/api/v1/projects/${id}`)
  ).json();
  const calculation = calculated.records.find(
    (record: { kind: string }) => record.kind === "calculation",
  );
  expect(calculation.data.result.shadows.clearGapM).toBeGreaterThan(1);

  const proposal = await seedRecord(page.request, id, "proposal", {
    name: "Propuesta de validación",
    calculationId: calculation.id,
    pricingMethod: "COST_PLUS_MARGIN",
    capacityWp: 1000,
    marginPct: 20,
    discountPct: 0,
    vatPct: 16,
    costLines: [
      {
        category: "Paneles solares",
        description: "Material de prueba",
        quantity: 1,
        unitCostMxn: 800,
      },
    ],
    validUntil: "2026-12-31",
    conditions: "Condiciones sintéticas para validar el flujo",
  });
  const acceptance = await seedRecord(page.request, id, "proposal_acceptance", {
    proposalId: proposal.id,
    acceptedAt: "2026-09-10",
    customerEvidence: "Evidencia sintética de aceptación",
  });
  await seedRecord(page.request, id, "contract", {
    proposalId: proposal.id,
    acceptanceId: acceptance.id,
    evidence: "Contrato sintético",
    scope: "Alcance de validación",
    subtotalMxn: 1000,
    vatMxn: 160,
    totalMxn: 1160,
    advanceAmountMxn: 580,
    schedule: [
      {
        id: "anticipo",
        label: "Anticipo de validación",
        amountMxn: 580,
        dueDate: "2026-09-10",
      },
      {
        id: "entrega",
        label: "Entrega",
        amountMxn: 580,
        dueDate: "2026-10-01",
      },
    ],
    terms: "Condiciones sintéticas",
    warranties: "Garantía sujeta a revisión",
  });

  await page.goto(`/operacion/proyectos/${id}?tab=compras`);
  await expect(
    page.getByText("Compras pendiente de liberación", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Registrar orden de compra",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto(`/operacion/proyectos/${id}?tab=cobranza`);
  const payment = panel(page, "Registrar pago del cliente");
  await payment
    .getByLabel("Parcialidad del plan", { exact: false })
    .selectOption("anticipo");
  await payment.getByLabel("Importe recibido", { exact: false }).fill("580");
  await payment
    .getByLabel("Fecha real de recepción", { exact: false })
    .fill("2026-09-10");
  await payment
    .getByLabel("Método de pago", { exact: false })
    .selectOption("Transferencia");
  await payment
    .getByLabel("Referencia bancaria", { exact: false })
    .fill("REFERENCIA-SINTETICA");
  await payment
    .getByLabel("Evidencia de recepción", { exact: false })
    .fill("Comprobante sintético revisado");
  await payment
    .getByRole("checkbox", {
      name: "Administración verificó la recepción de este pago.",
    })
    .check();
  await payment
    .getByRole("button", { name: "Guardar registro", exact: true })
    .click();
  await expect(payment.getByRole("status")).toHaveText("Información guardada.");
  const paid = await (await page.request.get(`/api/v1/projects/${id}`)).json();
  expect(paid.summary).toMatchObject({
    collectedMxn: 580,
    balanceMxn: 580,
    purchasesReleased: true,
  });
  await page.goto(`/operacion/proyectos/${id}?tab=compras`);
  await expect(
    page.getByRole("heading", {
      name: "Registrar orden de compra",
      exact: true,
    }),
  ).toBeVisible();
  await mkdir("evidence/projects", { recursive: true });
  await page.screenshot({
    path: "evidence/projects/purchases-desktop.png",
    fullPage: true,
  });
});

test("el catálogo tiene campos técnicos y las superficies son accesibles en escritorio y móvil", async ({
  page,
}) => {
  await page.goto("/operacion/proyectos/catalogos");
  await page
    .getByRole("button", { name: "+ Agregar al catálogo", exact: true })
    .click();
  const catalog = panel(page, "Nueva entrada de catálogo");
  const catalogName = `Módulo de prueba ${randomUUID().slice(0, 6)}`;
  await catalog
    .getByLabel("Nombre identificable", { exact: false })
    .fill(catalogName);
  await catalog
    .getByLabel("Fuente / ficha técnica", { exact: false })
    .fill("https://example.com/ficha-sintetica");
  await catalog
    .getByLabel("Fecha de la fuente", { exact: false })
    .fill("2026-09-10");
  await catalog.getByLabel("Modelo", { exact: false }).fill("MODULO-SINTETICO");
  await catalog.getByLabel("Potencia (W)", { exact: false }).fill("650");
  await catalog
    .getByRole("button", { name: "Guardar versión", exact: true })
    .click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: catalogName })
      .getByText("Por revisar", { exact: true }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main.projects-page").analyze())
      .violations,
  ).toEqual([]);
  await page.goto("/operacion/proyectos");
  await expect(
    page.getByRole("heading", { name: "Control Maestro", level: 1 }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main.projects-page").analyze())
      .violations,
  ).toEqual([]);
  await mkdir("evidence/projects", { recursive: true });
  await page.screenshot({
    path: "evidence/projects/master-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/operacion/proyectos/lista");
  await expect(
    page.getByRole("heading", { name: "Tus proyectos", level: 1 }),
  ).toBeVisible();
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  expect(
    (await new AxeBuilder({ page }).include("main.projects-page").analyze())
      .violations,
  ).toEqual([]);
  const projects = await (await page.request.get("/api/v1/projects")).json();
  await page
    .locator("main input[type=search]")
    .fill(projects.projects.at(-1).name);
  await page.screenshot({
    path: "evidence/projects/list-mobile.png",
    fullPage: true,
  });
  await page.getByText("Menú de operación", { exact: true }).click();
  await expect(
    page
      .locator(".operations-mobile-menu")
      .getByRole("heading", { name: "Proyectos ENNCO" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".operations-mobile-menu")
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "evidence/projects/navigation-mobile.png",
    fullPage: true,
  });
});

test("una fuente consultada requiere revisión antes de usarse para dimensionar el proyecto", async ({
  page,
}) => {
  const sourceName = `Recurso sintético ${randomUUID().slice(0, 6)}`;
  const candidate = {
    provider: "PVGIS",
    status: "DRAFT",
    requiresReview: true,
    sourceUrl: "https://re.jrc.ec.europa.eu/api/v5_3/DRcalc?synthetic=true",
    consultedAt: "2026-09-10T12:00:00Z",
    dataset: {
      name: "CLIMATOLOGIA-SINTETICA",
      startYear: 2005,
      endYear: 2023,
      interpretation: "CLIMATOLOGY",
      scenarioYear: 2026,
      latitude: 20,
      longitude: -100,
      tiltDeg: 20,
      azimuthDeg: 0,
      timeBasis: "UTC",
    },
    monthlyResource: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      dailyPlaneOfArrayKwhM2: 5,
      sourceRef: "https://example.com/recurso-sintetico",
      datasetPeriod: "Climatología sintética 2005-2023",
      tiltDeg: 20,
      azimuthDeg: 0,
    })),
    warnings: [
      "Fuente sintética usada sólo para validar el flujo de revisión.",
    ],
  };
  // Only the external provider is stubbed; catalog versions and the engine use the running API.
  await page.route("**/api/v1/projects/catalogs/refresh", (route) =>
    route.fulfill({ status: 200, json: { candidate } }),
  );
  await page.goto("/operacion/proyectos/catalogos");
  const sources = panel(page, "Consultar fuentes actualizadas");
  for (const [label, value] of [
    ["Latitud", "20"],
    ["Longitud", "-100"],
    ["Inclinación del plano", "20"],
    ["Azimut del plano", "0"],
    ["Año del escenario", "2026"],
  ])
    await sources.getByLabel(label!, { exact: false }).fill(value!);
  await sources
    .getByRole("button", { name: "Consultar fuente", exact: true })
    .click();
  await expect(
    sources.getByText("Candidato pendiente de revisión", { exact: true }),
  ).toBeVisible();
  await sources
    .getByLabel("Nombre para identificar la referencia", { exact: false })
    .fill(sourceName);
  await sources
    .getByRole("button", { name: "Guardar candidato en catálogo", exact: true })
    .click();
  const draftRow = page.getByRole("row").filter({ hasText: sourceName });
  await expect(
    draftRow.getByText("Por revisar", { exact: true }),
  ).toBeVisible();
  await draftRow
    .getByRole("button", { name: "Revisar y aprobar", exact: true })
    .click();
  const review = panel(page, `Revisar fuente: ${sourceName}`);
  await review.getByRole("checkbox", { name: /Verifiqué los valores/ }).check();
  await review
    .getByRole("button", { name: "Crear versión aprobada", exact: true })
    .click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: sourceName })
      .getByText("Aprobado", { exact: true }),
  ).toBeVisible();
  const stored = await (
    await page.request.get("/api/v1/projects/catalogs")
  ).json();
  const versions = stored.entries.filter(
    (entry: { name: string }) => entry.name === sourceName,
  );
  expect(
    versions
      .map((entry: { version: number; status: string }) => [
        entry.version,
        entry.status,
      ])
      .sort(),
  ).toEqual([
    [1, "DRAFT"],
    [2, "APPROVED"],
  ]);
  const approved = versions.find(
    (entry: { status: string }) => entry.status === "APPROVED",
  );
  const id = await createThroughForm(page, "COMMERCIAL");
  await page
    .locator(".projects-tabs")
    .getByRole("link", { name: "Ingeniería", exact: true })
    .click();
  const engineering = panel(page, "Desarrollar la ingeniería");
  await engineering
    .getByRole("checkbox", { name: "Dimensionamiento preliminar", exact: true })
    .check();
  await engineering
    .getByLabel("Consumo anual documentado", { exact: false })
    .fill("10000");
  await engineering
    .getByLabel("Cobertura energética objetivo", { exact: false })
    .fill("80");
  await engineering
    .getByLabel("Potencia del módulo para estimar", { exact: false })
    .fill("500");
  await engineering
    .getByLabel("Índice de desempeño previsto", { exact: false })
    .fill("0.8");
  await engineering
    .getByLabel("Evidencia del consumo y criterio", { exact: false })
    .fill("Mediciones sintéticas confirmadas para esta validación");
  await engineering
    .getByLabel("Usar una referencia aprobada", { exact: false })
    .selectOption(approved.id);
  await engineering
    .getByRole("button", { name: "Calcular y guardar revisión", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Dimensionamiento preliminar",
      exact: true,
    }),
  ).toBeVisible();
  const detail = await (
    await page.request.get(`/api/v1/projects/${id}`)
  ).json();
  const calculation = detail.records.find(
    (record: { kind: string }) => record.kind === "calculation",
  );
  expect(calculation.data.result.preliminarySizing.moduleCount).toBe(11);
  expect(calculation.data.result.preliminarySizing.capacityKw).toBe(5.5);
  expect(calculation.data.input.preliminarySizing.monthlyResource).toHaveLength(
    12,
  );
  await page.screenshot({
    path: "evidence/projects/engineering-desktop.png",
    fullPage: true,
  });
});

test("un cobro cubre varias parcialidades sin duplicarse y conserva revisiones del calendario", async ({
  page,
}) => {
  const id = await createThroughForm(page, "INDUSTRIAL");
  const proposal = await seedRecord(page.request, id, "proposal", {
    name: "Propuesta para distribución de cobro",
    pricingMethod: "COST_PLUS_MARGIN",
    capacityWp: 1000,
    marginPct: 20,
    discountPct: 0,
    vatPct: 16,
    costLines: [
      {
        category: "Paneles solares",
        description: "Material sintético",
        quantity: 1,
        unitCostMxn: 800,
      },
    ],
    validUntil: "2026-12-31",
    conditions: "Condiciones sintéticas para validar distribución",
  });
  const acceptance = await seedRecord(page.request, id, "proposal_acceptance", {
    proposalId: proposal.id,
    acceptedAt: "2026-09-10",
    customerEvidence: "Aceptación sintética",
  });
  const contract = await seedRecord(page.request, id, "contract", {
    proposalId: proposal.id,
    acceptanceId: acceptance.id,
    evidence: "Contrato sintético",
    scope: "Alcance sintético de distribución",
    subtotalMxn: 1000,
    vatMxn: 160,
    totalMxn: 1160,
    advanceAmountMxn: 580,
    schedule: [
      {
        id: "anticipo",
        label: "Anticipo",
        amountMxn: 580,
        dueDate: "2026-09-10",
      },
      {
        id: "entrega",
        label: "Entrega",
        amountMxn: 580,
        dueDate: "2026-10-01",
      },
    ],
    terms: "Condiciones sintéticas",
    warranties: "Garantías sintéticas",
  });
  const payment = await seedRecord(page.request, id, "customer_payment", {
    contractId: contract.id,
    amountMxn: 1160,
    paidAt: "2026-09-10",
    method: "Transferencia",
    reference: `PAGO-SINTETICO-${randomUUID().slice(0, 8)}`,
    evidence: "Evidencia sintética de recepción total",
    confirmed: true,
  });
  await page.goto(`/operacion/proyectos/${id}?tab=cobranza`);
  const calendar = panel(page, "Nueva revisión del calendario");
  await calendar
    .getByLabel("Fecha programada", { exact: false })
    .nth(1)
    .fill("2026-10-15");
  await calendar
    .getByLabel("Motivo de la revisión del calendario", { exact: false })
    .fill("Reprogramación sintética acordada");
  await calendar
    .getByLabel("Acuerdo del calendario", { exact: false })
    .fill("Evidencia sintética de acuerdo");
  await calendar
    .getByRole("button", {
      name: "Guardar revisión del calendario",
      exact: true,
    })
    .click();
  await expect(calendar.getByRole("status")).toHaveText(
    "Información guardada.",
  );
  const distribution = panel(page, "Asignar cobro a parcialidades");
  await distribution
    .getByLabel("Pago confirmado", { exact: false })
    .selectOption(payment.id);
  await distribution
    .getByRole("combobox", { name: /^Parcialidad/ })
    .selectOption("anticipo");
  await distribution
    .getByLabel("Importe asignado MXN", { exact: false })
    .fill("580");
  await distribution
    .getByRole("button", { name: "+ Agregar fila", exact: true })
    .click();
  await distribution
    .getByRole("combobox", { name: /^Parcialidad/ })
    .nth(1)
    .selectOption("entrega");
  await distribution
    .getByLabel("Importe asignado MXN", { exact: false })
    .nth(1)
    .fill("580");
  await distribution
    .getByLabel("Motivo de la distribución", { exact: false })
    .fill("Una transferencia liquida el anticipo y la entrega");
  await distribution
    .getByLabel("Evidencia de asignación", { exact: false })
    .fill("Conciliación sintética del comprobante");
  await distribution
    .getByRole("button", { name: "Guardar asignación del cobro", exact: true })
    .click();
  await expect(distribution.getByRole("status")).toHaveText(
    "Información guardada.",
  );
  const detail = await (
    await page.request.get(`/api/v1/projects/${id}`)
  ).json();
  expect(detail.summary).toMatchObject({
    collectedMxn: 1160,
    balanceMxn: 0,
    nextPayment: null,
  });
  expect(
    detail.records.filter(
      (record: { kind: string }) => record.kind === "customer_payment",
    ),
  ).toHaveLength(1);
  const revision = detail.records.find(
    (record: { kind: string }) => record.kind === "payment_schedule",
  );
  expect(revision.data.schedule.map((item: { id: string }) => item.id)).toEqual(
    ["anticipo", "entrega"],
  );
  expect(revision.data.schedule[1].dueDate).toBe("2026-10-15");
});

test("el maestro distingue costos conocidos de expedientes pendientes de presupuesto", async ({
  page,
}) => {
  const knownId = await createThroughForm(page, "RESIDENTIAL");
  const unknownId = await createThroughForm(page, "COMMERCIAL");
  const actual = await (await page.request.get("/api/v1/projects")).json();
  const projects = actual.projects.filter((project: { id: string }) =>
    [knownId, unknownId].includes(project.id),
  );
  const known = {
    ...actual.summaries[knownId],
    budgetMxn: 150,
    incurredMxn: 10,
    projectedCostMxn: 200,
    projectedProfitMxn: 800,
  };
  const unknown = { ...actual.summaries[unknownId] };
  delete unknown.budgetMxn;
  delete unknown.projectedCostMxn;
  delete unknown.projectedProfitMxn;
  // Exercise the API's mixed completeness contract; no financial records are fabricated in storage.
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      json: {
        ...actual,
        projects,
        summaries: { [knownId]: known, [unknownId]: unknown },
      },
    }),
  );
  await page.goto("/operacion/proyectos");
  const projected = page
    .locator(".projects-metric")
    .filter({ has: page.getByText("Costo proyectado", { exact: true }) });
  await expect(projected.getByText("$200.00", { exact: true })).toBeVisible();
  await expect(projected).toContainText("1 de 2 con base de costos");
  const profit = page
    .locator(".projects-metric")
    .filter({ has: page.getByText("Utilidad proyectada", { exact: true }) });
  await expect(profit.getByText("$800.00", { exact: true })).toBeVisible();
  const unknownName = projects.find(
    (project: { id: string }) => project.id === unknownId,
  ).name;
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: unknownName })
      .getByText("Pendiente de presupuesto", { exact: true }),
  ).toHaveCount(3);
  await page.screenshot({
    path: "evidence/projects/master-partial-costs.png",
    fullPage: true,
  });
});
