import { z } from "zod";
import type { EngineeringInput } from "./engineering";

export const solarResourceRequestSchema = z
  .object({
    lat: z.number().finite().min(-89.9).max(89.9),
    lon: z.number().finite().min(-180).max(180),
    tilt: z.number().finite().min(0).max(90),
    azimuth: z.number().finite().min(-180).max(180),
    year: z.number().int().min(2000).max(2099),
  })
  .strict();
export const sourceRefreshSchema = z.discriminatedUnion("provider", [
  solarResourceRequestSchema.extend({ provider: z.literal("PVGIS") }),
  z.object({ provider: z.literal("BANXICO") }).strict(),
]);
export type SolarResourceRequest = z.infer<typeof solarResourceRequestSchema>;
export type SourceRefreshInput = z.infer<typeof sourceRefreshSchema>;
export type SolarResourceDraft = {
  provider: "PVGIS";
  status: "DRAFT";
  requiresReview: true;
  sourceUrl: string;
  consultedAt: string;
  dataset: {
    name: string;
    startYear: number;
    endYear: number;
    interpretation: "CLIMATOLOGY";
    scenarioYear: number;
    latitude: number;
    longitude: number;
    tiltDeg: number;
    azimuthDeg: number;
    timeBasis: "UTC";
  };
  monthlyResource: NonNullable<
    NonNullable<EngineeringInput["solar"]>["monthlyResource"]
  >;
  warnings: string[];
};
export type ExchangeRateDraft = {
  provider: "BANXICO";
  status: "DRAFT";
  requiresReview: true;
  sourceUrl: string;
  consultedAt: string;
  seriesId: "SF43718";
  observationDate: string;
  fromCurrency: "USD";
  toCurrency: "MXN";
  rateMxnPerUsd: number;
  warnings: string[];
};
export type SourceRefreshOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  banxicoToken?: string;
};
export class SourceRefreshError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceRefreshError";
  }
}
const nonempty = z.string().min(1).max(200);
const numeric = z.number().finite();
const pvgisResponseSchema = z.object({
  inputs: z.object({
    location: z.object({ latitude: numeric, longitude: numeric }),
    meteo_data: z.object({
      radiation_db: nonempty,
      year_min: z.number().int().min(1900).max(2099),
      year_max: z.number().int().min(1900).max(2099),
    }),
    plane: z.object({
      fixed: z.object({
        slope: z.object({ value: numeric }),
        azimuth: z.object({ value: numeric }),
      }),
    }),
    time_format: z.literal("UTC"),
  }),
  outputs: z.object({
    daily_profile: z
      .array(
        z.object({
          month: z.number().int().min(1).max(12),
          time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          "G(i)": z.number().finite().min(0).max(5000),
        }),
      )
      .length(288),
  }),
  meta: z.object({
    outputs: z.object({
      daily_profile: z.object({
        timestamp: z.literal("hourly"),
        variables: z.object({ "G(i)": z.object({ units: z.literal("W/m2") }) }),
      }),
    }),
  }),
});
const banxicoResponseSchema = z.object({
  bmx: z.object({
    series: z
      .array(
        z.object({
          idSerie: z.literal("SF43718"),
          datos: z
            .array(
              z.object({
                fecha: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
                dato: z.string().regex(/^\d+(?:\.\d+)?$/),
              }),
            )
            .min(1)
            .max(1),
        }),
      )
      .length(1),
  }),
});
const MAX_BYTES = 1_000_000;
const SOURCE_TIMEOUT_MS = 20_000;

async function readProviderJson(
  url: URL,
  options: SourceRefreshOptions,
  headers: Record<string, string> = {},
): Promise<unknown> {
  if (
    url.protocol !== "https:" ||
    !["re.jrc.ec.europa.eu", "www.banxico.org.mx"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new SourceRefreshError(
      "SOURCE_HOST_INVALID",
      "La fuente no está permitida.",
    );
  const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
    });
    if (!response.ok)
      throw new SourceRefreshError(
        "SOURCE_HTTP_ERROR",
        `La fuente respondió HTTP ${response.status}. Reintentar la consulta; no se sustituyeron datos.`,
      );
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json"))
      throw new SourceRefreshError(
        "SOURCE_CONTENT_TYPE",
        "La fuente no devolvió JSON. No se incorporaron datos.",
      );
    const length = response.headers.get("content-length");
    if (length && Number(length) > MAX_BYTES) {
      await response.body?.cancel();
      throw new SourceRefreshError(
        "SOURCE_RESPONSE_TOO_LARGE",
        "La respuesta excede el límite de tamaño.",
      );
    }
    if (!response.body)
      throw new SourceRefreshError(
        "SOURCE_EMPTY_RESPONSE",
        "La fuente devolvió una respuesta vacía.",
      );
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new SourceRefreshError(
            "SOURCE_RESPONSE_TOO_LARGE",
            "La respuesta excede el límite de tamaño.",
          );
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new SourceRefreshError(
        "SOURCE_INVALID_JSON",
        "La respuesta de la fuente no contiene JSON válido.",
      );
    }
  } catch (error) {
    if (error instanceof SourceRefreshError) throw error;
    if (
      signal.aborted ||
      (error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name))
    )
      throw new SourceRefreshError(
        "SOURCE_TIMEOUT",
        "La fuente excedió el tiempo de respuesta. No se sustituyeron datos.",
      );
    throw new SourceRefreshError(
      "SOURCE_UNAVAILABLE",
      "No fue posible consultar la fuente. Reintentar o cargar una fuente revisada manualmente.",
    );
  }
}

export function normalizePvgisDailyResponse(
  payload: unknown,
  rawRequest: SolarResourceRequest,
  sourceUrl: string,
  consultedAt: string,
): SolarResourceDraft {
  const request = solarResourceRequestSchema.parse(rawRequest);
  const parsed = pvgisResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new SourceRefreshError(
      "PVGIS_DATA_INVALID",
      "PVGIS no devolvió doce perfiles de 24 horas con unidades W/m² y metadatos completos.",
    );
  const data = parsed.data,
    meteo = data.inputs.meteo_data,
    plane = data.inputs.plane.fixed;
  if (
    meteo.year_min > meteo.year_max ||
    Math.abs(data.inputs.location.latitude - request.lat) > 0.001 ||
    Math.abs(data.inputs.location.longitude - request.lon) > 0.001 ||
    Math.abs(plane.slope.value - request.tilt) > 0.001 ||
    Math.abs(plane.azimuth.value - request.azimuth) > 0.001
  )
    throw new SourceRefreshError(
      "PVGIS_REQUEST_MISMATCH",
      "Los metadatos de PVGIS no corresponden al sitio, plano o periodo solicitado.",
    );
  const datasetPeriod = `${meteo.radiation_db} ${meteo.year_min}-${meteo.year_max}; climatología, no medición del año ${request.year}`;
  const monthlyResource: SolarResourceDraft["monthlyResource"] = [];
  for (let month = 1; month <= 12; month++) {
    const hours = data.outputs.daily_profile
      .filter((p) => p.month === month)
      .sort((a, b) => a.time.localeCompare(b.time));
    const times = hours.map(
      (p) => Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3)),
    );
    if (
      hours.length !== 24 ||
      new Set(times).size !== 24 ||
      !times.every((minute, i) => i === 0 || minute - times[i - 1]! === 60)
    )
      throw new SourceRefreshError(
        "PVGIS_HOURS_INCOMPLETE",
        "Un mes contiene horas duplicadas, faltantes o intervalos diferentes de una hora; no se interpola.",
      );
    // 24 hourly mean irradiances, W/m² × one hour / 1000 = daily kWh/m².
    // Do not divide by 24 or month days, and do not multiply by days here: the engineering engine does that once.
    const dailyPlaneOfArrayKwhM2 =
      hours.reduce((sum, h) => sum + h["G(i)"], 0) / 1000;
    if (dailyPlaneOfArrayKwhM2 > 24)
      throw new SourceRefreshError(
        "PVGIS_DAILY_ENERGY_OUT_OF_RANGE",
        "La energía diaria del perfil requiere revisión de unidades.",
      );
    monthlyResource.push({
      month: `${request.year}-${String(month).padStart(2, "0")}`,
      dailyPlaneOfArrayKwhM2,
      sourceRef: sourceUrl,
      datasetPeriod,
      tiltDeg: request.tilt,
      azimuthDeg: request.azimuth,
    });
  }
  return {
    provider: "PVGIS",
    status: "DRAFT",
    requiresReview: true,
    sourceUrl,
    consultedAt,
    dataset: {
      name: meteo.radiation_db,
      startYear: meteo.year_min,
      endYear: meteo.year_max,
      interpretation: "CLIMATOLOGY",
      scenarioYear: request.year,
      latitude: request.lat,
      longitude: request.lon,
      tiltDeg: request.tilt,
      azimuthDeg: request.azimuth,
      timeBasis: "UTC",
    },
    monthlyResource,
    warnings: [
      "Datos climatológicos del periodo del proveedor. El año solicitado sólo identifica el calendario del escenario; no indica observaciones de ese año.",
      "Azimut PVGIS: 0° sur, 90° oeste y -90° este. Verificar el plano y los obstáculos locales antes de aprobar.",
      "La integración suma 24 irradiancias horarias medias; no contiene pérdidas de instalación ni temperatura de diseño de celda.",
      "El recurso se incorpora como borrador y no actualiza revisiones o propuestas emitidas.",
    ],
  };
}

export async function fetchSolarResource(
  rawRequest: SolarResourceRequest,
  options: SourceRefreshOptions = {},
): Promise<SolarResourceDraft> {
  const request = solarResourceRequestSchema.parse(rawRequest);
  // MRcalc does not expose azimuth. DRcalc supports the actual plane and all 12 months in one request.
  const url = new URL("https://re.jrc.ec.europa.eu/api/v5_3/DRcalc");
  for (const [key, value] of Object.entries({
    lat: request.lat,
    lon: request.lon,
    angle: request.tilt,
    aspect: request.azimuth,
    month: 0,
    global: 1,
    usehorizon: 1,
    localtime: 0,
    outputformat: "json",
  }))
    url.searchParams.set(key, String(value));
  const payload = await readProviderJson(url, options);
  return normalizePvgisDailyResponse(
    payload,
    request,
    url.toString(),
    (options.now?.() ?? new Date()).toISOString(),
  );
}

export async function fetchExchangeRate(
  options: SourceRefreshOptions = {},
): Promise<ExchangeRateDraft> {
  const token = options.banxicoToken ?? process.env.ENNCO_BANXICO_TOKEN;
  if (!token || !/^[A-Za-z0-9]{64}$/.test(token))
    throw new SourceRefreshError(
      "BANXICO_NOT_CONFIGURED",
      "Falta configurar el token de consulta Banxico en el servidor; no se usará un tipo de cambio predeterminado.",
    );
  const url = new URL(
    "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno",
  );
  const payload = await readProviderJson(url, options, { "Bmx-Token": token });
  const parsed = banxicoResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new SourceRefreshError(
      "BANXICO_DATA_INVALID",
      "Banxico no devolvió una observación numérica FIX de la serie esperada.",
    );
  const point = parsed.data.bmx.series[0]!.datos[0]!,
    rate = Number(point.dato);
  const observationDate = `${point.fecha.slice(6)}-${point.fecha.slice(3, 5)}-${point.fecha.slice(0, 2)}`;
  const date = new Date(`${observationDate}T00:00:00Z`),
    now = options.now?.() ?? new Date();
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== observationDate ||
    date > now ||
    !Number.isFinite(rate) ||
    rate <= 0
  )
    throw new SourceRefreshError(
      "BANXICO_DATA_INVALID",
      "La fecha o el tipo de cambio recibido no son válidos.",
    );
  const warnings = [
    "FIX es una referencia de Banxico; Administración debe confirmar el tipo comercial de la propuesta y conservar su versión.",
  ];
  if (now.getTime() - date.getTime() > 7 * 86400000)
    warnings.push(
      "La última observación publicada tiene más de siete días; revisar vigencia antes de usarla.",
    );
  return {
    provider: "BANXICO",
    status: "DRAFT",
    requiresReview: true,
    seriesId: "SF43718",
    sourceUrl: url.toString(),
    consultedAt: now.toISOString(),
    observationDate,
    fromCurrency: "USD",
    toCurrency: "MXN",
    rateMxnPerUsd: rate,
    warnings,
  };
}

export async function refreshSource(
  rawInput: SourceRefreshInput,
  options: SourceRefreshOptions = {},
): Promise<SolarResourceDraft | ExchangeRateDraft> {
  const input = sourceRefreshSchema.parse(rawInput);
  if (input.provider === "BANXICO") return fetchExchangeRate(options);
  const { provider: _provider, ...solar } = input;
  void _provider;
  return fetchSolarResource(solar, options);
}
