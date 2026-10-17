import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { EVALUATED_RULES, evaluateAlerts, localParts, staleEvent, type AlertEvent, type EvalReading } from "@/lib/medidores/alerts";
import { meterSchema, siteCoreSchema } from "@/lib/medidores/model";
import { createDispatchProof } from "@/lib/dispatch/proof";
import { rpcErrorCode } from "@/lib/dispatch/rpc-error";
import { hasDedicatedSupabase, type RuntimeConfig } from "@/lib/runtime/config";

/**
 * Llamadas de servidor a public.energy_service, firmadas con la prueba HMAC del despachador
 * (ENNCO_DISPATCH_SECRET): la API de lecturas, la evaluación de alertas, Growatt, el aviso de "sin datos"
 * y Telegram. Nada de esto pasa por la sesión del usuario.
 */
export class EnergyServiceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "EnergyServiceError"; }
}

export async function energyService(config: RuntimeConfig, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!hasDedicatedSupabase(config) || !config.dispatchSecret) throw new EnergyServiceError("ENERGY_SERVICE_UNAVAILABLE");
  const text = JSON.stringify(payload);
  const proof = createDispatchProof({
    organizationId: config.organizationId, commandName: "energy_service",
    payloadParts: [config.organizationId, createHash("sha256").update(text, "utf8").digest("hex")], secret: config.dispatchSecret,
  });
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.rpc("energy_service", { target_organization_id: config.organizationId, target_payload: text, ...proof });
  if (error) throw new EnergyServiceError(rpcErrorCode(error));
  return z.record(z.string(), z.unknown()).parse(data);
}

const evalReadSchema = z.object({
  meter: meterSchema, site: siteCoreSchema, since: z.string(), until: z.string(), last_reading_at: z.string().nullable(),
  fields: z.array(z.string()), rows: z.array(z.array(z.unknown())),
  open_events: z.array(z.object({ rule: z.string(), started_at: z.string() })),
  history: z.array(z.object({ d: z.string(), h: z.number(), imp: z.number().nullable(), pv: z.number().nullable() })),
});

/** Medianoche local (en UTC) del día de `iso` en la zona de la planta. */
export function localMidnight(iso: string, timeZone: string): string {
  const { date } = localParts(iso, timeZone);
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offset = (t: number) => { const l = localParts(new Date(t).toISOString(), timeZone); return Date.parse(`${l.date}T${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}:00Z`) - t; };
  return new Date(guess - offset(guess)).toISOString();
}

/**
 * Evalúa las alertas de un medidor entre `since` y `until`, en ventanas de 7 días que empiezan a la
 * medianoche de la planta (así un día nunca queda partido entre dos ventanas). Cada ventana reemplaza
 * las alertas abiertas que la evaluación ya no encuentra.
 */
export async function evaluateMeter(config: RuntimeConfig, meterId: string, range: { since: string; until: string },
  call: typeof energyService = energyService): Promise<{ windows: number; events: number }> {
  // Primero una ventana mínima para conocer la zona horaria de la planta.
  const probe = evalReadSchema.parse(await call(config, { op: "EVAL_READ", meter_id: meterId, since: new Date(Date.parse(range.until) - 60000).toISOString(), until: range.until }));
  const tz = probe.site.timezone;
  let start = localMidnight(range.since, tz);
  let windows = 0, total = 0;
  while (Date.parse(start) < Date.parse(range.until)) {
    const end = new Date(Math.min(Date.parse(start) + 7 * 86400000, Date.parse(range.until))).toISOString();
    const read = evalReadSchema.parse(await call(config, { op: "EVAL_READ", meter_id: meterId, since: start, until: end }));
    const readings: EvalReading[] = read.rows.map((row) => Object.fromEntries(read.fields.map((f, i) => [f, row[i] ?? null])) as unknown as EvalReading);
    const events: AlertEvent[] = readings.length ? evaluateAlerts({
      meter: { kind: read.meter.kind, nominal_v_ln: read.meter.nominal_v_ln, interval_minutes: read.meter.interval_minutes, thresholds: read.meter.thresholds, name: read.meter.name },
      site: read.site, readings, history: read.history, lastReadingAt: read.last_reading_at, openEvents: read.open_events,
    }) : [];
    const last = Date.parse(end) >= Date.parse(range.until);
    await call(config, { op: "ALERTS_SYNC", meter_id: meterId, since: start, until: end, rules: EVALUATED_RULES, events, mark_evaluated: last });
    windows += 1; total += events.length;
    start = end;
  }
  return { windows, events: total };
}

/** Rango a evaluar en el cron para un medidor con datos nuevos: desde su última evaluación (máximo 7 días). */
export function cronRange(meter: { evaluated_at: string | null; first_reading_at: string | null; last_reading_at: string }): { since: string; until: string } {
  const until = new Date(Date.parse(meter.last_reading_at) + 1000).toISOString();
  const floor = Date.parse(until) - 7 * 86400000;
  const from = meter.evaluated_at ? Date.parse(meter.evaluated_at) - 3600000 : Date.parse(meter.first_reading_at ?? meter.last_reading_at);
  return { since: new Date(Math.max(from, floor)).toISOString(), until };
}

export async function flagStaleMeters(config: RuntimeConfig, stale: Array<{ id: string; name: string; last_reading_at: string }>,
  call: typeof energyService = energyService, now = new Date()): Promise<number> {
  for (const meter of stale) {
    const event = staleEvent(meter, "America/Mexico_City", now);
    await call(config, { op: "ALERTS_SYNC", meter_id: meter.id, since: meter.last_reading_at, until: now.toISOString(), rules: ["SIN_DATOS"], events: [event], mark_evaluated: false });
  }
  return stale.length;
}
