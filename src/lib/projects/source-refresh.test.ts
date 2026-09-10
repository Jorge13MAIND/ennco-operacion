import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { calculateEngineering } from "./engineering";
import {
  fetchExchangeRate,
  fetchSolarResource,
  normalizePvgisDailyResponse,
  refreshSource,
  solarResourceRequestSchema,
  sourceRefreshSchema,
  type SolarResourceRequest,
} from "./source-refresh";

const request: SolarResourceRequest = {
  lat: 20.67,
  lon: -103.35,
  tilt: 20,
  azimuth: -90,
  year: 2028,
};
const now = () => new Date("2026-09-10T12:00:00Z");
function payload() {
  return {
    inputs: {
      location: { latitude: 20.67, longitude: -103.35 },
      meteo_data: {
        radiation_db: "PVGIS-ERA5",
        year_min: 2005,
        year_max: 2023,
      },
      plane: { fixed: { slope: { value: 20 }, azimuth: { value: -90 } } },
      time_format: "UTC",
    },
    outputs: {
      daily_profile: Array.from({ length: 12 }, (_, m) =>
        Array.from({ length: 24 }, (_, h) => ({
          month: m + 1,
          time: `${String(h).padStart(2, "0")}:30`,
          "G(i)": 250,
        })),
      ).flat(),
    },
    meta: {
      outputs: {
        daily_profile: {
          timestamp: "hourly",
          variables: { "G(i)": { units: "W/m2" } },
        },
      },
    },
  };
}
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const normal = (value: unknown) =>
  normalizePvgisDailyResponse(
    value,
    request,
    "https://re.jrc.ec.europa.eu/api/v5_3/DRcalc?example",
    now().toISOString(),
  );
const fixtureToken = "a".repeat(64);
const exchangePayload = () => ({
  bmx: {
    series: [
      {
        idSerie: "SF43718",
        titulo: "Pesos por dólar FIX",
        datos: [{ fecha: "09/09/2026", dato: "18.2345" }],
      },
    ],
  },
});

describe("actualización de fuentes con trazabilidad", () => {
  it("integra 24 promedios horarios W/m² a kWh/m²/día sin doble normalización", () => {
    const result = normal(payload());
    // 24 × 250 W × 1 hour = 6,000 Wh, i.e. 6 kWh/m²/day.
    expect(result.monthlyResource).toHaveLength(12);
    expect(result.monthlyResource[0]!.dailyPlaneOfArrayKwhM2).toBe(6);
    expect(result.monthlyResource[0]!.month).toBe("2028-01");
    expect(result.monthlyResource[0]!.datasetPeriod).toContain(
      "2005-2023; climatología",
    );
    expect(result.dataset.interpretation).toBe("CLIMATOLOGY");
    expect(result.dataset.scenarioYear).toBe(2028);
    expect(result.status).toBe("DRAFT");
    expect(result.requiresReview).toBe(true);
    // Engine multiplies month days once. February 2028: 5kWp × 6h/day × .8 × 29d = 696 kWh.
    const engineering = calculateEngineering({
      segment: "RESIDENTIAL",
      solar: {
        moduleCount: 10,
        module: { model: "Prueba", sourceRef: "fixture", powerW: 500 },
        performanceRatio: 0.8,
        performanceRatioSourceRef: "fixture",
        monthlyResource: result.monthlyResource,
      },
    });
    expect(engineering.solar?.monthlyGeneration[1]!.generationKwh).toBe(696);
    expect(engineering.solar?.annualGenerationKwh).toBe(8784);
  });

  it("rechaza meses/horas incompletos, duplicados o unidades distintas", () => {
    const incomplete = payload();
    incomplete.outputs.daily_profile.pop();
    expect(() => normal(incomplete)).toThrow("doce perfiles");
    const duplicate = payload();
    duplicate.outputs.daily_profile[1]!.time = "00:30";
    expect(() => normal(duplicate)).toThrow("horas duplicadas");
    const wrongUnits = payload();
    wrongUnits.meta.outputs.daily_profile.variables["G(i)"].units = "kWh/m2";
    expect(() => normal(wrongUnits)).toThrow("unidades W/m²");
    const negative = payload();
    negative.outputs.daily_profile[0]!["G(i)"] = -1;
    expect(() => normal(negative)).toThrow("doce perfiles");
  });

  it("comprueba que plano y ubicación realmente coincidan con la consulta", () => {
    const wrongPlane = payload();
    wrongPlane.inputs.plane.fixed.azimuth.value = 0;
    expect(() => normal(wrongPlane)).toThrow("no corresponden");
    const wrongSite = payload();
    wrongSite.inputs.location.latitude = 21;
    expect(() => normal(wrongSite)).toThrow("no corresponden");
  });

  it("consulta host fijo, aspecto real y doce meses sin pedir un año de observaciones ficticio", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(payload()));
    const result = await fetchSolarResource(request, { fetchImpl, now });
    const [urlValue, options] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(urlValue));
    expect(url.origin).toBe("https://re.jrc.ec.europa.eu");
    expect(url.pathname).toBe("/api/v5_3/DRcalc");
    expect(url.searchParams.get("aspect")).toBe("-90");
    expect(url.searchParams.get("month")).toBe("0");
    expect(url.searchParams.get("global")).toBe("1");
    expect(url.searchParams.has("year")).toBe(false);
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result.consultedAt).toBe("2026-09-10T12:00:00.000Z");
  });

  it("un proveedor fallido no introduce datos históricos como sustitución", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("error", { status: 503 }));
    await expect(
      fetchSolarResource(request, { fetchImpl }),
    ).rejects.toMatchObject({ code: "SOURCE_HTTP_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("límites de tamaño, tipo de contenido, JSON inválido y timeout son visibles", async () => {
    const size = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("{}", {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "1000001",
          },
        }),
      );
    await expect(
      fetchSolarResource(request, { fetchImpl: size }),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_TOO_LARGE" });
    const actualSize = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("x".repeat(1_000_001), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    await expect(
      fetchSolarResource(request, { fetchImpl: actualSize }),
    ).rejects.toMatchObject({ code: "SOURCE_RESPONSE_TOO_LARGE" });
    const html = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      );
    await expect(
      fetchSolarResource(request, { fetchImpl: html }),
    ).rejects.toMatchObject({ code: "SOURCE_CONTENT_TYPE" });
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("{", { headers: { "Content-Type": "application/json" } }),
      );
    await expect(
      fetchSolarResource(request, { fetchImpl: malformed }),
    ).rejects.toMatchObject({ code: "SOURCE_INVALID_JSON" });
    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("test", "TimeoutError"));
    await expect(
      fetchSolarResource(request, { fetchImpl: timeout }),
    ).rejects.toMatchObject({ code: "SOURCE_TIMEOUT" });
  });

  it("valida coordenadas y no acepta URLs/token desde parámetros de actualización", () => {
    expect(
      solarResourceRequestSchema.safeParse({ ...request, lat: 91 }).success,
    ).toBe(false);
    expect(
      sourceRefreshSchema.safeParse({
        ...request,
        provider: "PVGIS",
        url: "http://127.0.0.1",
      }).success,
    ).toBe(false);
    expect(
      sourceRefreshSchema.safeParse({
        provider: "BANXICO",
        token: fixtureToken,
      }).success,
    ).toBe(false);
    expect(sourceRefreshSchema.safeParse({ provider: "OTHER" }).success).toBe(
      false,
    );
  });

  it("Banxico exige configuración de servidor, fecha real y dato numérico de la serie FIX", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      fetchExchangeRate({ banxicoToken: "", fetchImpl }),
    ).rejects.toMatchObject({ code: "BANXICO_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockResolvedValue(response(exchangePayload()));
    const rate = await fetchExchangeRate({
      banxicoToken: fixtureToken,
      fetchImpl,
      now,
    });
    expect(rate.rateMxnPerUsd).toBe(18.2345);
    expect(rate.observationDate).toBe("2026-09-09");
    expect(rate.status).toBe("DRAFT");
    expect(rate.sourceUrl).not.toContain(fixtureToken);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain(fixtureToken);
    expect(options?.headers).toMatchObject({ "Bmx-Token": fixtureToken });
  });

  it("FIX N/E o fecha inválida no se convierte a cero", async () => {
    const value = exchangePayload();
    value.bmx.series[0]!.datos[0]!.dato = "N/E";
    await expect(
      fetchExchangeRate({
        banxicoToken: fixtureToken,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(value)),
        now,
      }),
    ).rejects.toMatchObject({ code: "BANXICO_DATA_INVALID" });
    value.bmx.series[0]!.datos[0] = { fecha: "31/02/2026", dato: "20" };
    await expect(
      fetchExchangeRate({
        banxicoToken: fixtureToken,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(value)),
        now,
      }),
    ).rejects.toMatchObject({ code: "BANXICO_DATA_INVALID" });
  });

  it("expone router de consulta y conserva borrador", async () => {
    const result = await refreshSource(
      { provider: "PVGIS", ...request },
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(payload())),
        now,
      },
    );
    expect(result.provider).toBe("PVGIS");
    expect(result.requiresReview).toBe(true);
  });
});

describe("catálogos MEST importados por lista permitida", () => {
  const historical = JSON.parse(
    readFileSync(
      new URL(
        "../../../data/projects/historical-catalogs.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    sourceSha256: string;
    counts: Record<string, number>;
    entries: {
      category: string;
      name: string;
      sourceSheet: string;
      sourceRow: number;
      sourceSha256: string;
      requiresReview: boolean;
      status: string;
      data: {
        rawFields: Record<string, string>;
        fieldProvenance: Record<string, { cell: string; label: string }>;
        reviewFlags: string[];
        sameNameOccurrences: number;
      };
    }[];
  };
  it("preserva los modelos originales y su procedencia, sin adoptar aprobación", () => {
    expect(historical.counts).toEqual({
      conductor_rule: 56,
      installation_method: 6,
      inverter: 40,
      module: 18,
      mounting_rule: 8,
      solar_resource: 59,
    });
    expect(historical.entries).toHaveLength(187);
    const panel = historical.entries.find(
      (e) => e.sourceSheet === "Inf_Módulos" && e.sourceRow === 6,
    )!;
    expect(panel.name).toBe("Longi - LR5-72HTH-585M (585W)");
    expect(panel.data.rawFields.H).toBe("585");
    expect(panel.data.fieldProvenance.H!.cell).toBe("H6");
    expect(panel.sourceSha256).toBe(historical.sourceSha256);
    expect(
      historical.entries.every((e) => e.status === "DRAFT" && e.requiresReview),
    ).toBe(true);
  });

  it("excluye hojas de usuarios, cotizaciones y columnas de precios aun dentro de fichas", () => {
    for (const entry of historical.entries) {
      expect(entry.sourceSheet).not.toMatch(/usuarios|vac|precio|cotiz/i);
      expect(
        Object.values(entry.data.fieldProvenance).some((p) =>
          /precio|costo|contrase|usuario|correo/i.test(p.label),
        ),
      ).toBe(false);
      if (entry.category === "module") {
        expect(entry.data.rawFields).not.toHaveProperty("AN");
        expect(entry.data.rawFields).not.toHaveProperty("R");
      }
      if (entry.category === "inverter")
        expect(entry.data.rawFields).not.toHaveProperty("BK");
    }
  });

  it("identifica duplicados por fila y no infiere coeficiente Vmp ni límite de Isc", () => {
    expect(
      historical.entries.some(
        (e) =>
          e.data.sameNameOccurrences > 1 &&
          e.data.reviewFlags.includes("DUPLICATE_NAME_SEPARATE_SOURCE_ROWS"),
      ),
    ).toBe(true);
    expect(
      historical.entries
        .filter((e) => e.category === "module")
        .every((e) =>
          e.data.reviewFlags.includes("VMP_TEMPERATURE_COEFFICIENT_MISSING"),
        ),
    ).toBe(true);
    expect(
      historical.entries
        .filter((e) => e.category === "inverter")
        .every((e) =>
          e.data.reviewFlags.includes("SHORT_CIRCUIT_LIMIT_NOT_IDENTIFIED"),
        ),
    ).toBe(true);
  });
});
