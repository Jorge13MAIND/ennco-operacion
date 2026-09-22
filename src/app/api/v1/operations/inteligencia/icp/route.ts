import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { scoreAccountV2, type IcpV2Input } from "@/lib/inteligencia/icp-v2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/** Tope por corrida. Las 840 empresas caben en dos pasadas. */
const BATCH_LIMIT = 500;

/**
 * Recalcula la puntuación ICP de las cuentas del tenant con la rúbrica v2.
 *
 * Cambio del 22-sep: la rúbrica v1 esperaba cadenas de DENUE/PROFEPA y con los datos de Apollo
 * dejaba 0 de 840 cuentas puntuadas. La v2 puntúa con lo que sí tenemos: giro, multi-hilo
 * (mantenimiento y dirección a la vez), gancho verificable aprobado, tier y dominio, y resta a
 * los corporativos globales, que no se cierran por correo frío.
 *
 * Idempotente por (cuenta, versión de rúbrica). La escritura pasa por el RPC, que revalida
 * tenant y rol; esta ruta no escribe directo a la tabla.
 */
export async function POST(): Promise<NextResponse> {
  const access = await requireOperationsAccess();
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return NextResponse.json({ error: "LIVE_ACCESS_REQUIRED" }, { status: 403, headers: privateHeaders });
  }

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("accounts")
    .select("id,legal_name,state,city,sector,primary_domain,tier")
    .eq("organization_id", access.organizationId)
    .eq("is_deleted", false)
    .order("legal_name")
    .limit(BATCH_LIMIT);

  if (error) return NextResponse.json({ error: "ACCOUNTS_READ_FAILED" }, { status: 502, headers: privateHeaders });

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ state: "OK", written: 0, submitted: 0, reason: "SIN_CUENTAS_CARGADAS" }, { status: 200, headers: privateHeaders });
  }
  const accountIds = rows.map((row) => String(row.id));

  // Los puestos que tenemos de cada empresa deciden si hay multi-hilo.
  const { data: contacts } = await client
    .from("contacts")
    .select("account_id,role_title")
    .eq("organization_id", access.organizationId)
    .eq("is_deleted", false)
    .in("account_id", accountIds);
  const rolesByAccount = new Map<string, string[]>();
  for (const contact of contacts ?? []) {
    if (contact.account_id === null) continue;
    const key = String(contact.account_id);
    rolesByAccount.set(key, [...(rolesByAccount.get(key) ?? []), String(contact.role_title ?? "")]);
  }

  // Solo el gancho aprobado cuenta: un borrador sin revisar no sube a nadie de banda.
  const { data: hooks } = await client
    .from("ennco_account_hooks")
    .select("account_id")
    .eq("organization_id", access.organizationId)
    .eq("status", "APPROVED")
    .in("account_id", accountIds);
  const hooked = new Set((hooks ?? []).map((hook) => String(hook.account_id)));

  const scores = rows.map((row) => {
    const id = String(row.id);
    const input: IcpV2Input = {
      legal_name: String(row.legal_name ?? ""),
      state: row.state as string | null,
      city: row.city as string | null,
      sector: row.sector as string | null,
      primary_domain: row.primary_domain as string | null,
      tier: row.tier === null || row.tier === undefined ? null : String(row.tier),
      contact_roles: rolesByAccount.get(id) ?? [],
      has_hook: hooked.has(id),
    };
    const result = scoreAccountV2(input);
    return {
      account_id: row.id,
      score: result.score,
      band: result.band,
      rubric_version: result.rubric_version,
      factors: result.factors,
      missing: result.missing,
      contract_only_state: result.strategic_account,
    };
  });

  const { data: written, error: writeError } = await client.rpc("upsert_account_icp_scores", {
    target_organization_id: access.organizationId,
    target_scores: scores,
  });

  if (writeError) {
    return NextResponse.json({ error: "ICP_WRITE_REJECTED", reason: writeError.message.slice(0, 120) }, { status: 422, headers: privateHeaders });
  }

  const bands = scores.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.band]: (acc[s.band] ?? 0) + 1 }), {});
  return NextResponse.json({ state: "OK", bands, ...(written as Record<string, unknown>) }, { status: 200, headers: privateHeaders });
}
