import { z } from "zod";

/**
 * Pestaña Medidores (16-oct-2026, Grant, con las juntas #9 y #11 de Paco y Tere): la energía de los
 * clientes de ENNCO por planta y por punto de medición. Un medidor es un analizador de red (Circutor,
 * por archivo o por API) o un inversor (Growatt). La base (migración 113) guarda y calcula; aquí viven
 * los esquemas, los umbrales de las alertas y los textos.
 */

/** Columnas de una lectura. Mismo orden que tools/medidores/gen-113.py (una prueba las compara). */
export const READING_FIELDS = [
  "v_ln", "v_l1", "v_l2", "v_l3", "v_ln_min", "v_ln_max", "v_ll", "v_ll_min", "v_ll_max",
  "i_avg", "i_l1", "i_l2", "i_l3", "i_max", "freq", "freq_min", "freq_max",
  "p_import_kw", "p_import_l1", "p_import_l2", "p_import_l3", "p_import_max_kw",
  "p_export_kw", "p_export_l1", "p_export_l2", "p_export_l3", "p_export_max_kw",
  "s_kva", "s_kva_max", "pf", "pf_l1", "pf_l2", "pf_l3",
  "thd_v_l1", "thd_v_l2", "thd_v_l3", "thd_v_max", "thd_i_l1", "thd_i_l2", "thd_i_l3", "thd_i_max",
  "pv_kw", "pv_kwh_today",
] as const;
export type ReadingField = typeof READING_FIELDS[number];

export type Harmonics = { v?: Record<string, Array<number | null>>; i?: Record<string, Array<number | null>> };
export type Reading = { ts: string; inverter_status?: string | null; harmonics?: Harmonics | null; extra?: Record<string, unknown> | null }
  & Partial<Record<ReadingField, number | null>>;

const finite = z.number().finite().nullable().optional();
const harmonicOrder = z.record(z.string().regex(/^\d{1,2}$/), z.array(z.number().finite().nullable()).max(3));
export const harmonicsSchema = z.object({ v: harmonicOrder.optional(), i: harmonicOrder.optional() }).strict();

/** Lectura que llega por la API: hora ISO con zona (Z o ±hh:mm) y solo columnas conocidas. */
export const apiReadingSchema = z.object({
  ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/),
  inverter_status: z.string().max(40).nullable().optional(),
  harmonics: harmonicsSchema.nullable().optional(),
  extra: z.record(z.string(), z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])).nullable().optional(),
  ...Object.fromEntries(READING_FIELDS.map((f) => [f, finite])) as Record<ReadingField, typeof finite>,
}).strict();
export const apiIngestSchema = z.union([
  z.object({ readings: z.array(apiReadingSchema).min(1).max(2000) }).strict(),
  apiReadingSchema.transform((reading) => ({ readings: [reading] })),
]);

export const METER_KINDS = ["ANALIZADOR", "INVERSOR"] as const;
export const METER_SCOPES = ["GENERAL", "AREA", "MAQUINA"] as const;
export const METER_SOURCES = ["ARCHIVO", "API", "GROWATT"] as const;
export type MeterKind = typeof METER_KINDS[number];
export type MeterScope = typeof METER_SCOPES[number];
export type MeterSource = typeof METER_SOURCES[number];
export const KIND_LABELS: Record<MeterKind, string> = { ANALIZADOR: "Analizador de red", INVERSOR: "Inversor solar" };
export const SCOPE_LABELS: Record<MeterScope, string> = { GENERAL: "Tablero general", AREA: "Área o línea", MAQUINA: "Máquina o equipo" };
export const SOURCE_LABELS: Record<MeterSource, string> = { ARCHIVO: "Archivo", API: "En vivo (API)", GROWATT: "Growatt" };

export const SEVERITIES = ["INFO", "ATENCION", "URGENTE"] as const;
export type Severity = typeof SEVERITIES[number];
export const SEVERITY_LABELS: Record<Severity, string> = { INFO: "Informativa", ATENCION: "Atención", URGENTE: "Urgente" };
export const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, ATENCION: 1, URGENTE: 2 };

export const RULES = [
  "FP_BAJO", "TENSION_FUERA", "HUECO_TENSION", "CORTE", "DESBALANCE", "THD_TENSION", "THD_CORRIENTE",
  "FRECUENCIA", "DEMANDA", "EXPORTACION_NOCHE", "DIA_EXPORTADOR", "PARO", "CONSUMO_ATIPICO",
  "INVERSOR_FALLA", "GENERACION_BAJA", "SIN_DATOS",
] as const;
export type Rule = typeof RULES[number];
export const RULE_LABELS: Record<Rule, string> = {
  FP_BAJO: "Factor de potencia bajo",
  TENSION_FUERA: "Tensión fuera de rango",
  HUECO_TENSION: "Hueco de tensión",
  CORTE: "Corte de energía",
  DESBALANCE: "Desbalance de corriente",
  THD_TENSION: "Distorsión de tensión",
  THD_CORRIENTE: "Distorsión de corriente",
  FRECUENCIA: "Frecuencia fuera de rango",
  DEMANDA: "Demanda arriba de lo contratado",
  EXPORTACION_NOCHE: "Exportación de noche",
  DIA_EXPORTADOR: "Día que envió más de lo que tomó",
  PARO: "Posible paro",
  CONSUMO_ATIPICO: "Consumo fuera de su patrón",
  INVERSOR_FALLA: "Inversor en falla",
  GENERACION_BAJA: "Generación baja",
  SIN_DATOS: "El medidor dejó de reportar",
};

/**
 * Umbrales por medidor. Los valores por defecto salen de lo que dijeron Paco y Tere y de la norma:
 * el Código de Red pide FP de 0.95 y CFE cobra recargo debajo de 0.90; IEEE 519 pone 8 % de THD de
 * tensión en baja tensión. El desbalance arranca alto (20 %) porque con poca carga siempre lo hay;
 * Tere los calibra por medidor.
 */
export const thresholdsSchema = z.object({
  pf_atencion: z.number().min(0.5).max(1),
  pf_urgente: z.number().min(0.5).max(1),
  tension_atencion_pct: z.number().min(1).max(30),
  tension_urgente_pct: z.number().min(1).max(40),
  hueco_pct: z.number().min(5).max(90),
  desbalance_atencion_pct: z.number().min(2).max(100),
  desbalance_urgente_pct: z.number().min(2).max(100),
  thd_v_atencion: z.number().min(1).max(40),
  thd_v_urgente: z.number().min(1).max(40),
  thd_i_atencion: z.number().min(2).max(200),
  frecuencia_tolerancia_hz: z.number().min(0.05).max(5),
  paro_pct: z.number().min(1).max(90),
  paro_min_minutos: z.number().min(10).max(600),
  atipico_factor: z.number().min(1.1).max(10),
  atipico_min_kwh: z.number().min(0).max(100000),
  exportacion_noche_kw: z.number().min(0.1).max(10000),
  generacion_baja_pct: z.number().min(5).max(95),
  minutos_sostenido: z.number().min(0).max(600),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;
export const DEFAULT_THRESHOLDS: Thresholds = {
  pf_atencion: 0.95, pf_urgente: 0.9,
  tension_atencion_pct: 5, tension_urgente_pct: 10, hueco_pct: 15,
  desbalance_atencion_pct: 20, desbalance_urgente_pct: 35,
  thd_v_atencion: 5, thd_v_urgente: 8, thd_i_atencion: 20,
  frecuencia_tolerancia_hz: 0.2,
  paro_pct: 20, paro_min_minutos: 30,
  atipico_factor: 1.5, atipico_min_kwh: 5,
  exportacion_noche_kw: 1,
  generacion_baja_pct: 60,
  minutos_sostenido: 20,
};
export const THRESHOLD_FIELDS: Array<{ key: keyof Thresholds; label: string; unit: string; hint: string; step: number }> = [
  { key: "pf_atencion", label: "FP mínimo (aviso)", unit: "", hint: "Código de Red: 0.95", step: 0.01 },
  { key: "pf_urgente", label: "FP con recargo de CFE", unit: "", hint: "Debajo de 0.90 sube a atención", step: 0.01 },
  { key: "tension_atencion_pct", label: "Tensión, atención", unit: "% de la nominal", hint: "Desviación sostenida", step: 0.5 },
  { key: "tension_urgente_pct", label: "Tensión, urgente", unit: "% de la nominal", hint: "Desviación sostenida", step: 0.5 },
  { key: "hueco_pct", label: "Hueco de tensión", unit: "% abajo de la nominal", hint: "Una lectura basta", step: 1 },
  { key: "desbalance_atencion_pct", label: "Desbalance, atención", unit: "%", hint: "Con carga; sostenido", step: 1 },
  { key: "desbalance_urgente_pct", label: "Desbalance, urgente", unit: "%", hint: "Con carga; sostenido", step: 1 },
  { key: "thd_v_atencion", label: "THD de tensión, atención", unit: "%", hint: "Recomendado: 5 %", step: 0.5 },
  { key: "thd_v_urgente", label: "THD de tensión, urgente", unit: "%", hint: "IEEE 519 en baja tensión: 8 %", step: 0.5 },
  { key: "thd_i_atencion", label: "THD de corriente, atención", unit: "%", hint: "Solo con carga arriba de la mitad", step: 1 },
  { key: "frecuencia_tolerancia_hz", label: "Frecuencia, tolerancia", unit: "Hz alrededor de 60", hint: "Promedio sostenido", step: 0.05 },
  { key: "paro_pct", label: "Paro: consumo menor a", unit: "% de lo normal", hint: "En horario de trabajo", step: 1 },
  { key: "paro_min_minutos", label: "Paro: duración mínima", unit: "min", hint: "", step: 5 },
  { key: "atipico_factor", label: "Consumo atípico: veces lo normal", unit: "×", hint: "Contra la misma hora de días parecidos", step: 0.1 },
  { key: "atipico_min_kwh", label: "Consumo atípico: diferencia mínima", unit: "kWh en la hora", hint: "Evita alertas en cargas chicas", step: 1 },
  { key: "exportacion_noche_kw", label: "Exportación de noche", unit: "kW por fase", hint: "De 20:00 a 6:00", step: 0.5 },
  { key: "generacion_baja_pct", label: "Generación baja", unit: "% de su mediana", hint: "Inversores, por día", step: 5 },
  { key: "minutos_sostenido", label: "Tiempo sostenido", unit: "min", hint: "Antes de avisar", step: 5 },
];
export function resolveThresholds(overrides: unknown): Thresholds {
  const partial = thresholdsSchema.partial().safeParse(overrides ?? {});
  return { ...DEFAULT_THRESHOLDS, ...(partial.success ? partial.data : {}) };
}

const isoish = z.string().min(10);
const num = z.number().nullable();

export const meterSchema = z.object({
  id: z.uuid(), site_id: z.uuid(), name: z.string(), kind: z.enum(METER_KINDS), scope: z.enum(METER_SCOPES),
  source: z.enum(METER_SOURCES), device_brand: z.string().nullable(), device_model: z.string().nullable(),
  device_serial: z.string().nullable(), nominal_v_ln: z.coerce.number(), interval_minutes: z.coerce.number().nullable(),
  thresholds: z.record(z.string(), z.unknown()), has_key: z.boolean(), key_hint: z.string().nullable(),
  key_created_at: isoish.nullable(), integration_id: z.uuid().nullable(), external_id: z.string().nullable(), active: z.boolean(),
  first_reading_at: isoish.nullable(), last_reading_at: isoish.nullable(), readings_count: z.coerce.number(),
  evaluated_at: isoish.nullable(), revision: z.number(),
  open_alerts: z.object({ URGENTE: z.number(), ATENCION: z.number(), INFO: z.number() }),
});
export type Meter = z.infer<typeof meterSchema>;

export const siteCoreSchema = z.object({
  id: z.uuid(), client_name: z.string(), site_name: z.string(), city: z.string().nullable(), state: z.string().nullable(),
  timezone: z.string(), price_mxn_kwh: z.coerce.number(), contracted_demand_kw: z.coerce.number().nullable(),
  paro_cost_mxn_h: z.coerce.number().nullable(), work_days: z.array(z.number()), work_start: z.string(), work_end: z.string(),
  crm_record_id: z.uuid().nullable(), notes: z.string().nullable(), revision: z.number(),
});
export type SiteCore = z.infer<typeof siteCoreSchema>;

export const integrationSchema = z.object({
  id: z.uuid(), provider: z.literal("GROWATT"), api_base: z.string(), plant_id: z.string(), plant_name: z.string().nullable(),
  status: z.enum(["ACTIVA", "PAUSADA", "ERROR"]), token_hint: z.string().nullable(), last_sync_at: isoish.nullable(),
  last_error: z.string().nullable(), last_error_at: isoish.nullable(),
});
export type Integration = z.infer<typeof integrationSchema>;

export const siteSchema = siteCoreSchema.extend({ meters: z.array(meterSchema), integrations: z.array(integrationSchema) });
export type Site = z.infer<typeof siteSchema>;

export const overviewSchema = z.object({
  settings: z.object({ telegram_enabled: z.boolean(), telegram_chats: z.number(), telegram_min_severity: z.enum(["ATENCION", "URGENTE"]) }),
  sites: z.array(siteSchema),
  storage: z.object({ rows: z.coerce.number(), bytes: z.coerce.number(), all_rows: z.coerce.number() }),
  generated_at: isoish,
});
export type Overview = z.infer<typeof overviewSchema>;

export const alertSchema = z.object({
  id: z.uuid(), rule: z.enum(RULES), severity: z.enum(SEVERITIES), started_at: isoish, ended_at: isoish.nullable(),
  value: num, threshold: num, unit: z.string().nullable(), message: z.string(), detail: z.record(z.string(), z.unknown()),
  status: z.enum(["ABIERTA", "RECONOCIDA", "CERRADA"]), acknowledged_at: isoish.nullable(), note: z.string().nullable(),
  telegram_sent_at: isoish.nullable(),
});
export type EnergyAlert = z.infer<typeof alertSchema>;

export const kpisSchema = z.object({
  readings: z.number(), first_ts: isoish.nullable(), last_ts: isoish.nullable(), expected: z.coerce.number(),
  import_kwh: num, export_kwh: num, pv_kwh: num, cost_mxn: num, peak_kw: num, peak_avg_kw: num, peak_at: isoish.nullable(),
  peak_export_kw: num, peak_export_at: isoish.nullable(), peak_pv_kw: num, pf_avg: num, pf_below_share: num,
  v_min: num, v_max: num, v_avg: num, v_min_at: isoish.nullable(), unbalance_avg: num, unbalance_p95: num,
  thd_v_p95: num, thd_i_p95: num, dubious: z.number(), freq_out: z.number(), freq_avg: num,
});
export type Kpis = z.infer<typeof kpisSchema>;

export const seriesPointSchema = z.object({
  t: isoish, imp: num, imp_max: num, exp: num, exp_max: num, pv: num, v1: num, v2: num, v3: num, vmin: num, vmax: num,
  i1: num, i2: num, i3: num, pf: num, thdv: num, thdi: num, unb: num,
});
export type SeriesPoint = z.infer<typeof seriesPointSchema>;
export const dailySchema = z.object({ d: z.string(), imp: num, exp: num, pv: num, peak: num, pf: num, n: z.number() });
export type DailyPoint = z.infer<typeof dailySchema>;
export const heatSchema = z.object({ d: z.string(), h: z.number(), imp: num, exp: num, pv: num });
export type HeatCell = z.infer<typeof heatSchema>;
export const harmonicSchema = z.object({ order: z.number(), l1: num, l2: num, l3: num });
export type HarmonicBar = z.infer<typeof harmonicSchema>;

export const meterViewSchema = z.object({
  meter: meterSchema, site: siteCoreSchema,
  range: z.object({ since: isoish, until: isoish, step_minutes: z.coerce.number() }),
  kpis: kpisSchema.nullable(),
  series: z.array(seriesPointSchema), daily: z.array(dailySchema), heatmap: z.array(heatSchema),
  harmonics: z.object({ v: z.array(harmonicSchema), i: z.array(harmonicSchema) }),
  alerts: z.array(alertSchema),
});
export type MeterView = z.infer<typeof meterViewSchema>;

const uuidOrEmpty = z.union([z.uuid(), z.literal("")]).optional();
export const energyCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("SITIO_GUARDAR"), payload: z.object({
    site_id: uuidOrEmpty, client_name: z.string().trim().min(2).max(200), site_name: z.string().trim().max(200).optional(),
    city: z.string().max(120).optional(), state: z.string().max(120).optional(), timezone: z.string().max(64).optional(),
    price_mxn_kwh: z.number().min(0).max(50).optional(), contracted_demand_kw: z.number().positive().nullable().optional(),
    paro_cost_mxn_h: z.number().min(0).nullable().optional(), work_days: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    work_start: z.string().regex(/^\d{2}:\d{2}$/).optional(), work_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    notes: z.string().max(2000).optional(),
  }).strict() }),
  z.object({ op: z.literal("MEDIDOR_GUARDAR"), payload: z.object({
    meter_id: uuidOrEmpty, site_id: z.uuid().optional(), name: z.string().trim().min(1).max(200),
    kind: z.enum(METER_KINDS).optional(), scope: z.enum(METER_SCOPES).optional(), source: z.enum(["ARCHIVO", "API"]).optional(),
    device_brand: z.string().max(120).optional(), device_model: z.string().max(120).optional(), device_serial: z.string().max(120).optional(),
    nominal_v_ln: z.number().min(50).max(1000).optional(), interval_minutes: z.number().positive().max(1440).nullable().optional(),
    thresholds: thresholdsSchema.partial().optional(), active: z.boolean().optional(),
  }).strict() }),
  z.object({ op: z.literal("MEDIDOR_LLAVE_QUITAR"), payload: z.object({ meter_id: z.uuid() }).strict() }),
  z.object({ op: z.literal("LECTURAS_IMPORTAR"), payload: z.object({
    meter_id: z.uuid(), local: z.literal(true), interval_minutes: z.number().positive().max(1440).optional(),
    rows: z.array(z.object({
      ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
      harmonics: harmonicsSchema.nullable().optional(),
      ...Object.fromEntries(READING_FIELDS.map((f) => [f, finite])) as Record<ReadingField, typeof finite>,
    }).strict()).min(1).max(2000),
  }).strict() }),
  z.object({ op: z.literal("LECTURAS_BORRAR"), payload: z.object({ meter_id: z.uuid(), since: z.string().optional(), until: z.string().optional() }).strict() }),
  z.object({ op: z.literal("ALERTA_ESTADO"), payload: z.object({
    alert_id: z.uuid(), status: z.enum(["ABIERTA", "RECONOCIDA", "CERRADA"]), note: z.string().max(1000).optional(),
  }).strict() }),
  z.object({ op: z.literal("GROWATT_PAUSAR"), payload: z.object({ integration_id: z.uuid(), active: z.boolean() }).strict() }),
]);
export type EnergyCommand = z.infer<typeof energyCommandSchema>;
export const energyCommandResultSchema = z.object({ ok: z.boolean(), message: z.string() }).passthrough();

export const ENERGY_ERROR_MESSAGES: Record<string, string> = {
  ENERGY_CLIENT_REQUIRED: "Escribe el nombre del cliente.",
  ENERGY_TIMEZONE_INVALID: "Esa zona horaria no existe.",
  ENERGY_SITE_NOT_FOUND: "No encontré esa planta. Recarga la página.",
  ENERGY_METER_NOT_FOUND: "No encontré ese medidor. Recarga la página.",
  ENERGY_METER_NAME_REQUIRED: "Escribe el nombre del medidor.",
  ENERGY_METER_INACTIVE: "Ese medidor está apagado. Actívalo en sus ajustes.",
  ENERGY_ROWS_TOO_MANY: "Demasiadas lecturas en una sola tanda.",
  ENERGY_IMPORT_ONLY_ANALYZER: "Los archivos se cargan en medidores de tipo analizador.",
  ENERGY_ALERT_NOT_FOUND: "Esa alerta ya no existe. Recarga la página.",
  ENERGY_GROWATT_INCOMPLETE: "Falta elegir la planta de Growatt.",
  ENERGY_INTEGRATION_NOT_FOUND: "No encontré esa conexión de Growatt.",
  OPERATIONS_OPERATOR_ROLE_REQUIRED: "Tu usuario no puede hacer cambios aquí.",
  GROWATT_TOKEN_INVALID: "Growatt no aceptó el token, ni en el servidor internacional ni en el de Norteamérica.",
  GROWATT_RATE_LIMITED: "Growatt pide esperar unos minutos entre consultas. Intenta en 5 minutos.",
  GROWATT_UNAVAILABLE: "No hubo respuesta de Growatt. Intenta más tarde.",
  GROWATT_NO_PLANTS: "El token es válido, pero no tiene plantas. Pide a Growatt que habilite la cuenta.",
  ENERGY_VAULT_UNAVAILABLE: "Falta la llave para cifrar el token en el servidor. Avísale a Teckel.",
  ENERGY_SERVICE_UNAVAILABLE: "El servicio de medidores no está configurado en el servidor. Avísale a Teckel.",
  SYNTHETIC_MUTATION_DISABLED: "Este es un ejemplo: no guarda cambios.",
};
export function energyErrorMessage(code: string | undefined): string {
  return (code && ENERGY_ERROR_MESSAGES[code]) ?? "No se pudo guardar. Intenta de nuevo.";
}

const DAY_NAMES = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export function workDaysLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === "1,2,3,4,5") return "Lunes a viernes";
  if (sorted.join() === "1,2,3,4,5,6") return "Lunes a sábado";
  if (sorted.join() === "1,2,3,4,5,6,7") return "Toda la semana";
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

const nf = (digits: number) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export function fmt(value: number | null | undefined, digits = 0): string {
  return value == null || !Number.isFinite(value) ? "Sin dato" : nf(digits).format(value);
}
export function fmtMxn(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "Sin dato" : `$${nf(0).format(value)}`;
}
export function fmtPct(value: number | null | undefined, digits = 0): string {
  return value == null || !Number.isFinite(value) ? "Sin dato" : `${nf(digits).format(value)} %`;
}
export function fmtWhen(iso: string | null | undefined, timeZone = "America/Mexico_City", withYear = false): string {
  if (!iso) return "Sin dato";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sin dato";
  return new Intl.DateTimeFormat("es-MX", { timeZone, weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
export function fmtDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date);
}
export function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 0)} KB`;
  if (bytes < 1024 ** 3) return `${fmt(bytes / 1024 ** 2, 1)} MB`;
  return `${fmt(bytes / 1024 ** 3, 2)} GB`;
}
