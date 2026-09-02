import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { scoreAccount, type IcpAccountInput } from "@/lib/inteligencia/icp";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/** Tope por corrida. Las 1,831 empresas caben en cuatro pasadas. */
const BATCH_LIMIT = 500;

/**
 * Recalcula la puntuación ICP de las cuentas del tenant.
 *
 * Es idempotente por (cuenta, versión de rúbrica): correrlo dos veces deja el
 * mismo resultado. La lectura es de public.accounts y la escritura pasa por el
 * RPC, que revalida tenant y rol; esta ruta no escribe directo a la tabla.
 */
export async function POST(): Promise<NextResponse> {
  const access = await requireOperationsAccess();
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return NextResponse.json({ error: "LIVE_ACCESS_REQUIRED" }, { status: 403, headers: privateHeaders });
  }

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("accounts")
    .select("id,legal_name,state,city,industrial_park,sector,primary_domain")
    .eq("organization_id", access.organizationId)
    .eq("is_deleted", false)
    .order("legal_name")
    .limit(BATCH_LIMIT);

  if (error) return NextResponse.json({ error: "ACCOUNTS_READ_FAILED" }, { status: 502, headers: privateHeaders });

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ state: "OK", written: 0, submitted: 0, reason: "SIN_CUENTAS_CARGADAS" }, { status: 200, headers: privateHeaders });
  }

  // PROFEPA no es una columna de accounts: se deriva de la evidencia de origen,
  // que se guarda por sujeto (subject_type/subject_id), no por llave foránea.
  // Sin evidencia alguna queda en null, que la rúbrica trata como "no
  // verificado" y suma cero, en vez de asumir que la empresa no lo tiene.
  const { data: evidence } = await client
    .from("source_evidence")
    .select("subject_id,source_name")
    .eq("organization_id", access.organizationId)
    .eq("subject_type", "ACCOUNT")
    .in("subject_id", rows.map((row) => row.id));

  const profepaByAccount = new Map<string, boolean>();
  for (const row of evidence ?? []) {
    if (typeof row.source_name !== "string" || row.subject_id === null) continue;
    if (/profepa/i.test(row.source_name)) profepaByAccount.set(String(row.subject_id), true);
  }

  const scores = rows.map((row) => {
    const input: IcpAccountInput = {
      legal_name: String(row.legal_name ?? ""),
      state: row.state as string | null,
      city: row.city as string | null,
      industrial_park: row.industrial_park as string | null,
      sector: row.sector as string | null,
      primary_domain: row.primary_domain as string | null,
      profepa_certified: profepaByAccount.get(String(row.id)) ?? (evidence && evidence.length > 0 ? false : null),
    };
    const result = scoreAccount(input);
    return {
      account_id: row.id,
      score: result.score,
      band: result.band,
      rubric_version: result.rubric_version,
      factors: result.factors,
      missing: result.missing,
      contract_only_state: result.contract_only_state,
    };
  });

  const { data: written, error: writeError } = await client.rpc("upsert_account_icp_scores", {
    target_organization_id: access.organizationId,
    target_scores: scores,
  });

  if (writeError) {
    return NextResponse.json({ error: "ICP_WRITE_REJECTED", reason: writeError.message.slice(0, 120) }, { status: 422, headers: privateHeaders });
  }

  return NextResponse.json({ state: "OK", ...(written as Record<string, unknown>) }, { status: 200, headers: privateHeaders });
}
