import type { OperationsAccessContext } from "@/lib/auth/authorization";
import {
  parseOutboundProviderReadiness,
  providerBlockerLabel,
} from "@/lib/infrastructure/provider";
import {
  hybridBlockerLabel,
  isHybridOutboundReleaseAllowed,
  parseHybridOutboundReadiness,
} from "@/lib/infrastructure/hybrid-outbound";
import {
  CONTROL_CADENCE_CODES,
  createUnknownControlCadenceHealth,
  isExternalSendAllowedWithCadence,
  parseControlCadenceReadModel,
  type ControlCadenceCode,
  type ControlCadenceHealth,
} from "@/lib/operations/cadence";
import { parseCapacityReadModel } from "@/lib/operations/capacity";
import { operationsHealthResultSchema } from "@/lib/operations/sla";
import { parseResearchPortalReadModel } from "@/lib/research/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const OPERATION_MODULE_KEYS = [
  "alertas",
  "cadencia",
  "respuestas",
  "leads",
  "empresas",
  "infraestructura",
  "campanas",
] as const;

export type OperationModuleKey = (typeof OPERATION_MODULE_KEYS)[number];

export const OPERATION_MODULE_LABELS: Record<OperationModuleKey, string> = {
  alertas: "Alertas e incidentes",
  cadencia: "Cadencia",
  respuestas: "Respuestas",
  leads: "Leads",
  empresas: "Empresas",
  infraestructura: "Infraestructura",
  campanas: "Campañas",
};

/** Desde qué pantalla se carga el portal: decide qué consultas se disparan y cuáles son imprescindibles. */
export type PortalScope = "hoy" | OperationModuleKey;

const CORE_QUERY_NAMES = [
  "runtime_controls", "accounts", "contacts", "messages", "provider_events", "leads", "campaigns", "opportunities", "meetings",
  "tasks", "incidents", "mailbox_sync_cursors", "campaign_release_gates", "first_send_batches", "rollout_waves",
  "rollout_health_observations", "commercial_baselines", "payments",
] as const;
type CoreQueryName = (typeof CORE_QUERY_NAMES)[number];
type CoreResultLike = { data: unknown; count?: number | null; error: { code?: string; message?: string } | null };
const EMPTY_CORE: CoreResultLike = { data: null, count: null, error: null };

/**
 * Qué consultas necesita cada pantalla. Antes, cualquier pantalla disparaba las 18 consultas base más
 * 13 laterales a la vez contra una instancia Micro; si una sola tardaba más de 8 s (statement_timeout),
 * toda la pantalla caía con PORTAL_QUERY_FAILED:57014. Ahora cada pantalla pide solo lo suyo, y de eso
 * solo lo imprescindible tumba la pantalla; lo demás se degrada con aviso.
 */
const CORE_BY_SCOPE: Record<PortalScope, readonly CoreQueryName[]> = {
  hoy: CORE_QUERY_NAMES,
  alertas: ["incidents", "accounts", "contacts"],
  cadencia: [],
  respuestas: ["messages", "provider_events", "contacts", "accounts"],
  leads: ["leads", "accounts", "contacts"],
  empresas: ["accounts", "contacts"],
  infraestructura: ["runtime_controls", "mailbox_sync_cursors", "campaigns"],
  campanas: ["campaigns", "campaign_release_gates", "first_send_batches", "rollout_waves", "rollout_health_observations", "commercial_baselines", "runtime_controls"],
};
const ESSENTIAL_BY_SCOPE: Record<PortalScope, readonly CoreQueryName[]> = {
  hoy: ["runtime_controls", "messages", "leads", "meetings", "tasks", "opportunities", "payments"],
  alertas: ["incidents"],
  cadencia: [],
  respuestas: ["messages"],
  leads: ["leads"],
  empresas: ["accounts"],
  infraestructura: ["runtime_controls", "mailbox_sync_cursors"],
  campanas: ["campaigns"],
};
type SideGroup = "capacity" | "research" | "operations" | "cadence" | "provider";
const SIDE_BY_SCOPE: Record<PortalScope, readonly SideGroup[]> = {
  hoy: ["capacity", "research", "operations", "cadence", "provider"],
  alertas: ["operations"],
  cadencia: ["cadence"],
  respuestas: [],
  leads: [],
  empresas: ["research"],
  infraestructura: ["research", "provider", "operations"],
  campanas: ["operations", "provider"],
};
const SKIPPED: PromiseRejectedResult = { status: "rejected", reason: new Error("SKIPPED_FOR_SCOPE") };

export type PortalColumn = { key: string; label: string };
export type PortalRow = { id: string; values: Record<string, string>; status: string };

export type PortalModule = {
  title: string;
  description: string;
  emptyState: string;
  columns: PortalColumn[];
  rows: PortalRow[];
};

export type OperationsPortalSnapshot = {
  evidenceClass: "synthetic_demo" | "live";
  generatedAt: string;
  /** Consultas no imprescindibles que fallaron o se saltaron; la pantalla se muestra con aviso. */
  degraded: string[];
  realTruth: {
    newLeads: number;
    pendingReplies: number;
    meetingsToday: number;
    overdueTasks: number;
    contractualLeads: number;
    qualifiedPipeline: number;
    wonProjects: number;
    firstPaymentsMxn: number;
  };
  health: {
    killSwitch: boolean;
    externalSendAllowed: boolean;
    replySync: "HOLD" | "HEALTHY" | "DEGRADED";
    openP0: number;
    openP1: number;
    outboundProvider: {
      name: "Apollo";
      state: "BLOCKED" | "WARMING" | "READY" | "UNKNOWN";
      plan: string;
      domainsReady: number;
      domainsTarget: 2;
      mailboxesReady: number;
      mailboxesTarget: 3;
      warmupDays: number;
      warmupRequiredDays: 42;
      ownership: "ENNCO" | "TECKEL" | "THIRD_PARTY" | "UNKNOWN";
      releaseState: "HOLD" | "READY_FOR_CANARY";
      activationGatesPassed: number;
      activationGatesRequired: 15;
      liveGatesPassed: number;
      creditLimit: number | null;
      creditsConsumed: number | null;
      blockers: string[];
    };
    hybridOutbound: {
      state: "BLOCKED" | "READY" | "UNKNOWN";
      effectiveRelease: "HOLD" | "READY_FOR_CANARY" | "PAUSED" | "SCALE_ALLOWED" | "KILLED";
      primaryMailboxReady: boolean;
      primaryDailyCap: number;
      primaryDeliveries: number;
      isolatedMailboxesReady: number;
      isolatedMailboxesTarget: 3;
      isolatedWarmupDays: number[];
      minimumAccounts: 75;
      minimumContacts: 150;
      operationalAccounts: 150;
      operationalContacts: 300;
      verifiedAccounts: number;
      verifiedContacts: number;
      blockers: string[];
    };
    operations: {
      state: "HEALTHY" | "DEGRADED" | "UNKNOWN";
      reasonCode: string | null;
      lastWatchdogAt: string | null;
      operatorAssignment: "ACTIVE" | "UNKNOWN";
    };
    capacity: {
      state: "HEALTHY" | "WARNING" | "FULL" | "UNKNOWN";
      month: string;
      limit: number | null;
      committed: number;
      available: number | null;
      unscheduled: number;
      reasonCode: string | null;
    };
    research: {
      decision: "PASS" | "EXTEND" | "KILL" | "UNKNOWN";
      verifiedAccounts: number;
      targetAccounts: 75;
      verifiedContacts: number;
      targetContacts: 150;
      outreachState: "RESEARCH_ONLY_HOLD";
      outreachEligibleRecords: 0;
      blockers: string[];
    };
    cadence: ControlCadenceHealth;
  };
  nextActions: PortalRow[];
  modules: Record<OperationModuleKey, PortalModule>;
};

const sampleBadge = "SIMULACION";

function row(id: string, status: string, values: Record<string, string>): PortalRow {
  return { id, status, values };
}

export function getSyntheticOperationsPortal(): OperationsPortalSnapshot {
  const generatedAt = new Date().toISOString();
  const cadenceHealth = createUnknownControlCadenceHealth({
    reasonCode: "CONTROL_CADENCE_NOT_LIVE_IN_SYNTHETIC_DEMO",
    evaluatedAt: generatedAt,
  });
  const modules: Record<OperationModuleKey, PortalModule> = {
    alertas: {
      title: "Alertas e incidentes",
      description: "Riesgos operativos, reloj SLA y evidencia de recuperación. Desconocido nunca cuenta como verde.",
      emptyState: "No hay incidentes reales. El watchdog live permanece pendiente.",
      columns: [
        { key: "severidad", label: "Severidad" },
        { key: "incidente", label: "Incidente" },
        { key: "responsable", label: "Responsable" },
        { key: "sla", label: "SLA" },
        { key: "evidencia", label: "Evidencia" },
        { key: "accion", label: "Siguiente estado" },
      ],
      rows: [row("incident-synthetic-1", "SIMULACION", {
        severidad: "P0",
        incidente: "Supresión ignorada, ejemplo sintético",
        responsable: "Sin operador live asignado",
        sla: "Acuse máximo 15 minutos",
        evidencia: "Sin evento real ni entrega de alerta",
        accion: "Sin acción live",
      })],
    },
    cadencia: {
      title: "Cadencia del Control Room",
      description: "Las cinco cadencias se verifican por periodo. Evidencia automática, sesión humana, asistencia y entrega externa permanecen separadas.",
      emptyState: "No existe una lectura live completa de las cinco cadencias.",
      columns: [
        { key: "cadencia", label: "Cadencia" },
        { key: "configuracion", label: "Configuración" },
        { key: "responsable", label: "Responsable" },
        { key: "proxima", label: "Próxima ocurrencia" },
        { key: "vence", label: "Vence" },
        { key: "ejecucion", label: "Ejecución" },
        { key: "cumplimiento", label: "Cumplimiento" },
        { key: "evidencia", label: "Evidencia" },
        { key: "asistencia", label: "Asistencia" },
        { key: "entrega", label: "Entrega externa" },
        { key: "brecha", label: "Brecha" },
        { key: "siguiente", label: "Siguiente acción" },
      ],
      rows: buildControlCadenceRows(cadenceHealth),
    },
    respuestas: {
      title: "Bandeja de respuestas",
      description: "Ejemplos de cómo se detienen secuencias y se asigna una siguiente acción.",
      emptyState: "No hay respuestas reales.",
      columns: [
        { key: "cuenta", label: "Cuenta" },
        { key: "contacto", label: "Contacto" },
        { key: "clasificacion", label: "Clasificación" },
        { key: "siguiente", label: "Siguiente acción" },
      ],
      rows: [row("reply-synthetic-1", sampleBadge, {
        cuenta: "Planta Alfa, ejemplo anónimo",
        contacto: "Dirección de planta",
        clasificacion: "Positiva, pendiente de calificación estricta",
        siguiente: "Responder y registrar contexto en menos de 4 horas",
      })],
    },
    leads: {
      title: "Leads",
      description: "Una respuesta positiva entra capturada. Sólo cuenta cuando cumple todos los criterios contractuales.",
      emptyState: "No hay leads reales.",
      columns: [
        { key: "cuenta", label: "Cuenta" },
        { key: "origen", label: "Origen" },
        { key: "calificacion", label: "Calificación" },
        { key: "evidencia", label: "Evidencia" },
      ],
      rows: [row("lead-synthetic-1", sampleBadge, {
        cuenta: "Planta Alfa, ejemplo anónimo",
        origen: "Respuesta humana",
        calificacion: "CAPTURED, no contractual",
        evidencia: "Faltan capacidad, Anexo A, rol e interés verificables",
      })],
    },
    empresas: {
      title: "Empresas",
      description: "Workbench de investigación. Fuente, verificación, contactos y deduplicación permanecen separados del pipeline.",
      emptyState: "No hay empresas live cargadas en el portal.",
      columns: [
        { key: "empresa", label: "Empresa" },
        { key: "mercado", label: "Mercado" },
        { key: "evidencia", label: "Evidencia" },
        { key: "contactos", label: "Contactos" },
        { key: "dedupe", label: "Duplicados" },
        { key: "elegibilidad", label: "Elegibilidad" },
      ],
      rows: [row("account-synthetic-1", sampleBadge, {
        empresa: "Cuenta industrial sintética",
        mercado: "Guanajuato y Querétaro primero",
        evidencia: "UNVERIFIED",
        contactos: "0 verificados",
        dedupe: "Sin decisión live",
        elegibilidad: "RESEARCH_ONLY_HOLD",
      })],
    },
    infraestructura: {
      title: "Infraestructura comercial",
      description: "Propiedad, presupuesto, dominios, buzones y evidencia live. Un activo configurado no equivale a autorización.",
      emptyState: "No existe infraestructura ENNCO conectada.",
      columns: [
        { key: "control", label: "Control" },
        { key: "objetivo", label: "Objetivo" },
        { key: "estado", label: "Estado observado" },
        { key: "siguiente", label: "Siguiente acción" },
      ],
      rows: [
        row("infra-apollo", "HOLD", { control: "Apollo", objetivo: "Professional mensual, 1 asiento, propiedad ENNCO", estado: "No conectado", siguiente: "Aprobar compra y activar MFA" }),
        row("infra-domains", "HOLD", { control: "Dominios", objetivo: "2 independientes", estado: "0/2", siguiente: "Comprar los primeros dos candidatos aptos" }),
        row("infra-mailboxes", "HOLD", { control: "Buzones", objetivo: "4 Google Workspace", estado: "0/4", siguiente: "Crear, autenticar y calentar 42 días" }),
        row("infra-evidence", "HOLD", { control: "Gates live", objetivo: "15/15", estado: "0/15", siguiente: "Sustituir evidencia sintética por evidencia de proveedor" }),
      ],
    },
    campanas: {
      title: "Campañas",
      description: "Manifiesto, salud y gate. El envío externo permanece bloqueado.",
      emptyState: "No hay campañas live.",
      columns: [
        { key: "campana", label: "Campaña" },
        { key: "manifiesto", label: "Manifiesto" },
        { key: "canary", label: "Canary" },
        { key: "gates", label: "Gate de liberación" },
        { key: "lote", label: "Primer lote" },
        { key: "escalamiento", label: "Escalamiento" },
        { key: "t0", label: "T0" },
        { key: "envio", label: "Envío" },
      ],
      rows: [row("campaign-synthetic-1", sampleBadge, {
        campana: "Piloto CEO a CEO",
        manifiesto: "DRAFT",
        canary: "0/14 días reales",
        gates: "0/30 gates live",
        lote: "0 destinatarios reales",
        escalamiento: "M7 bloqueado. 0 olas live",
        t0: "0/100 entregas válidas",
        envio: "HOLD",
      })],
    },
  };

  return {
    evidenceClass: "synthetic_demo",
    generatedAt,
    degraded: [],
    realTruth: {
      newLeads: 0,
      pendingReplies: 0,
      meetingsToday: 0,
      overdueTasks: 0,
      contractualLeads: 0,
      qualifiedPipeline: 0,
      wonProjects: 0,
      firstPaymentsMxn: 0,
    },
    health: {
      killSwitch: true,
      externalSendAllowed: false,
      replySync: "HOLD",
      openP0: 10,
      openP1: 11,
      outboundProvider: {
        name: "Apollo",
        state: "UNKNOWN",
        plan: "Professional mensual pendiente de contratación",
        domainsReady: 0,
        domainsTarget: 2,
        mailboxesReady: 0,
        mailboxesTarget: 3,
        warmupDays: 0,
        warmupRequiredDays: 42,
        ownership: "UNKNOWN",
        releaseState: "HOLD",
        activationGatesPassed: 0,
        activationGatesRequired: 15,
        liveGatesPassed: 0,
        creditLimit: null,
        creditsConsumed: null,
        blockers: ["PROVIDER_NOT_CONNECTED_IN_SYNTHETIC_DEMO"],
      },
      operations: {
        state: "UNKNOWN",
        reasonCode: "WATCHDOG_NOT_LIVE_IN_SYNTHETIC_DEMO",
        lastWatchdogAt: null,
        operatorAssignment: "UNKNOWN",
      },
      capacity: {
        state: "UNKNOWN",
        month: "Sin mes operativo",
        limit: null,
        committed: 0,
        available: null,
        unscheduled: 0,
        reasonCode: "CAPACITY_NOT_CONFIGURED_IN_SYNTHETIC_DEMO",
      },
      research: {
        decision: "EXTEND",
        verifiedAccounts: 0,
        targetAccounts: 75,
        verifiedContacts: 0,
        targetContacts: 150,
        outreachState: "RESEARCH_ONLY_HOLD",
        outreachEligibleRecords: 0,
        blockers: [
          "RESEARCH_DATABASE_NOT_LIVE",
          "RESEARCH_ACCOUNT_TARGET_NOT_MET",
          "RESEARCH_CONTACT_TARGET_NOT_MET",
          "ANNEX_A_DATABASE_BINDING_PENDING",
        ],
      },
      hybridOutbound: {
        state: "UNKNOWN",
        effectiveRelease: "HOLD",
        primaryMailboxReady: false,
        primaryDailyCap: 0,
        primaryDeliveries: 0,
        isolatedMailboxesReady: 0,
        isolatedMailboxesTarget: 3,
        isolatedWarmupDays: [],
        minimumAccounts: 75,
        minimumContacts: 150,
        operationalAccounts: 150,
        operationalContacts: 300,
        verifiedAccounts: 0,
        verifiedContacts: 0,
        blockers: ["HYBRID_OUTBOUND_NOT_LIVE_IN_SYNTHETIC_DEMO"],
      },
      cadence: cadenceHealth,
    },
    nextActions: [
      row("next-annex", "BLOCKED_EXTERNAL", { objective: "Vincular en base las 3 empresas y sus 6 dominios bloqueados", due: "Antes de cargar destinatarios", owner: "Teckel Platform" }),
      row("next-privacy", "BLOCKED_EXTERNAL", { objective: "Aprobar aviso 2026-08-11-v1 ligado a SHA256", due: "Antes de publicación real", owner: "ENNCO + revisión legal" }),
      row("next-m9", "BLOCKED_EXTERNAL", { objective: "Ejecutar gates live de entrega y aceptación", due: "M9", owner: "ENNCO + Teckel" }),
    ],
    modules,
  };
}

type DbRecord = Record<string, unknown>;

function asRows(value: unknown): DbRecord[] {
  return Array.isArray(value) ? value.filter((item): item is DbRecord => Boolean(item) && typeof item === "object") : [];
}

function textValue(value: unknown, fallback = "Sin dato"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return fallback;
}

function dateValue(value: unknown): string {
  if (typeof value !== "string") return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const CONTROL_CADENCE_LABELS: Record<ControlCadenceCode, string> = {
  CONTROL_ROOM_DAILY_UPDATE: "Actualización automática diaria",
  INTERNAL_DAILY_REVIEW: "Revisión interna diaria",
  STAGING_WEEKLY_DEMO: "Demo semanal",
  ENNCO_TECKEL_WEEKLY_MEETING: "Reunión semanal ENNCO y Teckel",
  EXECUTIVE_MONTHLY_REVIEW: "Revisión ejecutiva mensual",
};

export function buildControlCadenceRows(health: ControlCadenceHealth): PortalRow[] {
  const byCode = new Map(health.cadences.map((item) => [item.code, item]));
  return CONTROL_CADENCE_CODES.map((code) => {
    const item = byCode.get(code);
    const unknown = health.state === "UNKNOWN" || !item;
    const status = unknown
      ? "UNKNOWN"
      : item.breach_severity ?? (item.compliance_status === "BREACHED" ? "BREACHED" : item.compliance_status);
    return row(`cadence-${code.toLowerCase()}`, status, {
      cadencia: CONTROL_CADENCE_LABELS[code],
      configuracion: unknown ? "UNKNOWN" : item.config_state,
      responsable: unknown || !item.owner_user_id ? "Sin responsable verificado" : `Usuario ${item.owner_user_id.slice(0, 8)}`,
      proxima: unknown || !item.next_occurrence_at ? "Sin horario verificado" : dateValue(item.next_occurrence_at),
      vence: unknown || !item.due_at ? "Sin vencimiento verificado" : dateValue(item.due_at),
      ejecucion: unknown ? "UNKNOWN" : item.execution_status,
      cumplimiento: unknown ? "UNKNOWN" : item.compliance_status,
      evidencia: unknown ? "UNKNOWN" : item.evidence_state,
      asistencia: unknown ? "UNKNOWN" : item.attendance_state,
      entrega: unknown ? "UNKNOWN" : item.delivery_state,
      brecha: unknown ? "UNKNOWN" : item.breach_severity ?? "Sin P0/P1",
      siguiente: unknown ? health.reason_code ?? "Verificar lectura completa" : item.next_action,
    });
  });
}

export function sumFirstPaymentsMxn(payments: Array<Record<string, unknown>>): number {
  return payments.reduce((total, payment) => {
    if (payment.is_first_payment !== true) return total;
    const amount = Number(payment.amount_mxn ?? 0);
    return Number.isFinite(amount) && amount > 0 ? total + amount : total;
  }, 0);
}

export function providerBlockersForHybridPlan(blockers: string[]): string[] {
  return blockers;
}

const STRICT_PIPELINE_STAGES = new Set([
  "QUALIFIED",
  "TECHNICAL_VISIT",
  "PROPOSAL",
  "DECISION",
]);

export function isStrictQualifiedOpportunity(opportunity: Record<string, unknown>): boolean {
  return STRICT_PIPELINE_STAGES.has(textValue(opportunity.stage, ""))
    && opportunity.economic_buyer === true
    && opportunity.active_pain === true
    && opportunity.business_impact === true
    && opportunity.timing_under_90_days === true
    && Number(opportunity.value_mxn ?? 0) > 0
    && Boolean(opportunity.next_action)
    && Boolean(opportunity.next_action_at);
}

export function isOpenIncident(incident: Record<string, unknown>): boolean {
  return !["RESOLVED", "REVIEWED"].includes(textValue(incident.status, "UNKNOWN"));
}

export function evaluateReplySync(
  cursors: Array<Record<string, unknown>>,
  evaluatedAt: Date,
  maximumLagMs = 5 * 60 * 1000,
): "HOLD" | "HEALTHY" | "DEGRADED" {
  if (cursors.length === 0) return "HOLD";
  if (cursors.some((cursor) => cursor.status === "ERROR")) return "DEGRADED";
  if (cursors.some((cursor) => cursor.status !== "READY")) return "HOLD";
  const evaluatedAtMs = evaluatedAt.getTime();
  if (!Number.isFinite(evaluatedAtMs) || maximumLagMs <= 0) return "DEGRADED";
  return cursors.every((cursor) => {
    const lastSyncedAt = new Date(textValue(cursor.last_synced_at, "invalid")).getTime();
    const watchExpiresAt = new Date(textValue(cursor.watch_expires_at, "invalid")).getTime();
    return Number.isFinite(lastSyncedAt)
      && Number.isFinite(watchExpiresAt)
      && lastSyncedAt <= evaluatedAtMs
      && evaluatedAtMs - lastSyncedAt <= maximumLagMs
      && watchExpiresAt > evaluatedAtMs;
  }) ? "HEALTHY" : "DEGRADED";
}

export async function loadOperationsPortal(access: OperationsAccessContext, options: { scope?: PortalScope } = {}): Promise<OperationsPortalSnapshot> {
  const scope: PortalScope = options.scope ?? "hoy";
  const sideWanted = new Set<SideGroup>(SIDE_BY_SCOPE[scope]);
  if (access.evidenceClass === "synthetic_demo") return getSyntheticOperationsPortal();
  if (!access.organizationId) throw new Error("PORTAL_ORGANIZATION_REQUIRED");

  const client = await createSupabaseServerClient();
  const organizationId = access.organizationId;
  const evaluatedAt = new Date().toISOString();
  const monthParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const capacityMonth = `${monthParts.find((part) => part.type === "year")?.value ?? "0000"}-${monthParts.find((part) => part.type === "month")?.value ?? "00"}-01`;
  const capacityPromise = !sideWanted.has("capacity") ? Promise.resolve([SKIPPED, SKIPPED] as const) : Promise.allSettled([
    client.from("opportunity_capacity_schedules").select("id,opportunity_id,execution_date,capacity_month,config_version").eq("organization_id", organizationId),
    client.rpc("evaluate_monthly_operational_capacity", {
      target_organization_id: organizationId,
      target_capacity_month: capacityMonth,
    }),
  ]);
  const researchPromise = !sideWanted.has("research") ? Promise.resolve([SKIPPED, SKIPPED, SKIPPED, SKIPPED] as const) : Promise.allSettled([
    client.from("accounts")
      .select("id,research_status,priority_market,research_state,research_coverage_exception_approved", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("is_deleted", false)
      .limit(500),
    client.from("research_contact_candidates")
      .select("id,account_id,role_category,research_status,promoted_contact_id", { count: "exact" })
      .eq("organization_id", organizationId)
      .limit(1000),
    client.from("research_dedupe_cases")
      .select("id,subject_type,source_record_id,candidate_account_id,matched_account_id,candidate_contact_id,matched_candidate_id,status", { count: "exact" })
      .eq("organization_id", organizationId)
      .limit(1000),
    client.rpc("assess_research_inventory", {
      target_organization_id: organizationId,
    }),
  ]);
  const operationsPromise = !sideWanted.has("operations") ? Promise.resolve([SKIPPED, SKIPPED, SKIPPED, SKIPPED] as const) : Promise.allSettled([
    client.from("approval_requests")
      .select("id,subject_type,subject_sha256,status,requested_by,requested_at,due_at,decided_by,decided_at")
      .eq("organization_id", organizationId)
      .order("requested_at", { ascending: false })
      .limit(100),
    client.from("operational_sla_cases")
      .select("id,case_type,subject_type,subject_id,severity,status,owner_user_id,backup_user_id,due_at,completed_at,breach_recorded_at")
      .eq("organization_id", organizationId)
      .order("due_at", { ascending: true })
      .limit(200),
    client.from("incidents")
      .select("id,severity,status,title,owner_user_id,incident_key,ack_due_at,containment_due_at,next_update_due_at,opened_at,acknowledged_at,contained_at,recovering_at,monitoring_at,resolved_at,reviewed_at,evidence_sha256,recovery_test_passed")
      .eq("organization_id", organizationId)
      .order("opened_at", { ascending: false })
      .limit(100),
    client.rpc("evaluate_operations_health", {
      target_organization_id: organizationId,
      target_evaluated_at: evaluatedAt,
    }),
  ]);
  const cadencePromise = !sideWanted.has("cadence") ? Promise.resolve([SKIPPED] as const) : Promise.allSettled([
    client.rpc("evaluate_control_cadence_health", {
      target_organization_id: organizationId,
      target_evaluated_at: evaluatedAt,
    }),
  ]);
  const providerPromise = !sideWanted.has("provider") ? Promise.resolve([SKIPPED, SKIPPED] as const) : Promise.allSettled([
    client.rpc("evaluate_outbound_provider_readiness", {
      target_organization_id: organizationId,
      target_evaluated_at: evaluatedAt,
    }),
    client.rpc("evaluate_hybrid_outbound_readiness", {
      target_organization_id: organizationId,
      target_evaluated_at: evaluatedAt,
    }),
  ]);
  const coreThunks: Record<CoreQueryName, () => PromiseLike<CoreResultLike>> = {
    runtime_controls: () => client.from("runtime_controls").select("global_kill_switch,external_send_allowed").eq("organization_id", organizationId).maybeSingle(),
    accounts: () => client.from("accounts").select("id,legal_name,state,sector,source_confidence,updated_at", { count: "exact" }).eq("organization_id", organizationId).eq("is_deleted", false).limit(200),
    contacts: () => client.from("contacts").select("id,account_id,full_name,role_title,verified,updated_at", { count: "exact" }).eq("organization_id", organizationId).eq("is_deleted", false).limit(300),
    messages: () => client.from("messages").select("id,contact_id,status,subject,body_text,created_at", { count: "exact" }).eq("organization_id", organizationId).eq("direction", "INBOUND").order("created_at", { ascending: false }).limit(100),
    provider_events: () => client.from("provider_events").select("id,message_id,event_kind,reply_classification,processing_status,observed_at").eq("organization_id", organizationId).order("observed_at", { ascending: false }).limit(100),
    leads: () => client.from("leads").select("id,account_id,contact_id,status,contractual_qualified,qualification_reason,created_at", { count: "exact" }).eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100),
    campaigns: () => client.from("campaigns").select("id,name,status,manifest_sha256,shadow_canary_decision,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100),
    opportunities: () => client.from("opportunities").select("id,account_id,stage,value_mxn,next_action,next_action_at,economic_buyer,active_pain,business_impact,timing_under_90_days").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100),
    meetings: () => client.from("meetings").select("id,opportunity_id,scheduled_at,held_at,attendance_verified").eq("organization_id", organizationId).order("scheduled_at", { ascending: true }).limit(100),
    tasks: () => client.from("tasks").select("id,account_id,contact_id,task_type,normalized_objective,owner_user_id,due_at,status").eq("organization_id", organizationId).order("due_at", { ascending: true }).limit(100),
    incidents: () => client.from("incidents").select("id,severity,status,title,owner_user_id,opened_at").eq("organization_id", organizationId).order("opened_at", { ascending: false }).limit(100),
    mailbox_sync_cursors: () => client.from("mailbox_sync_cursors").select("mailbox_id,status,last_synced_at,last_error_code,watch_expires_at").eq("organization_id", organizationId),
    campaign_release_gates: () => client.from("campaign_release_gates").select("id,campaign_id,gate_code,status,evidence_class,observed_at,valid_until").eq("organization_id", organizationId).order("gate_code", { ascending: true }),
    first_send_batches: () => client.from("first_send_batches").select("id,campaign_id,status,recipient_count,account_count,scheduled_for,approved_at,released_at,killed_at,kill_reason_code").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    rollout_waves: () => client.from("rollout_waves").select("id,campaign_id,wave_number,status,planned_recipient_count,scheduled_for,previous_observation_id,passed_at,extended_at,killed_at").eq("organization_id", organizationId).order("wave_number", { ascending: false }),
    rollout_health_observations: () => client.from("rollout_health_observations").select("id,campaign_id,source_kind,source_id,decision,evidence_class,delivered_count,hard_bounce_count,spam_complaint_count,unknown_count,observed_at").eq("organization_id", organizationId).order("observed_at", { ascending: false }),
    commercial_baselines: () => client.from("commercial_baselines").select("id,campaign_id,valid_first_deliveries,substantive_replies,positive_replies,strict_leads,held_meetings,qualified_opportunities,cutoff_at,evidence_class").eq("organization_id", organizationId).order("cutoff_at", { ascending: false }),
    payments: () => client.from("payments").select("id,opportunity_id,amount_mxn,paid_at,is_first_payment").eq("organization_id", organizationId).eq("is_first_payment", true),
  };
  const coreWanted = new Set<CoreQueryName>(CORE_BY_SCOPE[scope]);
  const coreEssential = new Set<CoreQueryName>(ESSENTIAL_BY_SCOPE[scope]);
  const settledCore = await Promise.allSettled(CORE_QUERY_NAMES.map((name) => (coreWanted.has(name) ? coreThunks[name]() : Promise.resolve(EMPTY_CORE))));
  const degraded: string[] = [];
  const results = CORE_QUERY_NAMES.map((name, index): CoreResultLike => {
    const entry = settledCore[index];
    if (entry && entry.status === "fulfilled" && !entry.value.error) return entry.value;
    const code = entry?.status === "fulfilled" ? entry.value.error?.code ?? "UNKNOWN" : "EXCEPTION";
    if (coreEssential.has(name)) throw new Error(`PORTAL_QUERY_FAILED:${code}:${name}`);
    degraded.push(name);
    return EMPTY_CORE;
  }) as unknown as readonly [CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike, CoreResultLike];

  const [controlsResult, accountsResult, contactsResult, messagesResult, eventsResult, leadsResult, campaignsResult, opportunitiesResult, meetingsResult, tasksResult, incidentsResult, cursorsResult, releaseGatesResult, firstSendBatchesResult, rolloutWavesResult, rolloutHealthResult, baselinesResult, paymentsResult] = results;
  const [capacitySchedulesSettled, capacityEvaluationSettled] = await capacityPromise;
  for (const group of ["capacity", "research", "operations", "cadence", "provider"] as const) if (!sideWanted.has(group)) degraded.push(`${group} (no aplica a esta pantalla)`);
  const [researchAccountsSettled, researchCandidatesSettled, researchDedupeSettled, researchAssessmentSettled] = await researchPromise;
  const [approvalRequestsSettled, operationalSlaSettled, operationsIncidentsSettled, operationsHealthSettled] = await operationsPromise;
  const [cadenceHealthSettled] = await cadencePromise;
  const [providerReadinessSettled, hybridReadinessSettled] = await providerPromise;
  const capacitySchedulesResult = capacitySchedulesSettled.status === "fulfilled" && !capacitySchedulesSettled.value.error
    ? capacitySchedulesSettled.value
    : null;
  const capacityEvaluationResult = capacityEvaluationSettled.status === "fulfilled" && !capacityEvaluationSettled.value.error
    ? capacityEvaluationSettled.value
    : null;
  const researchAccountsResult = researchAccountsSettled.status === "fulfilled" && !researchAccountsSettled.value.error
    ? researchAccountsSettled.value
    : null;
  const researchCandidatesResult = researchCandidatesSettled.status === "fulfilled" && !researchCandidatesSettled.value.error
    ? researchCandidatesSettled.value
    : null;
  const researchDedupeResult = researchDedupeSettled.status === "fulfilled" && !researchDedupeSettled.value.error
    ? researchDedupeSettled.value
    : null;
  const researchAssessmentResult = researchAssessmentSettled.status === "fulfilled" && !researchAssessmentSettled.value.error
    ? researchAssessmentSettled.value
    : null;
  const approvalRequestsResult = approvalRequestsSettled.status === "fulfilled" && !approvalRequestsSettled.value.error
    ? approvalRequestsSettled.value
    : null;
  const operationalSlaResult = operationalSlaSettled.status === "fulfilled" && !operationalSlaSettled.value.error
    ? operationalSlaSettled.value
    : null;
  const operationsIncidentsResult = operationsIncidentsSettled.status === "fulfilled" && !operationsIncidentsSettled.value.error
    ? operationsIncidentsSettled.value
    : null;
  const operationsHealthRaw = operationsHealthSettled.status === "fulfilled" && !operationsHealthSettled.value.error
    ? operationsHealthSettled.value.data
    : null;
  const operationsHealthParsed = operationsHealthResultSchema.safeParse(operationsHealthRaw);
  const operationsReadReady = approvalRequestsResult !== null
    && operationalSlaResult !== null
    && operationsIncidentsResult !== null
    && operationsHealthParsed.success;
  const cadenceRpcAvailable = cadenceHealthSettled.status === "fulfilled" && !cadenceHealthSettled.value.error;
  const cadenceHealth = parseControlCadenceReadModel({
    rpcAvailable: cadenceRpcAvailable,
    rpcData: cadenceRpcAvailable ? cadenceHealthSettled.value.data : null,
    expectedOrganizationId: organizationId,
    evaluatedAt,
  });
  const providerRpcAvailable = providerReadinessSettled.status === "fulfilled"
    && !providerReadinessSettled.value.error;
  const providerReadiness = parseOutboundProviderReadiness({
    rpcAvailable: providerRpcAvailable,
    rpcData: providerRpcAvailable ? providerReadinessSettled.value.data : null,
    expectedOrganizationId: organizationId,
    evaluatedAt,
  });
  const hybridRpcAvailable = hybridReadinessSettled.status === "fulfilled"
    && !hybridReadinessSettled.value.error;
  const hybridReadiness = parseHybridOutboundReadiness({
    rpcAvailable: hybridRpcAvailable,
    rpcData: hybridRpcAvailable ? hybridReadinessSettled.value.data : null,
    expectedOrganizationId: organizationId,
    evaluatedAt,
  });
  const primaryMailboxReadiness = hybridReadiness.mailboxes.find((mailbox) =>
    mailbox.route === "EXISTING_PRIMARY_GMAIL_RAMP");
  const isolatedMailboxReadiness = hybridReadiness.mailboxes.filter((mailbox) =>
    mailbox.route === "NEW_ISOLATED_MAILBOX_WARMUP");
  const accounts = asRows(accountsResult.data);
  const contacts = asRows(contactsResult.data);
  const messages = asRows(messagesResult.data);
  const events = asRows(eventsResult.data);
  const releaseGates = asRows(releaseGatesResult.data);
  const firstSendBatches = asRows(firstSendBatchesResult.data);
  const rolloutWaves = asRows(rolloutWavesResult.data);
  const rolloutHealth = asRows(rolloutHealthResult.data);
  const baselines = asRows(baselinesResult.data);
  const firstPayments = asRows(paymentsResult.data);
  const capacityReadModel = parseCapacityReadModel({
    schedulesAvailable: capacitySchedulesResult !== null,
    schedulesData: capacitySchedulesResult?.data,
    evaluationAvailable: capacityEvaluationResult !== null,
    evaluationData: capacityEvaluationResult?.data,
  });
  const capacityEvaluation = capacityReadModel.evaluation;
  const researchReadModel = parseResearchPortalReadModel({
    accountsAvailable: researchAccountsResult !== null,
    accountsData: researchAccountsResult?.data,
    accountsCount: researchAccountsResult?.count ?? null,
    candidatesAvailable: researchCandidatesResult !== null,
    candidatesData: researchCandidatesResult?.data,
    candidatesCount: researchCandidatesResult?.count ?? null,
    dedupeAvailable: researchDedupeResult !== null,
    dedupeData: researchDedupeResult?.data,
    dedupeCount: researchDedupeResult?.count ?? null,
    assessmentAvailable: researchAssessmentResult !== null,
    assessmentData: researchAssessmentResult?.data,
  });
  const researchCandidates = researchReadModel.candidates;
  const researchDedupeCases = researchReadModel.dedupeCases;
  const researchAssessment = researchReadModel.assessment;
  const researchAccountById = new Map(researchReadModel.accounts.map((item) => [item.id, item]));
  const leads = asRows(leadsResult.data);
  const opportunities = asRows(opportunitiesResult.data);
  const meetings = asRows(meetingsResult.data);
  const tasks = asRows(tasksResult.data);
  const incidents = operationsReadReady ? asRows(operationsIncidentsResult?.data) : asRows(incidentsResult.data);
  const operationalSlaCases = operationsReadReady ? asRows(operationalSlaResult?.data) : [];
  const operationsHealth = operationsReadReady && operationsHealthParsed.success ? operationsHealthParsed.data : null;
  const controls = controlsResult.data as DbRecord | null;
  const accountById = new Map(accounts.map((item) => [textValue(item.id), item]));
  const contactById = new Map(contacts.map((item) => [textValue(item.id), item]));
  const eventByMessageId = new Map(events.map((item) => [textValue(item.message_id), item]));
  const accountName = (accountId: unknown) => textValue(accountById.get(textValue(accountId))?.legal_name);
  const contactName = (contactId: unknown) => textValue(contactById.get(textValue(contactId))?.full_name);
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const replyRows = messages.map((message) => {
    const event = eventByMessageId.get(textValue(message.id));
    const contact = contactById.get(textValue(message.contact_id));
    return row(textValue(event?.id, textValue(message.id)), textValue(event?.processing_status, textValue(message.status)), {
      cuenta: accountName(contact?.account_id),
      contacto: contactName(message.contact_id),
      clasificacion: textValue(event?.reply_classification, "Sin revisar"),
      siguiente: `Recibida ${dateValue(message.created_at)}. ${textValue(message.subject, "Sin asunto")}`,
      reviewable: event?.event_kind === "REPLY" && event?.reply_classification === "UNREVIEWED" ? "true" : "false",
    });
  });
  const leadRows = leads.map((lead) => row(textValue(lead.id), textValue(lead.status), {
    cuenta: accountName(lead.account_id),
    origen: "Correo o captación",
    calificacion: lead.contractual_qualified === true ? "Contractual verificado" : "No contractual",
    evidencia: textValue(lead.qualification_reason, "Pendiente"),
    qualified: lead.contractual_qualified === true ? "true" : "false",
  }));
  const researchInventoryAvailable = researchReadModel.inventoryReady;
  const researchDecision = researchAssessment?.decision ?? "UNKNOWN";
  const researchBlockers = researchAssessment?.blockers ?? [researchReadModel.reasonCode ?? "RESEARCH_READ_MODEL_UNAVAILABLE"];
  const accountRows = accounts.map((account) => {
    const accountId = textValue(account.id);
    const researchAccount = researchAccountById.get(accountId);
    const candidates = researchCandidates.filter((candidate) => textValue(candidate.account_id) === accountId);
    const promotedCandidates = candidates.filter((candidate) => candidate.research_status === "PROMOTED" && candidate.promoted_contact_id !== null);
    const openDedupe = researchDedupeCases.filter((candidate) =>
      candidate.status === "OPEN"
      && (textValue(candidate.candidate_account_id, "") === accountId || textValue(candidate.matched_account_id, "") === accountId));
    return row(accountId, textValue(researchAccount?.research_status, "UNKNOWN"), {
      empresa: textValue(account.legal_name),
      mercado: `${textValue(researchAccount?.research_state, textValue(account.state))}. ${textValue(researchAccount?.priority_market, "EXPANSION_HOLD")}`,
      evidencia: `${textValue(researchAccount?.research_status, "UNKNOWN")}. ${textValue(account.source_confidence, "UNVERIFIED")}`,
      contactos: researchInventoryAvailable ? `${promotedCandidates.length} promovidos de ${candidates.length} candidatos` : "Inventario no disponible",
      dedupe: researchInventoryAvailable ? (openDedupe.length > 0 ? `${openDedupe.length} casos abiertos` : "Sin casos abiertos") : "UNKNOWN",
      elegibilidad: "RESEARCH_ONLY_HOLD. 0 autorizados",
    });
  });
  const campaignRows = asRows(campaignsResult.data).map((campaign) => {
    const campaignId = textValue(campaign.id);
    const gates = releaseGates.filter((gate) => textValue(gate.campaign_id) === campaignId);
    const passedGates = gates.filter((gate) => gate.status === "PASS" && gate.evidence_class === "live").length;
    const batch = firstSendBatches.find((candidate) => textValue(candidate.campaign_id) === campaignId);
    const wave = rolloutWaves.find((candidate) => textValue(candidate.campaign_id) === campaignId);
    const health = rolloutHealth.find((candidate) => textValue(candidate.campaign_id) === campaignId);
    const baseline = baselines.find((candidate) => textValue(candidate.campaign_id) === campaignId);
    const runtimeOpen = controls?.external_send_allowed === true && controls?.global_kill_switch === false;
    const operationsOpen = operationsReadReady && operationsHealth?.state === "HEALTHY"
      && operationsHealth.operator_assignment === "ACTIVE";
    const releaseReady = gates.length === 30 && passedGates === 30
      && (batch?.status === "READY" || wave?.status === "READY");
    return row(campaignId, textValue(campaign.status), {
      campana: textValue(campaign.name),
      manifiesto: textValue(campaign.manifest_sha256).slice(0, 12),
      canary: textValue(campaign.shadow_canary_decision, "Pendiente"),
      gates: `${passedGates}/${gates.length || 30} gates live`,
      lote: batch ? `${textValue(batch.status)}. ${textValue(batch.recipient_count, "0")} destinatarios` : "Sin lote aprobado",
      escalamiento: wave
        ? `Ola ${textValue(wave.wave_number)} ${textValue(wave.status)}. Salud ${textValue(health?.decision, "UNKNOWN")}`
        : "Sin ola liberada",
      t0: baseline
        ? `${textValue(baseline.valid_first_deliveries)}/100. ${textValue(baseline.strict_leads, "0")} leads estrictos`
        : "T0 no congelado",
      envio: runtimeOpen && operationsOpen && isHybridOutboundReleaseAllowed(hybridReadiness) && releaseReady
        ? "LISTO EN VENTANA"
        : "HOLD",
    });
  });
  const strictQualifiedOpportunities = opportunities.filter(isStrictQualifiedOpportunity);
  const incidentActionByStatus: Record<string, string> = {
    OPEN: "ACKNOWLEDGE",
    ACKNOWLEDGED: "CONTAIN",
    CONTAINED: "RECOVER",
    RECOVERING: "MONITOR",
    MONITORING: "RESOLVE",
    RESOLVED: "REVIEW",
  };
  const incidentRows = incidents.map((incident) => {
    const action = incidentActionByStatus[textValue(incident.status, "UNKNOWN")] ?? "";
    return row(textValue(incident.id), textValue(incident.status), {
      severidad: textValue(incident.severity),
      incidente: textValue(incident.title),
      responsable: incident.owner_user_id ? `Operador ${textValue(incident.owner_user_id).slice(0, 8)}` : "Sin operador asignado",
      sla: incident.severity === "P0"
        ? `Acuse ${dateValue(incident.ack_due_at)}`
        : incident.severity === "P1" ? `Contención ${dateValue(incident.containment_due_at)}` : "Seguimiento operativo",
      evidencia: incident.evidence_sha256 ? `SHA256 ${textValue(incident.evidence_sha256).slice(0, 12)}` : `Abierto ${dateValue(incident.opened_at)}`,
      accion: action || "Ciclo terminado",
      action,
      actionable: operationsReadReady && action ? "true" : "false",
    });
  });
  const overdueTasks = tasks.filter((task) => task.status === "OPEN" && new Date(textValue(task.due_at, "2999-01-01")).getTime() < Date.now());
  const openP0 = incidents.filter((incident) => incident.severity === "P0" && isOpenIncident(incident)).length;
  const openP1 = incidents.filter((incident) => incident.severity === "P1" && isOpenIncident(incident)).length;
  const cursors = asRows(cursorsResult.data);
  const replySync = evaluateReplySync(cursors, today);
  const contractualLeads = leads.filter((lead) => lead.contractual_qualified === true).length;
  const wonProjects = opportunities.filter((opportunity) => opportunity.stage === "CLOSED_WON").length;
  const firstPaymentsMxn = sumFirstPaymentsMxn(firstPayments);
  const taskActionRows = tasks.filter((task) => task.status === "OPEN").map((task) => row(textValue(task.id), textValue(task.status), {
    objective: textValue(task.normalized_objective),
    due: dateValue(task.due_at),
    due_iso: textValue(task.due_at, "2999-01-01T00:00:00Z"),
    owner: task.owner_user_id ? `Operador ${textValue(task.owner_user_id).slice(0, 8)}` : "Sin operador asignado",
    assignable: task.owner_user_id ? "false" : "true",
    completable: task.owner_user_id ? "true" : "false",
  }));
  const slaActionRows = operationalSlaCases.filter((item) => item.status === "OPEN" || item.status === "BREACHED").map((item) => row(textValue(item.id), textValue(item.status), {
    objective: `SLA ${textValue(item.case_type)}`,
    due: dateValue(item.due_at),
    due_iso: textValue(item.due_at, "2999-01-01T00:00:00Z"),
    owner: item.owner_user_id ? `Operador ${textValue(item.owner_user_id).slice(0, 8)}` : "Sin operador asignado",
    completable: "false",
  }));
  const nextActionRows = [...slaActionRows, ...taskActionRows]
    .sort((left, right) => new Date(left.values.due_iso ?? 0).getTime() - new Date(right.values.due_iso ?? 0).getTime())
    .slice(0, 8);

  const providerOwnership = providerReadiness.ownership === "ENNCO_OWNED"
    ? "ENNCO"
    : providerReadiness.ownership === "TECKEL_OWNED"
      ? "TECKEL"
      : providerReadiness.ownership === "THIRD_PARTY" ? "THIRD_PARTY" : "UNKNOWN";
  const providerDisplayBlockers = providerBlockersForHybridPlan(providerReadiness.blockers);
  const providerInfrastructureRows: PortalRow[] = [
    row("hybrid-primary-mailbox", primaryMailboxReadiness?.state ?? "UNKNOWN", {
      control: "Carril acelerado Tier 1",
      objetivo: "contacto@ennco.com.mx. Gmail API. Máximo 50 cuentas y 20 correos diarios",
      estado: primaryMailboxReadiness
        ? `${primaryMailboxReadiness.effective_release}. ${primaryMailboxReadiness.valid_deliveries} entregas. Cap ${primaryMailboxReadiness.daily_cap}/día`
        : "Sin lectura live",
      siguiente: primaryMailboxReadiness?.state === "READY"
        ? "Congelar canary exacto de cinco empresas"
        : "Completar DKIM, seeds, OAuth, reply sync y manifiesto",
    }),
    row("hybrid-isolated-mailboxes", hybridReadiness.isolated_mailboxes_ready === 3 ? "PASS" : "WARMING", {
      control: "Carril escalable aislado",
      objetivo: "3 buzones en enncoindustrial.com y enncoenergia.com",
      estado: `${hybridReadiness.isolated_mailboxes_ready}/3 listos. Warmup ${isolatedMailboxReadiness.map((mailbox) => `${mailbox.normalized_email} ${mailbox.warmup_days}/42`).join("; ") || "sin evidencia"}`,
      siguiente: hybridReadiness.isolated_mailboxes_ready === 3
        ? "Preparar canary aislado"
        : "Completar 42 días sin prospectos",
    }),
    row("hybrid-inventory", hybridReadiness.inventory.verified_contacts >= 300 ? "PASS" : "EXTEND", {
      control: "Inventario comercial",
      objetivo: "Mínimo 75/150. Meta operativa 150/300",
      estado: `${hybridReadiness.inventory.verified_accounts}/${hybridReadiness.inventory.operational_accounts} empresas. ${hybridReadiness.inventory.verified_contacts}/${hybridReadiness.inventory.operational_contacts} contactos`,
      siguiente: "Guanajuato y Querétaro primero, dos roles por cuenta cuando sea posible",
    }),
    row("provider-account", providerReadiness.state, {
      control: "Cuenta Apollo",
      objetivo: "Workspace Teckel dedicado exclusivamente a ENNCO, identidad Francisco Cuellar",
      estado: `${providerReadiness.plan}. Custodia ${providerOwnership}. ${providerReadiness.workspace_mode}`,
      siguiente: providerReadiness.provider_account_id ? "Verificar identidad, team ID y archivo Teckel" : "Registrar el workspace Apollo reconvertido",
    }),
    row("provider-domains", providerReadiness.domains_ready === 2 ? "PASS" : "HOLD", {
      control: "Dominios de outreach",
      objetivo: "2 dominios administrados por Apollo: enncoindustrial.com y enncoenergia.com",
      estado: `${providerReadiness.domains_ready}/${providerReadiness.domains_target} listos`,
      siguiente: providerReadiness.domains_ready === 2 ? "Monitorear reputación" : "Comprar en Apollo e iniciar autenticación",
    }),
    row("provider-mailboxes", hybridReadiness.isolated_mailboxes_ready === 3 ? "PASS" : "WARMING", {
      control: "Buzones aislados Apollo",
      objetivo: "3 buzones aprobados. El cuarto está diferido hasta 100 entregas válidas",
      estado: `${hybridReadiness.isolated_mailboxes_ready}/3 listos`,
      siguiente: hybridReadiness.isolated_mailboxes_ready === 3 ? "Mantener salud diaria" : "Provisionar y completar warmup de 42 días",
    }),
    row("provider-budget", providerReadiness.credit_limit !== null ? "PASS" : "HOLD", {
      control: "Presupuesto Apollo",
      objetivo: "300 investigación, 3,600 infraestructura, buffer mínimo 110, cero teléfonos",
      estado: providerReadiness.credit_limit === null
        ? "Sin lectura live"
        : `${providerReadiness.credits_consumed ?? 0}/${providerReadiness.credit_limit} créditos`,
      siguiente: "Revisar consumo por contacto exacto",
    }),
    row("provider-gates", providerReadiness.release_state, {
      control: "Gates de activación",
      objetivo: "15/15 PASS con evidencia live",
      estado: `${providerReadiness.activation_gates_passed}/15 totales. ${providerReadiness.live_gates_passed}/15 live`,
      siguiente: providerReadiness.release_state === "READY_FOR_CANARY" ? "Congelar manifiesto" : "Cerrar evidencia faltante",
    }),
    ...providerDisplayBlockers.map((blocker, index) => row(`provider-blocker-${index + 1}`, "HOLD", {
      control: `Bloqueador ${index + 1}`,
      objetivo: blocker,
      estado: "HOLD",
      siguiente: providerBlockerLabel(blocker),
    })),
    ...hybridReadiness.blockers.map((blocker, index) => row(`hybrid-blocker-${index + 1}`, "HOLD", {
      control: `Bloqueador híbrido ${index + 1}`,
      objetivo: blocker,
      estado: "HOLD",
      siguiente: hybridBlockerLabel(blocker),
    })),
  ];

  const base = getSyntheticOperationsPortal();
  return {
    evidenceClass: "live",
    generatedAt: new Date().toISOString(),
    degraded,
    realTruth: {
      newLeads: leads.filter((lead) => new Date(textValue(lead.created_at, "1970-01-01")).getTime() >= dayStart.getTime()).length,
      pendingReplies: replyRows.filter((reply) => reply.values.reviewable === "true").length,
      meetingsToday: meetings.filter((meeting) => {
        const scheduled = new Date(textValue(meeting.scheduled_at, "1970-01-01"));
        return scheduled >= dayStart && scheduled.getTime() < dayStart.getTime() + 24 * 60 * 60 * 1000;
      }).length,
      overdueTasks: overdueTasks.length,
      contractualLeads,
      qualifiedPipeline: strictQualifiedOpportunities.length,
      wonProjects,
      firstPaymentsMxn,
    },
    health: {
      killSwitch: controls?.global_kill_switch !== false,
      externalSendAllowed: isHybridOutboundReleaseAllowed(hybridReadiness)
        && isExternalSendAllowedWithCadence(controls?.external_send_allowed === true
        && controls?.global_kill_switch === false
        && operationsReadReady
        && operationsHealth?.state === "HEALTHY"
        && operationsHealth.operator_assignment === "ACTIVE", cadenceHealth),
      replySync,
      openP0: operationsHealth?.open_p0 ?? openP0,
      openP1: operationsHealth?.open_p1 ?? openP1,
      outboundProvider: {
        name: "Apollo",
        state: providerReadiness.state,
        plan: providerReadiness.plan,
        domainsReady: providerReadiness.domains_ready,
        domainsTarget: 2,
        mailboxesReady: hybridReadiness.isolated_mailboxes_ready,
        mailboxesTarget: 3,
        warmupDays: providerReadiness.warmup_days,
        warmupRequiredDays: 42,
        ownership: providerOwnership,
        releaseState: providerReadiness.release_state,
        activationGatesPassed: providerReadiness.activation_gates_passed,
        activationGatesRequired: 15,
        liveGatesPassed: providerReadiness.live_gates_passed,
        creditLimit: providerReadiness.credit_limit,
        creditsConsumed: providerReadiness.credits_consumed,
        blockers: providerDisplayBlockers,
      },
      hybridOutbound: {
        state: hybridReadiness.state,
        effectiveRelease: hybridReadiness.effective_release,
        primaryMailboxReady: hybridReadiness.primary_mailbox_ready,
        primaryDailyCap: primaryMailboxReadiness?.daily_cap ?? 0,
        primaryDeliveries: primaryMailboxReadiness?.valid_deliveries ?? 0,
        isolatedMailboxesReady: hybridReadiness.isolated_mailboxes_ready,
        isolatedMailboxesTarget: 3,
        isolatedWarmupDays: isolatedMailboxReadiness.map((mailbox) => mailbox.warmup_days),
        minimumAccounts: 75,
        minimumContacts: 150,
        operationalAccounts: 150,
        operationalContacts: 300,
        verifiedAccounts: hybridReadiness.inventory.verified_accounts,
        verifiedContacts: hybridReadiness.inventory.verified_contacts,
        blockers: hybridReadiness.blockers,
      },
      operations: {
        state: operationsHealth?.state ?? "UNKNOWN",
        reasonCode: operationsHealth?.reason_code ?? (operationsReadReady ? null : "OPERATIONS_READ_MODEL_UNAVAILABLE"),
        lastWatchdogAt: operationsHealth?.last_watchdog_at ?? null,
        operatorAssignment: operationsHealth?.operator_assignment ?? "UNKNOWN",
      },
      capacity: {
        state: capacityEvaluation?.state ?? "UNKNOWN",
        month: capacityEvaluation?.capacity_month ?? capacityMonth,
        limit: capacityEvaluation?.monthly_limit ?? null,
        committed: capacityEvaluation?.committed_projects ?? 0,
        available: capacityEvaluation?.available_projects ?? null,
        unscheduled: capacityEvaluation?.unscheduled_closed_won_projects ?? 0,
        reasonCode: capacityEvaluation?.reason_code
          ?? capacityReadModel.reasonCode,
      },
      research: {
        decision: researchDecision,
        verifiedAccounts: researchAssessment?.verified_accounts ?? 0,
        targetAccounts: 75,
        verifiedContacts: researchAssessment?.verified_contacts ?? 0,
        targetContacts: 150,
        outreachState: "RESEARCH_ONLY_HOLD",
        outreachEligibleRecords: 0,
        blockers: researchBlockers,
      },
      cadence: cadenceHealth,
    },
    nextActions: nextActionRows,
    modules: {
      ...base.modules,
      alertas: { ...base.modules.alertas, rows: incidentRows },
      cadencia: { ...base.modules.cadencia, rows: buildControlCadenceRows(cadenceHealth) },
      respuestas: { ...base.modules.respuestas, rows: replyRows },
      leads: { ...base.modules.leads, rows: leadRows },
      empresas: { ...base.modules.empresas, rows: accountRows },
      infraestructura: { ...base.modules.infraestructura, rows: providerInfrastructureRows },
      campanas: { ...base.modules.campanas, rows: campaignRows },
    },
  };
}

export function isOperationModuleKey(value: string): value is OperationModuleKey {
  return (OPERATION_MODULE_KEYS as readonly string[]).includes(value);
}
