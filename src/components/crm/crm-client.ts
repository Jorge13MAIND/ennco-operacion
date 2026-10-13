"use client";

import { crmDetailSchema, crmErrorMessage, type CrmCommand, type CrmDetail } from "@/lib/crm/model";

function newIdempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type CommandOutcome = { ok: true; message: string; recordId?: string } | { ok: false; message: string; code?: string };

/** Manda un comando al CRM. La base devuelve el mensaje a mostrar o el código de lo que falta. */
export async function sendCrmCommand(command: CrmCommand): Promise<CommandOutcome> {
  try {
    const response = await fetch("/api/v1/operations/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey() },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as { message?: string; record_id?: string; error?: string } | null;
    if (!response.ok) return { ok: false, code: body?.error, message: crmErrorMessage(body?.error) };
    return { ok: true, message: body?.message ?? "Guardado.", recordId: body?.record_id };
  } catch {
    return { ok: false, message: "Sin conexión con el hub. Intenta de nuevo." };
  }
}

export async function fetchCrmDetail(recordId: string): Promise<CrmDetail | null> {
  try {
    const response = await fetch(`/api/v1/operations/crm/${recordId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = crmDetailSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** "2026-10-14T10:00" (hora local del navegador) a ISO; vacío si no hay fecha. */
export function localToIso(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** ISO a valor de <input type="datetime-local"> en la hora del navegador. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
