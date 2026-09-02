/**
 * Lectura de la pantalla de Inteligencia.
 *
 * Sigue el mismo contrato que src/lib/correos/overview.ts: con acceso live lee
 * los RPC reales; sin él devuelve un ejemplo sintético claramente marcado, para
 * que la pantalla se pueda recorrer en capacitación sin tocar datos del cliente.
 */

import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { buildBrief, type Brief, type BriefMoment } from "./brief";
import { CLASSIFIER_VERSION } from "./clasificador";
import { ICP_RUBRIC_VERSION } from "./icp";

const icpAccountSchema = z.object({
  account_id: z.string().uuid(),
  legal_name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  industrial_park: z.string().nullable(),
  tier: z.string().nullable(),
  score: z.number().int(),
  band: z.enum(["A", "B", "C", "D", "FUERA_DE_CONTRATO"]),
  contract_only_state: z.boolean(),
  missing: z.array(z.string()),
  factors: z.array(z.object({
    key: z.string(), label: z.string(), points: z.number(), max: z.number(), evidence: z.string(),
  })),
  suppressed: z.boolean(),
  enrolled: z.boolean(),
});

const icpQueueSchema = z.object({
  generated_at: z.string(),
  totals: z.object({
    scored: z.number().int(),
    band_a: z.number().int(),
    band_b: z.number().int(),
    band_c: z.number().int(),
    band_d: z.number().int(),
    out_of_contract: z.number().int(),
    contract_only_state: z.number().int(),
  }),
  accounts: z.array(icpAccountSchema),
});

const suggestionSchema = z.object({
  provider_event_id: z.string().uuid(),
  intent: z.string(),
  classification: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  confidence: z.coerce.number(),
  signals: z.array(z.string()),
  needs_human_now: z.boolean(),
  classifier_version: z.string(),
  observed_at: z.string().nullable(),
  subject: z.string().nullable(),
  from_email: z.string().nullable(),
});

const suggestionsSchema = z.object({
  generated_at: z.string(),
  needs_human_now: z.number().int(),
  suggestions: z.array(suggestionSchema),
});

export type IcpQueue = z.infer<typeof icpQueueSchema>;
export type ReplySuggestionRow = z.infer<typeof suggestionSchema>;
export type SuggestionsView = z.infer<typeof suggestionsSchema>;

export interface IntelligenceScreen {
  readonly evidenceClass: "synthetic_demo" | "live";
  readonly generatedAt: string;
  readonly rubricVersion: string;
  readonly classifierVersion: string;
  readonly icp: IcpQueue;
  readonly suggestions: SuggestionsView;
  readonly brief: Brief;
  readonly canOperate: boolean;
}

function currentMoment(now: Date): BriefMoment {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City", hour: "numeric", hour12: false,
  }).format(now)) % 24;
  return hour < 12 ? "PREFLIGHT" : "CLOSE";
}

function syntheticScreen(now: Date): IntelligenceScreen {
  const iso = now.toISOString();
  const icp: IcpQueue = {
    generated_at: iso,
    totals: { scored: 3, band_a: 1, band_b: 1, band_c: 1, band_d: 0, out_of_contract: 0, contract_only_state: 1 },
    accounts: [
      {
        account_id: "42000000-0000-4000-8000-000000000001",
        legal_name: "SIMULACION Autopartes del Bajío",
        city: "El Marqués", state: "QUERETARO", industrial_park: "FINSA", tier: "TIER_1",
        score: 100, band: "A", contract_only_state: false, missing: [],
        factors: [
          { key: "tamano", label: "Tamaño (proxy de >100 kWp)", points: 30, max: 30, evidence: "personal ocupado 251+" },
          { key: "profepa", label: "Certificado PROFEPA-PNAA vigente", points: 25, max: 25, evidence: "Industria Limpia vigente" },
          { key: "giro", label: "Giro intensivo en energía", points: 25, max: 25, evidence: "SCIAN 336330, intensivo en energía" },
          { key: "parque", label: "Parque industrial identificado", points: 10, max: 10, evidence: "FINSA" },
          { key: "corredor", label: "Ciudad del corredor León-Querétaro", points: 10, max: 10, evidence: "El Marqués, dentro del corredor" },
        ],
        suppressed: false, enrolled: false,
      },
      {
        account_id: "42000000-0000-4000-8000-000000000002",
        legal_name: "SIMULACION Plásticos de Occidente",
        city: "Zapopan", state: "JALISCO", industrial_park: null, tier: "TIER_2",
        score: 65, band: "B", contract_only_state: true, missing: ["parque"],
        factors: [
          { key: "tamano", label: "Tamaño (proxy de >100 kWp)", points: 20, max: 30, evidence: "personal ocupado 101-250" },
          { key: "profepa", label: "Certificado PROFEPA-PNAA vigente", points: 25, max: 25, evidence: "Industria Limpia vigente" },
          { key: "giro", label: "Giro intensivo en energía", points: 25, max: 25, evidence: "SCIAN 326, intensivo en energía" },
          { key: "parque", label: "Parque industrial identificado", points: 0, max: 10, evidence: "sin parque registrado" },
          { key: "corredor", label: "Ciudad del corredor León-Querétaro", points: 0, max: 10, evidence: "Zapopan, fuera del corredor" },
        ],
        suppressed: false, enrolled: false,
      },
      {
        account_id: "42000000-0000-4000-8000-000000000003",
        legal_name: "SIMULACION Tejas del Centro",
        city: "León", state: "GUANAJUATO", industrial_park: "Colinas de León", tier: "TIER_2",
        score: 42, band: "C", contract_only_state: false, missing: ["profepa"],
        factors: [
          { key: "tamano", label: "Tamaño (proxy de >100 kWp)", points: 20, max: 30, evidence: "personal ocupado 101-250" },
          { key: "profepa", label: "Certificado PROFEPA-PNAA vigente", points: 0, max: 25, evidence: "no verificado" },
          { key: "giro", label: "Giro intensivo en energía", points: 12, max: 25, evidence: "SCIAN 311, manufactura no intensiva" },
          { key: "parque", label: "Parque industrial identificado", points: 10, max: 10, evidence: "Colinas de León" },
          { key: "corredor", label: "Ciudad del corredor León-Querétaro", points: 10, max: 10, evidence: "León, dentro del corredor" },
        ],
        suppressed: true, enrolled: false,
      },
    ],
  };

  const suggestions: SuggestionsView = {
    generated_at: iso,
    needs_human_now: 1,
    suggestions: [{
      provider_event_id: "43000000-0000-4000-8000-000000000001",
      intent: "REFERRAL",
      classification: "POSITIVE",
      confidence: 0.9,
      signals: ["…con mantenimiento habla Luis Ortega…"],
      needs_human_now: true,
      classifier_version: CLASSIFIER_VERSION,
      observed_at: iso,
      subject: "Re: Lo que le costó un apagón a un cliente",
      from_email: "compras@simulacion.invalid",
    }],
  };

  const moment = currentMoment(now);
  return {
    evidenceClass: "synthetic_demo",
    generatedAt: iso,
    rubricVersion: ICP_RUBRIC_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    icp,
    suggestions,
    brief: buildBrief({
      moment, generatedAt: iso,
      unreviewedReplies: 1, oldestUnreviewedMinutes: 35,
      openP0: 0, openP1: 0, openReplyCases: 0,
      assignmentActive: true, externalSendAllowed: false, killSwitch: true,
      mailboxes: [{ email: "francisco@enncoindustrial.com", status: "DISCONNECTED", sentToday: 0, capToday: 0 }],
      suggestionsNeedingHuman: 1,
      priorityAccountsReady: 1,
    }),
    canOperate: true,
  };
}

export async function loadIntelligenceScreen(access: OperationsAccessContext): Promise<IntelligenceScreen> {
  const now = new Date();
  if (access.evidenceClass !== "live" || !access.organizationId) return syntheticScreen(now);

  const client = await createSupabaseServerClient();
  const [queue, suggestions, lane, dispatchHealth, incidents] = await Promise.all([
    client.rpc("read_icp_priority_queue", { target_organization_id: access.organizationId, target_limit: 100 }),
    client.rpc("read_reply_suggestions", { target_organization_id: access.organizationId }),
    client.rpc("read_direct_lane_overview", { target_organization_id: access.organizationId }),
    client.rpc("read_dispatch_health", { target_organization_id: access.organizationId }),
    client.from("incidents").select("severity").eq("organization_id", access.organizationId).eq("status", "OPEN"),
  ]);

  if (queue.error || suggestions.error) throw new Error("INTELLIGENCE_OVERVIEW_UNAVAILABLE");

  const icp = icpQueueSchema.parse(queue.data);
  const parsedSuggestions = suggestionsSchema.parse(suggestions.data);

  // El brief se arma con las tres fuentes que ya existen. Cada una degrada por
  // separado: si una falla el brief pierde ese renglón en vez de tumbar la
  // pantalla, porque la cola ICP y las sugerencias siguen siendo útiles solas.
  const laneData = (lane.error ? null : lane.data) as Record<string, unknown> | null;
  const laneFlags = (laneData?.flags ?? {}) as Record<string, unknown>;
  const laneTotals = (laneData?.totals ?? {}) as Record<string, unknown>;
  const mailboxRows = Array.isArray(laneData?.mailboxes) ? laneData.mailboxes as Record<string, unknown>[] : [];

  const healthData = (dispatchHealth.error ? null : dispatchHealth.data) as Record<string, unknown> | null;
  const replyOps = (healthData?.reply_operations ?? {}) as Record<string, unknown>;

  const openIncidents = incidents.error ? [] : (incidents.data ?? []);
  const countSeverity = (level: string) => openIncidents.filter((row) => row.severity === level).length;

  const brief = buildBrief({
    moment: currentMoment(now),
    generatedAt: now.toISOString(),
    unreviewedReplies: numberOf(replyOps.unreviewed_replies ?? laneTotals.replies_unreviewed),
    oldestUnreviewedMinutes: replyOps.oldest_unreviewed_minutes === null || replyOps.oldest_unreviewed_minutes === undefined
      ? null : numberOf(replyOps.oldest_unreviewed_minutes),
    openP0: countSeverity("P0"),
    openP1: countSeverity("P1"),
    openReplyCases: numberOf(replyOps.open_reply_cases),
    assignmentActive: replyOps.assignment_active === true,
    externalSendAllowed: laneFlags.external_send_allowed === true,
    killSwitch: laneFlags.global_kill_switch !== false,
    mailboxes: mailboxRows.map((row) => ({
      email: String(row.normalized_email ?? ""),
      status: String(row.status ?? "DISCONNECTED"),
      sentToday: numberOf(row.sent_today),
      capToday: numberOf(row.effective_cap),
    })),
    suggestionsNeedingHuman: parsedSuggestions.needs_human_now,
    priorityAccountsReady: icp.accounts.filter((a) => a.band === "A" && !a.enrolled && !a.suppressed).length,
  });

  return {
    evidenceClass: "live",
    generatedAt: now.toISOString(),
    rubricVersion: ICP_RUBRIC_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    icp,
    suggestions: parsedSuggestions,
    brief,
    canOperate: access.role === "teckel_admin" || access.role === "teckel_operator" || access.role === "ennco_admin",
  };
}

function numberOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
