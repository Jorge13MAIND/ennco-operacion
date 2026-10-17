import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { apiIngestSchema } from "@/lib/medidores/model";
import { EnergyServiceError, energyService } from "@/lib/medidores/service";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const dynamic = "force-dynamic";

/**
 * API de lecturas para los equipos (prueba del lunes en Cortes Fox): POST con
 * `Authorization: Bearer enm_…` (la llave del medidor, que se genera en la pestaña Medidores) y un JSON
 * `{ "readings": [{ "ts": "2026-10-19T09:30:00-06:00", "p_import_kw": 42.1, ... }] }` (o una sola
 * lectura). Hasta 2,000 lecturas por llamada; la hora siempre con zona. Una lectura repetida se fusiona.
 */
const headers = { "Cache-Control": "no-store" } as const;
const MAX_BYTES = 3_500_000;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization") ?? "";
  const key = /^Bearer (enm_[A-Za-z0-9_-]{43})$/.exec(auth.trim())?.[1];
  if (!key) return NextResponse.json({ error: "ENERGY_KEY_REQUIRED" }, { status: 401, headers });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) return NextResponse.json({ error: "ENERGY_BATCH_TOO_LARGE" }, { status: 413, headers });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return NextResponse.json({ error: "ENERGY_BATCH_TOO_LARGE" }, { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "ENERGY_BODY_INVALID" }, { status: 400, headers });
  }
  const parsed = apiIngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ENERGY_READINGS_INVALID", issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400, headers });
  }
  try {
    const result = await energyService(getRuntimeConfig(), {
      op: "INGEST", key_sha256: createHash("sha256").update(key, "utf8").digest("hex"), rows: parsed.data.readings,
    });
    return NextResponse.json({ ok: true, accepted: result.accepted ?? 0, ignored: result.ignored ?? 0, first: result.first ?? null, last: result.last ?? null }, { status: 200, headers });
  } catch (error) {
    const code = error instanceof EnergyServiceError ? error.code : "ENERGY_INGEST_FAILED";
    const status = code === "ENERGY_KEY_UNKNOWN" ? 401 : code === "ENERGY_METER_INACTIVE" ? 403 : code === "ENERGY_SERVICE_UNAVAILABLE" ? 503 : 409;
    return NextResponse.json({ error: code }, { status, headers });
  }
}
