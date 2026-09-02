import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { ApolloReadonlyClient, ApolloReadonlyError } from "@/lib/providers/apollo/readonly-client";
import {
  APOLLO_SENIORITIES,
  ENRICH_LIMIT_PER_RUN,
  emptySummary,
  isUsableEmail,
  partitionByDomain,
  selectCandidates,
  titlesFor,
  type AccountForLookup,
  type IngestSummary,
} from "@/lib/research/apollo-leads";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/** Cuentas por corrida. Con 5 candidatos por cuenta cabe en el tope de enriquecimiento. */
const ACCOUNTS_PER_RUN = 12;

/**
 * Trae contactos de Apollo para las cuentas de mayor prioridad ICP.
 *
 * Busca gratis y enriquece con tope: `mixed_people/api_search` no consume
 * créditos, `people/match` sí. Todo entra como candidato `DISCOVERED`, que
 * después sube a contacto por el flujo de revisión de dos personas.
 *
 * No decide a quién contactar ni inscribe a nadie en una campaña.
 */
export async function POST(): Promise<NextResponse> {
  const access = await requireOperationsAccess();
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return NextResponse.json({ error: "LIVE_ACCESS_REQUIRED" }, { status: 403, headers: privateHeaders });
  }

  const config = getRuntimeConfig();
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "APOLLO_API_KEY_MISSING" }, { status: 503, headers: privateHeaders });
  }

  const client = new ApolloReadonlyClient({ apiKey });
  const supabase = await createSupabaseServerClient();

  // Prioridad ICP primero: gastar créditos en la cuenta 1,800 antes que en la
  // banda A sería tirar el presupuesto. Las que ya tienen candidatos se saltan.
  const { data: queue, error: queueError } = await supabase.rpc("read_icp_priority_queue", {
    target_organization_id: access.organizationId,
    target_limit: 200,
  });
  if (queueError) {
    return NextResponse.json({ error: "ICP_QUEUE_UNAVAILABLE" }, { status: 502, headers: privateHeaders });
  }

  const scored = (queue as { accounts?: Array<Record<string, unknown>> } | null)?.accounts ?? [];
  const elegibles = scored.filter((row) => row.band !== "FUERA_DE_CONTRATO" && row.suppressed !== true);
  if (elegibles.length === 0) {
    return NextResponse.json(
      { state: "OK", ...emptySummary(0), reason: "SIN_CUENTAS_PUNTUADAS" },
      { status: 200, headers: privateHeaders },
    );
  }

  const ids = elegibles.slice(0, ACCOUNTS_PER_RUN * 3).map((row) => String(row.account_id));
  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id,legal_name,primary_domain")
    .eq("organization_id", access.organizationId)
    .in("id", ids);

  const porId = new Map((accountRows ?? []).map((row) => [String(row.id), row]));
  const ordenadas: AccountForLookup[] = ids
    .map((id) => porId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      id: String(row.id),
      legal_name: String(row.legal_name ?? ""),
      primary_domain: (row.primary_domain as string | null) ?? null,
    }));

  const { buscables, sinDominio } = partitionByDomain(ordenadas);
  const objetivo = buscables.slice(0, ACCOUNTS_PER_RUN);

  const resumen = {
    ...emptySummary(ordenadas.length),
    accountsWithoutDomain: sinDominio.length,
  } as IngestSummary & { byCategory: Record<string, number> };
  const porCategoria: Record<string, number> = {};
  let buscadas = 0;
  let encontradas = 0;
  let seleccionadas = 0;
  let revelados = 0;
  let escritos = 0;
  let gastados = 0;

  try {
    for (const account of objetivo) {
      if (gastados >= ENRICH_LIMIT_PER_RUN) break;

      const busqueda = await client.searchPeople({
        organizationDomains: [String(account.primary_domain)],
        titles: titlesFor(["CEO", "PLANT_DIRECTOR", "MAINTENANCE", "PROCUREMENT", "SAFETY"]),
        seniorities: [...APOLLO_SENIORITIES],
        page: 1,
        perPage: 25,
      });
      buscadas += 1;
      encontradas += busqueda.people.length;

      const candidatos = selectCandidates(busqueda.people);
      seleccionadas += candidatos.length;

      for (const candidato of candidatos) {
        if (gastados >= ENRICH_LIMIT_PER_RUN) break;

        // Aquí es donde se gastan créditos, y sólo aquí.
        const persona = await client.enrichPersonEmailOnly({ personId: candidato.providerPersonId });
        gastados += 1;
        if (!persona || !isUsableEmail(persona.email, persona.email_status)) continue;
        revelados += 1;

        // La evidencia se registra antes que el candidato: un contacto sin
        // origen trazable no sirve para el expediente contractual.
        const { data: evidenceId } = await supabase.rpc("record_research_evidence", {
          target_organization_id: access.organizationId,
          target_subject_type: "ACCOUNT",
          target_subject_id: account.id,
          target_field_name: "contact_email",
          target_source_url: "https://app.apollo.io",
          target_source_name: "Apollo people/match",
        });

        const idempotencyKey = await sha256Hex(
          `apollo:${access.organizationId}:${account.id}:${candidato.providerPersonId}`,
        );

        const { error: writeError } = await supabase.rpc("upsert_contact_candidate", {
          target_organization_id: access.organizationId,
          target_account_id: account.id,
          target_full_name: candidato.fullName,
          target_role_title: candidato.roleTitle,
          target_role_category: candidato.roleCategory,
          target_normalized_email: String(persona.email).toLowerCase(),
          target_evidence_ids: evidenceId ? [String(evidenceId)] : [],
          target_idempotency_key: idempotencyKey,
        });

        if (writeError) continue;
        escritos += 1;
        porCategoria[candidato.roleCategory] = (porCategoria[candidato.roleCategory] ?? 0) + 1;
      }
    }
  } catch (error) {
    // Se devuelve lo que sí alcanzó a escribirse: perder el trabajo hecho por
    // un fallo a media corrida obligaría a volver a gastar los créditos.
    const reason = error instanceof ApolloReadonlyError ? error.message : "APOLLO_INGEST_FAILED";
    return NextResponse.json({
      state: "PARTIAL",
      reason,
      ...resumen,
      accountsSearched: buscadas,
      peopleFound: encontradas,
      candidatesSelected: seleccionadas,
      emailsRevealed: revelados,
      candidatesWritten: escritos,
      enrichBudgetSpent: gastados,
      byCategory: porCategoria,
    }, { status: 200, headers: privateHeaders });
  }

  return NextResponse.json({
    state: "OK",
    ...resumen,
    accountsSearched: buscadas,
    peopleFound: encontradas,
    candidatesSelected: seleccionadas,
    emailsRevealed: revelados,
    candidatesWritten: escritos,
    enrichBudgetSpent: gastados,
    byCategory: porCategoria,
    demoMode: config.demoMode,
  }, { status: 200, headers: privateHeaders });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
