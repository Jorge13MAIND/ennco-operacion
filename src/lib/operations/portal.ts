import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { INITIAL_MILESTONES } from "@/lib/control-room/snapshot";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const OPERATION_MODULE_KEYS = [
  "respuestas",
  "leads",
  "empresas",
  "precotizaciones",
  "campanas",
  "pipeline",
  "roadmap",
  "aprobaciones",
  "reportes",
  "exportaciones",
] as const;

export type OperationModuleKey = (typeof OPERATION_MODULE_KEYS)[number];

export const OPERATION_MODULE_LABELS: Record<OperationModuleKey, string> = {
  respuestas: "Respuestas",
  leads: "Leads",
  empresas: "Empresas",
  precotizaciones: "Precotizaciones",
  campanas: "Campañas",
  pipeline: "Pipeline",
  roadmap: "Roadmap",
  aprobaciones: "Aprobaciones",
  reportes: "Reportes",
  exportaciones: "Exportaciones",
};

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
  };
  nextActions: PortalRow[];
  modules: Record<OperationModuleKey, PortalModule>;
};

const sampleBadge = "SIMULACION";

function row(id: string, status: string, values: Record<string, string>): PortalRow {
  return { id, status, values };
}

export function getSyntheticOperationsPortal(): OperationsPortalSnapshot {
  const modules: Record<OperationModuleKey, PortalModule> = {
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
      description: "Inventario con fuente, confianza y estado de elegibilidad separados del pipeline.",
      emptyState: "No hay empresas live cargadas en el portal.",
      columns: [
        { key: "empresa", label: "Empresa" },
        { key: "ubicacion", label: "Ubicación" },
        { key: "confianza", label: "Confianza" },
        { key: "elegibilidad", label: "Elegibilidad" },
      ],
      rows: [row("account-synthetic-1", sampleBadge, {
        empresa: "Cuenta industrial sintética",
        ubicacion: "León, Guanajuato",
        confianza: "UNVERIFIED",
        elegibilidad: "HOLD hasta fuente y supresión",
      })],
    },
    precotizaciones: {
      title: "Precotizaciones",
      description: "Folios, versión del modelo y estado de revisión. Ningún rango es precio contractual.",
      emptyState: "No hay precotizaciones reales.",
      columns: [
        { key: "folio", label: "Folio" },
        { key: "necesidad", label: "Necesidad" },
        { key: "modelo", label: "Modelo" },
        { key: "estado", label: "Estado" },
      ],
      rows: [row("prequote-synthetic-1", sampleBadge, {
        folio: "ENN-PRE-DEMO0001",
        necesidad: "Solar nuevo",
        modelo: "ENNCO-PREQ-2026-08-DRAFT-02",
        estado: "Revisión técnica requerida",
      })],
    },
    campanas: {
      title: "Campañas",
      description: "Manifiesto, salud y gate. El envío externo permanece bloqueado.",
      emptyState: "No hay campañas live.",
      columns: [
        { key: "campana", label: "Campaña" },
        { key: "manifiesto", label: "Manifiesto" },
        { key: "canary", label: "Canary" },
        { key: "envio", label: "Envío" },
      ],
      rows: [row("campaign-synthetic-1", sampleBadge, {
        campana: "Piloto CEO a CEO",
        manifiesto: "DRAFT",
        canary: "Pendiente",
        envio: "BLOQUEADO",
      })],
    },
    pipeline: {
      title: "Pipeline estricto",
      description: "Sólo aparecen oportunidades con comprador, dolor, impacto, plazo, valor y siguiente acción.",
      emptyState: "No hay pipeline estricto real.",
      columns: [
        { key: "cuenta", label: "Cuenta" },
        { key: "etapa", label: "Etapa" },
        { key: "valor", label: "Valor" },
        { key: "siguiente", label: "Siguiente acción" },
      ],
      rows: [],
    },
    roadmap: {
      title: "Roadmap E2E",
      description: "Estado, gate, bloqueador y próxima acción con evidencia verificable.",
      emptyState: "No hay milestones.",
      columns: [
        { key: "milestone", label: "Milestone" },
        { key: "gate", label: "Gate" },
        { key: "bloqueador", label: "Bloqueador" },
        { key: "siguiente", label: "Siguiente acción" },
      ],
      rows: INITIAL_MILESTONES.map((milestone) => row(milestone.id, milestone.status, {
        milestone: `${milestone.id}. ${milestone.name}`,
        gate: milestone.gate ?? "Pendiente",
        bloqueador: milestone.blocker ?? "Sin bloqueo",
        siguiente: milestone.nextAction,
      })),
    },
    aprobaciones: {
      title: "Aprobaciones",
      description: "Nada público, comercial o pagado avanza sin una decisión registrada.",
      emptyState: "No hay decisiones live registradas.",
      columns: [
        { key: "decision", label: "Decisión" },
        { key: "responsable", label: "Responsable" },
        { key: "estado", label: "Estado" },
        { key: "impacto", label: "Impacto" },
      ],
      rows: [
        row("approval-annex-a", "BLOCKED_EXTERNAL", {
          decision: "Anexo A vigente",
          responsable: "ENNCO",
          estado: "Pendiente",
          impacto: "Bloquea elegibilidad y cualquier outreach",
        }),
        row("approval-model", "BLOCKED_EXTERNAL", {
          decision: "Modelo de precotización",
          responsable: "Paco",
          estado: "Pendiente",
          impacto: "Bloquea publicación de rangos",
        }),
      ],
    },
    reportes: {
      title: "Reportes",
      description: "Sistema, actividad y resultados se muestran por separado con denominadores.",
      emptyState: "No existe T0 porque todavía no hay 100 entregas válidas.",
      columns: [
        { key: "capa", label: "Capa" },
        { key: "metrica", label: "Métrica" },
        { key: "valor", label: "Valor real" },
        { key: "limite", label: "Límite" },
      ],
      rows: [
        row("report-system", "LOCAL_PASS", { capa: "Sistema", metrica: "Gates locales M0 a M3", valor: "PASS local", limite: "No equivale a producción" }),
        row("report-activity", "ZERO", { capa: "Actividad", metrica: "Entregas válidas", valor: "0", limite: "T0 no calculado" }),
        row("report-outcome", "ZERO", { capa: "Resultado", metrica: "Leads contractuales", valor: "0", limite: "Sin campaña real" }),
      ],
    },
    exportaciones: {
      title: "Exportaciones",
      description: "Paquetes versionados y auditables. La descarga live se habilita con el almacenamiento dedicado.",
      emptyState: "No hay exportaciones live disponibles.",
      columns: [
        { key: "paquete", label: "Paquete" },
        { key: "formato", label: "Formato" },
        { key: "contenido", label: "Contenido" },
        { key: "estado", label: "Estado" },
      ],
      rows: [
        row("export-companies", sampleBadge, { paquete: "Empresas y contactos", formato: "CSV", contenido: "Fuentes, confianza y supresión", estado: "Contrato listo, sin datos live" }),
        row("export-commercial", sampleBadge, { paquete: "Pipeline y atribución", formato: "CSV", contenido: "Etapas, evidencia y pagos", estado: "Contrato listo, sin datos live" }),
      ],
    },
  };

  return {
    evidenceClass: "synthetic_demo",
    generatedAt: new Date().toISOString(),
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
      openP1: 4,
    },
    nextActions: [
      row("next-annex", "BLOCKED_EXTERNAL", { objective: "Importar y conciliar Anexo A", due: "Al recibirlo", owner: "Teckel + ENNCO" }),
      row("next-model", "BLOCKED_EXTERNAL", { objective: "Validar modelo y rangos", due: "Antes de publicar", owner: "Paco" }),
      row("next-m4", "IN_PROGRESS", { objective: "Completar portal y eventos de buzón", due: "M4", owner: "Teckel" }),
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

export async function loadOperationsPortal(access: OperationsAccessContext): Promise<OperationsPortalSnapshot> {
  if (access.evidenceClass === "synthetic_demo") return getSyntheticOperationsPortal();
  if (!access.organizationId) throw new Error("PORTAL_ORGANIZATION_REQUIRED");

  const client = await createSupabaseServerClient();
  const organizationId = access.organizationId;
  const results = await Promise.all([
    client.from("runtime_controls").select("global_kill_switch,external_send_allowed").eq("organization_id", organizationId).maybeSingle(),
    client.from("accounts").select("id,legal_name,state,sector,source_confidence,updated_at", { count: "exact" }).eq("organization_id", organizationId).eq("is_deleted", false).limit(200),
    client.from("contacts").select("id,account_id,full_name,role_title,verified,updated_at", { count: "exact" }).eq("organization_id", organizationId).eq("is_deleted", false).limit(300),
    client.from("messages").select("id,contact_id,status,subject,body_text,created_at", { count: "exact" }).eq("organization_id", organizationId).eq("direction", "INBOUND").order("created_at", { ascending: false }).limit(100),
    client.from("provider_events").select("id,message_id,event_kind,reply_classification,processing_status,observed_at").eq("organization_id", organizationId).order("observed_at", { ascending: false }).limit(100),
    client.from("leads").select("id,account_id,contact_id,status,contractual_qualified,qualification_reason,created_at", { count: "exact" }).eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100),
    client.from("prequotes").select("id,folio,account_name,need_type,evidence_class,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100),
    client.from("campaigns").select("id,name,status,manifest_sha256,shadow_canary_decision,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100),
    client.from("opportunities").select("id,account_id,stage,value_mxn,next_action,next_action_at,economic_buyer,active_pain,business_impact,timing_under_90_days").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100),
    client.from("meetings").select("id,opportunity_id,scheduled_at,held_at,attendance_verified").eq("organization_id", organizationId).order("scheduled_at", { ascending: true }).limit(100),
    client.from("tasks").select("id,account_id,contact_id,task_type,normalized_objective,due_at,status").eq("organization_id", organizationId).order("due_at", { ascending: true }).limit(100),
    client.from("roadmap_milestones").select("id,code,name,status,blocker,next_action,due_date").eq("organization_id", organizationId).order("code", { ascending: true }),
    client.from("approvals").select("id,subject_type,decision,decided_at").eq("organization_id", organizationId).order("decided_at", { ascending: false }).limit(100),
    client.from("incidents").select("id,severity,status,title,opened_at").eq("organization_id", organizationId).in("status", ["OPEN", "ACKNOWLEDGED", "MITIGATED"]),
    client.from("mailbox_sync_cursors").select("mailbox_id,status,last_synced_at,last_error_code,watch_expires_at").eq("organization_id", organizationId),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`PORTAL_QUERY_FAILED:${failed.error.code ?? "UNKNOWN"}`);

  const [controlsResult, accountsResult, contactsResult, messagesResult, eventsResult, leadsResult, prequotesResult, campaignsResult, opportunitiesResult, meetingsResult, tasksResult, roadmapResult, approvalsResult, incidentsResult, cursorsResult] = results;
  const accounts = asRows(accountsResult.data);
  const contacts = asRows(contactsResult.data);
  const messages = asRows(messagesResult.data);
  const events = asRows(eventsResult.data);
  const leads = asRows(leadsResult.data);
  const opportunities = asRows(opportunitiesResult.data);
  const meetings = asRows(meetingsResult.data);
  const tasks = asRows(tasksResult.data);
  const incidents = asRows(incidentsResult.data);
  const controls = controlsResult.data as DbRecord | null;
  const accountById = new Map(accounts.map((item) => [textValue(item.id), item]));
  const contactById = new Map(contacts.map((item) => [textValue(item.id), item]));
  const eventByMessageId = new Map(events.map((item) => [textValue(item.message_id), item]));
  const meetingByOpportunityId = new Map(meetings.map((item) => [textValue(item.opportunity_id), item]));
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
  }));
  const accountRows = accounts.map((account) => row(textValue(account.id), textValue(account.source_confidence), {
    empresa: textValue(account.legal_name),
    ubicacion: textValue(account.state),
    confianza: textValue(account.source_confidence),
    elegibilidad: "Revisar supresión antes de contacto",
  }));
  const prequoteRows = asRows(prequotesResult.data).map((prequote) => row(textValue(prequote.id), textValue(prequote.evidence_class), {
    folio: textValue(prequote.folio),
    necesidad: textValue(prequote.need_type),
    modelo: "Ver resultado versionado",
    estado: `Creada ${dateValue(prequote.created_at)}`,
  }));
  const campaignRows = asRows(campaignsResult.data).map((campaign) => row(textValue(campaign.id), textValue(campaign.status), {
    campana: textValue(campaign.name),
    manifiesto: textValue(campaign.manifest_sha256).slice(0, 12),
    canary: textValue(campaign.shadow_canary_decision, "Pendiente"),
    envio: controls?.external_send_allowed === true && controls?.global_kill_switch === false ? "HABILITADO" : "BLOQUEADO",
  }));
  const pipelineRows = opportunities.filter((opportunity) =>
    opportunity.economic_buyer === true
    && opportunity.active_pain === true
    && opportunity.business_impact === true
    && opportunity.timing_under_90_days === true
    && Number(opportunity.value_mxn ?? 0) > 0
    && Boolean(opportunity.next_action)
    && Boolean(opportunity.next_action_at),
  ).map((opportunity) => row(textValue(opportunity.id), textValue(opportunity.stage), {
    cuenta: accountName(opportunity.account_id),
    etapa: textValue(opportunity.stage),
    valor: new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(opportunity.value_mxn)),
    siguiente: `${textValue(opportunity.next_action)}. ${dateValue(opportunity.next_action_at)}`,
    meeting_id: textValue(meetingByOpportunityId.get(textValue(opportunity.id))?.id, ""),
  }));
  const roadmapRows = asRows(roadmapResult.data).map((milestone) => row(textValue(milestone.id), textValue(milestone.status), {
    milestone: `${textValue(milestone.code)}. ${textValue(milestone.name)}`,
    gate: "Ver evidencia",
    bloqueador: textValue(milestone.blocker, "Sin bloqueo"),
    siguiente: textValue(milestone.next_action),
  }));
  const approvalRows = asRows(approvalsResult.data).map((approval) => row(textValue(approval.id), textValue(approval.decision), {
    decision: textValue(approval.subject_type),
    responsable: "Usuario autenticado",
    estado: textValue(approval.decision),
    impacto: dateValue(approval.decided_at),
  }));
  const overdueTasks = tasks.filter((task) => task.status === "OPEN" && new Date(textValue(task.due_at, "2999-01-01")).getTime() < Date.now());
  const openP0 = incidents.filter((incident) => incident.severity === "P0").length;
  const openP1 = incidents.filter((incident) => incident.severity === "P1").length;
  const cursors = asRows(cursorsResult.data);
  const replySync = cursors.length > 0 && cursors.every((cursor) => cursor.status === "READY")
    ? "HEALTHY"
    : cursors.some((cursor) => cursor.status === "ERROR") ? "DEGRADED" : "HOLD";
  const contractualLeads = leads.filter((lead) => lead.contractual_qualified === true).length;
  const wonProjects = opportunities.filter((opportunity) => opportunity.stage === "CLOSED_WON").length;

  const base = getSyntheticOperationsPortal();
  return {
    evidenceClass: "live",
    generatedAt: new Date().toISOString(),
    realTruth: {
      newLeads: leads.filter((lead) => new Date(textValue(lead.created_at, "1970-01-01")).getTime() >= dayStart.getTime()).length,
      pendingReplies: replyRows.length,
      meetingsToday: meetings.filter((meeting) => {
        const scheduled = new Date(textValue(meeting.scheduled_at, "1970-01-01"));
        return scheduled >= dayStart && scheduled.getTime() < dayStart.getTime() + 24 * 60 * 60 * 1000;
      }).length,
      overdueTasks: overdueTasks.length,
      contractualLeads,
      qualifiedPipeline: pipelineRows.length,
      wonProjects,
      firstPaymentsMxn: 0,
    },
    health: {
      killSwitch: controls?.global_kill_switch !== false,
      externalSendAllowed: controls?.external_send_allowed === true,
      replySync,
      openP0,
      openP1,
    },
    nextActions: tasks.filter((task) => task.status === "OPEN").slice(0, 8).map((task) => row(textValue(task.id), textValue(task.status), {
      objective: textValue(task.normalized_objective),
      due: dateValue(task.due_at),
      owner: "Operador asignado",
    })),
    modules: {
      ...base.modules,
      respuestas: { ...base.modules.respuestas, rows: replyRows },
      leads: { ...base.modules.leads, rows: leadRows },
      empresas: { ...base.modules.empresas, rows: accountRows },
      precotizaciones: { ...base.modules.precotizaciones, rows: prequoteRows },
      campanas: { ...base.modules.campanas, rows: campaignRows },
      pipeline: { ...base.modules.pipeline, rows: pipelineRows },
      roadmap: { ...base.modules.roadmap, rows: roadmapRows },
      aprobaciones: { ...base.modules.aprobaciones, rows: approvalRows },
      reportes: {
        ...base.modules.reportes,
        rows: [
          row("live-system", "LIVE", { capa: "Sistema", metrica: "Sincronización de respuestas", valor: replySync, limite: `${openP0} P0 y ${openP1} P1 abiertos` }),
          row("live-activity", "LIVE", { capa: "Actividad", metrica: "Empresas registradas", valor: String(accountsResult.count ?? accountRows.length), limite: "No equivale a pipeline" }),
          row("live-outcome", "LIVE", { capa: "Resultado", metrica: "Leads contractuales", valor: String(contractualLeads), limite: "Requiere evidencia estricta" }),
        ],
      },
      exportaciones: { ...base.modules.exportaciones, rows: [] },
    },
  };
}

export function isOperationModuleKey(value: string): value is OperationModuleKey {
  return (OPERATION_MODULE_KEYS as readonly string[]).includes(value);
}
