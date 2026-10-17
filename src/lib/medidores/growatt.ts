import { localParts } from "@/lib/medidores/alerts";
import type { Reading } from "@/lib/medidores/model";

/**
 * Conector con la API oficial de Growatt (v1, "ShineServer"; investigación del 16-oct en la carpeta
 * de la pestaña). Lo que importa de esa API:
 * - El token va en el encabezado `token` y no vence. Lo saca el dueño en ShinePhone (Yo → API Token)
 *   o el instalador desde OSS.
 * - Los errores llegan con HTTP 200 dentro de `error_code`: 10011 = sin permiso (token malo o servidor
 *   equivocado), 10012 = demasiado seguido (cada consulta solo se puede repetir cada 5 min; la lista de
 *   plantas, 10 veces al día), -1 = dominio viejo.
 * - Los números llegan muchas veces como texto y la hora de la planta sin zona.
 * - Para México no está documentado el servidor: se prueba el internacional y luego el de Norteamérica.
 * Se espera 1 s entre llamadas, como recomiendan los clientes de código abierto (con menos hay 429).
 */
export const GROWATT_HOSTS = {
  global: "https://openapi.growatt.com",
  us: "https://openapi-us.growatt.com",
  cn: "https://openapi-cn.growatt.com",
  au: "https://openapi-au.growatt.com",
} as const;
export type GrowattRegion = keyof typeof GROWATT_HOSTS | "auto";

export class GrowattError extends Error {
  readonly code: "GROWATT_TOKEN_INVALID" | "GROWATT_RATE_LIMITED" | "GROWATT_UNAVAILABLE" | "GROWATT_NO_PLANTS" | "GROWATT_ERROR";
  constructor(code: GrowattError["code"], detail = "") { super(`${code}${detail ? `:${detail}` : ""}`); this.code = code; this.name = "GrowattError"; }
}

export type GrowattDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isGrowattHost(base: string): boolean {
  return (Object.values(GROWATT_HOSTS) as string[]).includes(base.replace(/\/$/, ""));
}

async function call(base: string, token: string, path: string, params: Record<string, string>, method: "GET" | "POST", deps: GrowattDeps): Promise<unknown> {
  if (!isGrowattHost(base)) throw new GrowattError("GROWATT_ERROR", "HOST");
  const query = new URLSearchParams(params);
  const url = method === "GET" ? `${base}${path}?${query}` : `${base}${path}`;
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method, headers: { token, accept: "application/json", ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: method === "POST" ? query.toString() : undefined, signal: AbortSignal.timeout(15000), cache: "no-store",
    });
  } catch {
    throw new GrowattError("GROWATT_UNAVAILABLE");
  }
  if (response.status === 429) throw new GrowattError("GROWATT_RATE_LIMITED");
  if (!response.ok) throw new GrowattError("GROWATT_UNAVAILABLE", String(response.status));
  let body: { error_code?: number | string; error_msg?: string; data?: unknown };
  try { body = JSON.parse(await response.text()) as typeof body; } catch { throw new GrowattError("GROWATT_ERROR", "JSON"); }
  const code = Number(body.error_code ?? 0);
  if (code === 0) return body.data;
  if (code === 10011) throw new GrowattError("GROWATT_TOKEN_INVALID");
  if (code === 10012) throw new GrowattError("GROWATT_RATE_LIMITED");
  if (code === -1) throw new GrowattError("GROWATT_UNAVAILABLE", "DOMAIN");
  throw new GrowattError("GROWATT_ERROR", String(code));
}

export const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const toText = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);

/** Hora local sin zona ("2026-10-16 12:30[:ss]") a ISO, con la zona de la planta. */
export function plantLocalToIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local.trim());
  if (!m) return null;
  const naive = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`);
  const offset = (t: number) => { const l = localParts(new Date(t).toISOString(), timeZone); return Date.parse(`${l.date}T${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}:00Z`) - Math.floor(t / 60000) * 60000; };
  const first = naive - offset(naive);
  return new Date(naive - offset(first)).toISOString();
}

export type GrowattPlant = { id: string; name: string; city: string | null; country: string | null; peak_kw: number | null; status: number | null };

/** Prueba el token y regresa las plantas que ve. Con región "auto" intenta el servidor internacional y luego el de Norteamérica. */
export async function growattPlants(token: string, region: GrowattRegion, deps: GrowattDeps = {}): Promise<{ base: string; plants: GrowattPlant[] }> {
  const bases = region === "auto" ? [GROWATT_HOSTS.global, GROWATT_HOSTS.us] : [GROWATT_HOSTS[region]];
  let lastError: GrowattError = new GrowattError("GROWATT_TOKEN_INVALID");
  for (const base of bases) {
    try {
      const data = await call(base, token.trim(), "/v1/plant/list", { page: "1", perpage: "100" }, "GET", deps) as { plants?: Array<Record<string, unknown>> } | null;
      const plants = (data?.plants ?? []).map((p) => ({
        id: String(p.plant_id ?? ""), name: toText(p.name) ?? `Planta ${String(p.plant_id ?? "")}`,
        city: toText(p.city), country: toText(p.country), peak_kw: toNumber(p.peak_power), status: toNumber(p.status),
      })).filter((p) => p.id);
      if (!plants.length) throw new GrowattError("GROWATT_NO_PLANTS");
      return { base, plants };
    } catch (error) {
      if (!(error instanceof GrowattError)) throw error;
      lastError = error;
      if (error.code !== "GROWATT_TOKEN_INVALID") throw error; // otro servidor no arregla un límite o una caída
    }
  }
  throw lastError;
}

export type GrowattDevice = { sn: string; type: number; model: string | null; status: number | null; lost: boolean; name: string };
/** Tipos de equipo con lecturas propias: 1 inversor, 4 MAX (comercial e industrial), 7 MIN/TLX. */
const SUPPORTED_TYPES = new Set([1, 4, 7]);

export async function growattDevices(base: string, token: string, plantId: string, deps: GrowattDeps = {}): Promise<GrowattDevice[]> {
  const data = await call(base, token, "/v1/device/list", { plant_id: plantId, page: "1", perpage: "100" }, "GET", deps) as { devices?: Array<Record<string, unknown>> } | null;
  const seen = new Map<string, GrowattDevice>();
  for (const d of data?.devices ?? []) {
    const sn = toText(d.device_sn);
    const type = toNumber(d.type) ?? 0;
    if (!sn || !SUPPORTED_TYPES.has(type) || /^(ammeter|meter)$/i.test(sn)) continue;
    // El mismo número de serie puede aparecer como tipo 1 y tipo 4: gana MAX, que trae la energía del día.
    const prev = seen.get(sn);
    if (prev && prev.type === 4) continue;
    seen.set(sn, { sn, type, model: toText(d.model), status: toNumber(d.status), lost: d.lost === true || d.lost === 1 || d.lost === "1", name: toText(d.model) ? `${toText(d.model)} ${sn}` : sn });
  }
  return [...seen.values()];
}

export function inverterStatus(type: number, status: number | null, lost: boolean): string {
  if (lost) return "SIN_CONEXION";
  if (status === 3) return "FALLA";
  if (status === 1) return "NORMAL";
  if (status === 0) return type === 4 ? "ESPERA" : "DESCONECTADO";
  if (status === 2) return "ESPERA";
  return "SIN_CONEXION";
}

/** Lectura de un inversor a partir de su "last data" (MAX usa eacToday; el inversor común, powerToday). */
export function deviceReading(device: GrowattDevice, data: Record<string, unknown>, timeZone: string): Reading | null {
  const calendar = (data.calendar ?? data.timeCalendar) as { timeInMillis?: unknown } | number | undefined;
  const epoch = typeof calendar === "number" ? calendar : toNumber(calendar?.timeInMillis);
  const ts = epoch ? new Date(epoch).toISOString() : toText(data.time) ? plantLocalToIso(String(data.time), timeZone) : null;
  if (!ts) return null;
  const pac = toNumber(data.pac);
  const status = toNumber(data.status) ?? device.status;
  const v = (a: string, b: string) => toNumber(data[a]) ?? toNumber(data[b]);
  return {
    ts,
    pv_kw: pac === null ? null : pac / 1000,
    pv_kwh_today: toNumber(data.eacToday) ?? toNumber(data.powerToday),
    v_l1: v("vacr", "vac1"), v_l2: v("vacs", "vac2"), v_l3: v("vact", "vac3"),
    i_l1: v("iacr", "iac1"), i_l2: v("iacs", "iac2"), i_l3: v("iact", "iac3"),
    freq: toNumber(data.fac), pf: toNumber(data.pf),
    inverter_status: inverterStatus(device.type, status, false),
    extra: {
      temperatura: toNumber(data.temperature) ?? toNumber(data.temp1),
      ppv_kw: toNumber(data.ppv) === null ? null : (toNumber(data.ppv) as number) / 1000,
      total_kwh: toNumber(data.eacTotal) ?? toNumber(data.powerTotal),
      falla: toNumber(data.faultType) ?? toNumber(data.faultCode1),
      aviso: toNumber(data.warnCode),
      estado_growatt: toText(data.statusText),
    },
  };
}

const LAST_DATA: Record<number, { path: string; param: string; method: "GET" | "POST" }> = {
  1: { path: "/v1/device/inverter/last_new_data", param: "device_sn", method: "GET" },
  4: { path: "/v1/device/max/max_last_data", param: "max_sn", method: "POST" },
  7: { path: "/v1/device/tlx/tlx_last_data", param: "tlx_sn", method: "POST" },
};

export type SyncBatch = { external_id: string; name?: string; model?: string | null; rows: Reading[] };

/**
 * Una vuelta de sincronización de una planta (cada 15 min): potencia y energía del día de la planta,
 * la curva de 5 min de hoy y la última lectura de cada inversor (máximo 20).
 */
export async function syncGrowattPlant(input: { base: string; token: string; plantId: string; timeZone: string; now?: Date }, deps: GrowattDeps = {}): Promise<SyncBatch[]> {
  const sleep = deps.sleep ?? defaultSleep;
  const { base, token, plantId, timeZone } = input;
  const batches: SyncBatch[] = [];
  const plant = await call(base, token, "/v1/plant/data", { plant_id: plantId }, "GET", deps) as Record<string, unknown> | null;
  const currentKw = toNumber(plant?.current_power);
  const todayKwh = toNumber(plant?.today_energy);
  const plantRows: Reading[] = [];
  const updated = toText(plant?.last_update_time);
  const updatedIso = updated ? plantLocalToIso(updated, timeZone) : null;
  await sleep(1000);
  const today = localParts((input.now ?? new Date()).toISOString(), timeZone).date;
  try {
    const curve = await call(base, token, "/v1/plant/power", { plant_id: plantId, date: today }, "GET", deps) as { powers?: Array<{ time?: string; power?: unknown }> } | null;
    const points = (curve?.powers ?? []).map((p) => ({ ts: p.time ? plantLocalToIso(p.time, timeZone) : null, power: toNumber(p.power) }))
      .filter((p): p is { ts: string; power: number } => Boolean(p.ts) && p.power !== null);
    // La documentación dice W; hay quien reporta kW. Si la curva es ~1000 veces la potencia actual, son W.
    const maxPower = Math.max(0, ...points.map((p) => p.power));
    const inWatts = currentKw !== null && currentKw > 0 ? maxPower > currentKw * 50 : maxPower > 5000;
    for (const p of points) plantRows.push({ ts: p.ts, pv_kw: inWatts ? p.power / 1000 : p.power });
  } catch (error) {
    if (!(error instanceof GrowattError) || error.code === "GROWATT_TOKEN_INVALID") throw error;
  }
  if (updatedIso) plantRows.push({ ts: updatedIso, pv_kw: currentKw, pv_kwh_today: todayKwh });
  if (plantRows.length) batches.push({ external_id: "PLANT", rows: plantRows });

  await sleep(1000);
  const devices = (await growattDevices(base, token, plantId, deps)).slice(0, 20);
  for (const device of devices) {
    const spec = LAST_DATA[device.type];
    if (!spec) continue;
    await sleep(1000);
    if (device.lost) {
      batches.push({ external_id: device.sn, name: device.name, model: device.model, rows: [{ ts: (input.now ?? new Date()).toISOString(), inverter_status: "SIN_CONEXION" }] });
      continue;
    }
    try {
      const data = await call(base, token, spec.path, { [spec.param]: device.sn }, spec.method, deps) as Record<string, unknown> | null;
      const inner = (data && typeof data === "object" && "data" in data && typeof data.data === "object" ? data.data : data) as Record<string, unknown> | null;
      const reading = inner ? deviceReading(device, inner, timeZone) : null;
      if (reading) batches.push({ external_id: device.sn, name: device.name, model: device.model, rows: [reading] });
    } catch (error) {
      if (!(error instanceof GrowattError) || error.code === "GROWATT_TOKEN_INVALID") throw error;
    }
  }
  return batches;
}
