"use client";

import type { ImportRow } from "@/lib/medidores/circutor";
import { energyErrorMessage, meterViewSchema, type EnergyCommand, type MeterView } from "@/lib/medidores/model";

function newIdempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type Outcome<T = Record<string, unknown>> = { ok: true; message: string; data: T } | { ok: false; message: string; code?: string };

async function post<T = Record<string, unknown>>(url: string, body: unknown, idempotent = true): Promise<Outcome<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(idempotent ? { "Idempotency-Key": newIdempotencyKey() } : {}) },
      body: JSON.stringify(body), cache: "no-store",
    });
    const data = await response.json().catch(() => null) as (T & { message?: string; error?: string }) | null;
    if (!response.ok) return { ok: false, code: data?.error, message: energyErrorMessage(data?.error) };
    return { ok: true, message: data?.message ?? "Guardado.", data: data as T };
  } catch {
    return { ok: false, message: "Sin conexión con el hub. Intenta de nuevo." };
  }
}

export const sendEnergyCommand = (command: EnergyCommand) => post("/api/v1/operations/medidores", command);

export async function fetchMeterView(meterId: string, since?: string | null, until?: string | null): Promise<MeterView | null> {
  const query = new URLSearchParams();
  if (since) query.set("desde", since);
  if (until) query.set("hasta", until);
  try {
    const response = await fetch(`/api/v1/operations/medidores/${meterId}${query.size ? `?${query}` : ""}`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = meterViewSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const generateMeterKey = (meterId: string) => post<{ key: string | null }>(`/api/v1/operations/medidores/${meterId}/llave`, {});
export const evaluateMeterAlerts = (meterId: string, since: string, until: string) =>
  post<{ events: number; windows: number }>(`/api/v1/operations/medidores/${meterId}/evaluar`, { since, until }, false);

export type GrowattPlantOption = { id: string; name: string; city: string | null; country: string | null; peak_kw: number | null };
export const testGrowatt = (token: string, region: string) =>
  post<{ base: string; plants: GrowattPlantOption[] }>("/api/v1/operations/medidores/growatt", { action: "probar", token, region });
export const connectGrowatt = (input: { token: string; base: string; plant_id: string; plant_name?: string; site_id: string }) =>
  post("/api/v1/operations/medidores/growatt", { action: "conectar", ...input });

/** Sube lecturas de un archivo en tandas de 1,000; avisa el avance. */
export async function uploadReadings(meterId: string, rows: ImportRow[], intervalMinutes: number | null,
  onProgress: (done: number, total: number) => void): Promise<Outcome<{ accepted: number; inserted: number }>> {
  let accepted = 0, inserted = 0;
  for (let start = 0; start < rows.length; start += 1000) {
    const chunk = rows.slice(start, start + 1000);
    const result = await post<{ accepted?: number; inserted?: number }>(`/api/v1/operations/medidores/${meterId}/lecturas`,
      { local: true, rows: chunk, ...(intervalMinutes ? { interval_minutes: intervalMinutes } : {}) });
    if (!result.ok) return { ok: false, code: result.code, message: `${result.message} Se guardaron ${accepted} lecturas antes del error.` };
    accepted += Number(result.data.accepted ?? 0); inserted += Number(result.data.inserted ?? 0);
    onProgress(Math.min(start + chunk.length, rows.length), rows.length);
  }
  return { ok: true, message: `${accepted} lecturas guardadas (${inserted} nuevas).`, data: { accepted, inserted } };
}
