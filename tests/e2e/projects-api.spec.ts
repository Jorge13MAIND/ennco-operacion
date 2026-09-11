import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
test.skip(
  process.env.ENNCO_PROJECTS_E2E !== "true",
  "Usar playwright.projects.config.ts para la API sintética de proyectos.",
);
const origin = process.env.PROJECTS_E2E_BASE_URL ?? "http://localhost:3017";
const idem = () => randomBytes(32).toString("hex");
const headers = (key = idem()) => ({ origin, "idempotency-key": key });
async function create(request: APIRequestContext) {
  const response = await request.post("/api/v1/projects", {
    headers: headers(),
    data: {
      name: `QA API ${idem().slice(0, 8)}`,
      customerName: "Cliente sintético",
      segment: "COMMERCIAL",
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
test("rechaza solicitudes sin origen, claves ausentes e inyección de cálculo", async ({
  request,
}) => {
  const raw = {
    name: "QA seguridad",
    customerName: "Sintético",
    segment: "RESIDENTIAL",
  };
  expect((await request.post("/api/v1/projects", { data: raw })).status()).toBe(
    403,
  );
  expect(
    (
      await request.post("/api/v1/projects", { headers: { origin }, data: raw })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/v1/projects", {
        headers: headers(),
        data: {
          ...raw,
          organizationId: "00000000-0000-4000-8000-000000000001",
        },
      })
    ).status(),
  ).toBe(422);
  const p = await create(request);
  const response = await request.post(
    `/api/v1/projects/${p.project.id}/records`,
    {
      headers: headers(),
      data: {
        expectedVersion: 1,
        kind: "calculation",
        data: { result: { status: "APPROVED" } },
      },
    },
  );
  expect(response.status()).toBe(400);
});
test("detecta edición simultánea y repite la misma solicitud sin duplicados", async ({
  request,
}) => {
  const p = await create(request),
    url = `/api/v1/projects/${p.project.id}/records`,
    key = idem(),
    payload = {
      expectedVersion: 1,
      kind: "note",
      data: { text: "Nota sintética inmutable" },
    };
  const first = await request.post(url, {
    headers: headers(key),
    data: payload,
  });
  expect(first.status()).toBe(200);
  const replay = await request.post(url, {
    headers: headers(key),
    data: payload,
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).records).toHaveLength(1);
  expect(
    (
      await request.post(url, {
        headers: headers(),
        data: { ...payload, data: { text: "Conflicto de edición" } },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(url, {
        headers: headers(key),
        data: {
          ...payload,
          data: { text: "Otro contenido con la misma clave" },
        },
      })
    ).status(),
  ).toBe(409);
});
test("precio y cliente congelados sobreviven a un reintento posterior a editar el expediente", async ({
  request,
}) => {
  const p = await create(request),
    url = `/api/v1/projects/${p.project.id}`,
    key = idem();
  const payload = {
    expectedVersion: 1,
    kind: "proposal",
    data: {
      name: "Propuesta sintética",
      pricingMethod: "COST_PLUS_MARGIN",
      capacityWp: 5500,
      marginPct: 20,
      discountPct: 0,
      vatPct: 16,
      costLines: [
        {
          category: "Paneles solares",
          description: "Partida sintética interna",
          quantity: 10,
          unitCostMxn: 800,
        },
      ],
      validUntil: "2026-10-31",
      conditions: "Alcance sintético para prueba",
    },
  };
  const first = await request.post(`${url}/records`, {
    headers: headers(key),
    data: payload,
  });
  expect(first.status()).toBe(200);
  const f = await first.json();
  expect(f.records[0].data.totalMxn).toBe(11600);
  const edit = await request.patch(url, {
    headers: headers(),
    data: {
      expectedVersion: f.project.version,
      customerName: "Cliente actualizado sintético",
    },
  });
  expect(edit.status()).toBe(200);
  const retry = await request.post(`${url}/records`, {
    headers: headers(key),
    data: payload,
  });
  expect(retry.status()).toBe(200);
  const r = await retry.json();
  expect(r.records).toHaveLength(1);
  expect(r.records[0].data.customerSnapshot.customerName).toBe(
    "Cliente sintético",
  );
  const pdf = await request.get(
    `${url}/pdf?kind=proposal&revision=${r.records[0].id}`,
  );
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});
test("compras pendientes se mantienen bloqueadas y un mal total se rechaza", async ({
  request,
}) => {
  const p = await create(request),
    url = `/api/v1/projects/${p.project.id}/records`;
  const order = {
    supplier: "Proveedor sintético",
    reference: "QA-OC",
    major: true,
    deliveryDate: "2026-10-01",
    lines: [
      {
        id: "1",
        category: "Paneles solares",
        description: "Panel",
        quantity: 1,
        unit: "pieza",
        unitCostMxn: 800,
      },
    ],
    subtotalMxn: 800,
    vatMxn: 128,
    totalMxn: 928,
    evidence: "Comprobante sintético",
  };
  expect(
    (
      await request.post(url, {
        headers: headers(),
        data: { expectedVersion: 1, kind: "purchase_order", data: order },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(url, {
        headers: headers(),
        data: {
          expectedVersion: 1,
          kind: "purchase_order",
          data: { ...order, totalMxn: 800 },
        },
      })
    ).status(),
  ).toBe(422);
});
