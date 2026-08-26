import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const nullableTimestampSchema = timestampSchema.nullable();

export const hybridMailboxSnapshotSchema = z.object({
  normalized_email: z.email().transform((value) => value.trim().toLowerCase()),
  domain: z.string().trim().toLowerCase().min(3).max(253),
  eligibility_route: z.enum(["EXISTING_PRIMARY_GMAIL_RAMP", "NEW_ISOLATED_MAILBOX_WARMUP"]),
  domain_role: z.enum(["PRIMARY_CORPORATE", "OUTREACH_ISOLATED"]),
  custody_status: z.enum(["TECKEL_MANAGED_FOR_ENNCO", "APOLLO_PROVISIONED_TECKEL_CUSTODY", "ENNCO_DIRECT"]),
  provider: z.enum(["gmail", "apollo_shared_smtp"]),
  domain_ready_at: nullableTimestampSchema,
  domain_registered_at: nullableTimestampSchema,
  warmup_started_at: nullableTimestampSchema,
  warmup_status: z.enum(["NOT_STARTED", "WARMING", "HEALTHY", "DEGRADED", "BLOCKED"]),
  auth_spf: z.boolean(),
  auth_dkim: z.boolean(),
  auth_dmarc: z.boolean(),
  auth_tls: z.boolean(),
  health_status: z.enum(["HOLD", "HEALTHY", "DEGRADED", "KILLED"]),
  kill_switch: z.boolean(),
  credential_status: z.enum(["UNKNOWN", "OAUTH_CONNECTED", "ERROR", "REVOKED"]),
  sender_identity_verified: z.boolean(),
  gmail_seed_verified: z.boolean(),
  outlook_seed_verified: z.boolean(),
  yahoo_seed_verified: z.boolean(),
  reply_sync_verified: z.boolean(),
  human_history_verified: z.boolean(),
  blocklist_status: z.enum(["UNKNOWN", "CLEAR", "LISTED"]),
  route_evidence_sha256: sha256Schema,
  route_evidence_at: timestampSchema,
  provider_daily_limit: z.number().int().min(0).max(20),
  last_provider_health_at: nullableTimestampSchema,
}).strict().superRefine((value, context) => {
  const primary = value.eligibility_route === "EXISTING_PRIMARY_GMAIL_RAMP";
  const expectedDomain = value.normalized_email.split("@").at(1);
  if (expectedDomain !== value.domain) {
    context.addIssue({ code: "custom", message: "HYBRID_SNAPSHOT_EMAIL_DOMAIN_DRIFT" });
  }
  if (primary && (
    value.normalized_email !== "contacto@ennco.com.mx"
    || value.domain !== "ennco.com.mx"
    || value.domain_role !== "PRIMARY_CORPORATE"
    || value.provider !== "gmail"
    || value.warmup_started_at !== null
  )) {
    context.addIssue({ code: "custom", message: "HYBRID_PRIMARY_SNAPSHOT_CONTRADICTION" });
  }
  if (!primary && (
    !["enncoindustrial.com", "enncoenergia.com"].includes(value.domain)
    || value.domain_role !== "OUTREACH_ISOLATED"
    || value.provider !== "apollo_shared_smtp"
    || value.warmup_started_at === null
  )) {
    context.addIssue({ code: "custom", message: "HYBRID_ISOLATED_SNAPSHOT_CONTRADICTION" });
  }
});

export const hybridMailboxObservationInputSchema = z.object({
  valid_deliveries: z.number().int().min(0),
  attempted_deliveries: z.number().int().min(0),
  hard_bounces: z.number().int().min(0),
  spam_complaints: z.number().int().min(0),
  delivery_rate: z.number().min(0).max(1).nullable(),
  reply_sync_p95_seconds: z.number().int().min(0).nullable(),
  positive_reply_sla_breaches: z.number().int().min(0),
  provider_reconciled: z.boolean(),
  suppression_reconciled: z.boolean(),
  identity_unambiguous: z.boolean(),
  evidence_sha256: sha256Schema,
  evidence_class: z.enum(["synthetic_demo", "live"]),
  observed_at: timestampSchema,
}).strict().superRefine((value, context) => {
  if (value.attempted_deliveries < value.valid_deliveries
    || value.hard_bounces > value.attempted_deliveries
    || value.spam_complaints > value.attempted_deliveries) {
    context.addIssue({ code: "custom", message: "HYBRID_OBSERVATION_COUNTER_CONTRADICTION" });
  }
  if ((value.attempted_deliveries === 0) !== (value.delivery_rate === null)) {
    context.addIssue({ code: "custom", message: "HYBRID_OBSERVATION_RATE_CONTRADICTION" });
  }
  if (value.attempted_deliveries > 0 && value.delivery_rate !== null) {
    const expected = Math.round((value.valid_deliveries / value.attempted_deliveries) * 1_000_000) / 1_000_000;
    if (Math.abs(value.delivery_rate - expected) > 0.000001) {
      context.addIssue({ code: "custom", message: "HYBRID_OBSERVATION_RATE_DRIFT" });
    }
  }
});

export const hybridReleaseInputSchema = z.object({
  mailbox_id: z.uuid(),
  campaign_id: z.uuid(),
  lane: z.enum(["ACCELERATED_TIER1_CANARY", "ISOLATED_MAILBOX_CANARY"]),
  manifest_sha256: sha256Schema,
  suppression_sha256: sha256Schema,
  copy_sha256: sha256Schema,
  sequence_sha256: sha256Schema,
  scheduled_for: timestampSchema,
  expires_at: timestampSchema,
  enrollment_ids: z.array(z.uuid()).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.enrollment_ids).size !== value.enrollment_ids.length) {
    context.addIssue({ code: "custom", message: "HYBRID_RELEASE_ENROLLMENT_DUPLICATE" });
  }
  if (Date.parse(value.expires_at) <= Date.parse(value.scheduled_for)) {
    context.addIssue({ code: "custom", message: "HYBRID_RELEASE_WINDOW_INVALID" });
  }
});

export const hybridMailboxMutationResultSchema = z.object({
  status: z.enum(["APPLIED", "RECORDED", "DUPLICATE"]),
  mailbox_id: z.uuid().optional(),
  observation_id: z.uuid().optional(),
  request_sha256: sha256Schema,
  readiness: z.unknown(),
}).strict();

export const hybridReleaseResultSchema = z.object({
  status: z.enum(["READY_FOR_CANARY", "DUPLICATE"]),
  release_id: z.uuid(),
  request_sha256: sha256Schema,
  mailbox_id: z.uuid(),
  recipient_count: z.number().int().min(1).max(20),
  daily_cap: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
}).strict();

export const hybridMailboxReadinessSchema = z.object({
  status: z.literal("READ_ONLY"),
  state: z.enum(["UNKNOWN", "BLOCKED", "WARMING", "READY"]),
  effective_release: z.enum(["HOLD", "READY_FOR_CANARY", "PAUSED", "SCALE_ALLOWED", "KILLED"]),
  organization_id: z.uuid(),
  mailbox_id: z.uuid(),
  normalized_email: z.email().transform((value) => value.trim().toLowerCase()),
  route: z.enum(["EXISTING_PRIMARY_GMAIL_RAMP", "NEW_ISOLATED_MAILBOX_WARMUP"]),
  domain_role: z.enum(["PRIMARY_CORPORATE", "OUTREACH_ISOLATED"]),
  custody_status: z.enum([
    "UNKNOWN",
    "TECKEL_MANAGED_FOR_ENNCO",
    "APOLLO_PROVISIONED_TECKEL_CUSTODY",
    "ENNCO_DIRECT",
  ]),
  evaluated_at: timestampSchema,
  domain_age_days: z.number().int().min(0),
  warmup_days: z.number().int().min(0),
  valid_deliveries: z.number().int().min(0),
  attempted_deliveries: z.number().int().min(0),
  hard_bounces: z.number().int().min(0),
  spam_complaints: z.number().int().min(0),
  delivery_rate: z.number().min(0).max(1).nullable(),
  reply_sync_p95_seconds: z.number().int().min(0).nullable(),
  positive_reply_sla_breaches: z.number().int().min(0),
  daily_cap: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  blockers: z.array(z.string().trim().min(1).max(160)).max(40),
}).strict().superRefine((value, context) => {
  if (value.attempted_deliveries < value.valid_deliveries
    || value.hard_bounces > value.attempted_deliveries
    || value.spam_complaints > value.attempted_deliveries) {
    context.addIssue({ code: "custom", message: "HYBRID_MAILBOX_COUNTER_CONTRADICTION" });
  }
  if ((value.attempted_deliveries === 0) !== (value.delivery_rate === null)) {
    context.addIssue({ code: "custom", message: "HYBRID_MAILBOX_DELIVERY_RATE_CONTRADICTION" });
  }
  if (value.attempted_deliveries > 0 && value.delivery_rate !== null) {
    const expected = Math.round((value.valid_deliveries / value.attempted_deliveries) * 1_000_000) / 1_000_000;
    if (Math.abs(value.delivery_rate - expected) > 0.000001) {
      context.addIssue({ code: "custom", message: "HYBRID_MAILBOX_DELIVERY_RATE_DRIFT" });
    }
  }
  const primary = value.route === "EXISTING_PRIMARY_GMAIL_RAMP";
  if (primary !== (value.domain_role === "PRIMARY_CORPORATE")) {
    context.addIssue({ code: "custom", message: "HYBRID_MAILBOX_ROUTE_ROLE_DRIFT" });
  }
  if (primary && value.normalized_email !== "contacto@ennco.com.mx") {
    context.addIssue({ code: "custom", message: "HYBRID_PRIMARY_MAILBOX_DRIFT" });
  }
  if (value.state === "READY" && (
    value.blockers.length !== 0
    || !["READY_FOR_CANARY", "SCALE_ALLOWED"].includes(value.effective_release)
    || value.daily_cap === 0
  )) {
    context.addIssue({ code: "custom", message: "HYBRID_MAILBOX_READY_CONTRADICTION" });
  }
  if (value.state !== "READY" && ["READY_FOR_CANARY", "SCALE_ALLOWED"].includes(value.effective_release)) {
    context.addIssue({ code: "custom", message: "HYBRID_MAILBOX_HOLD_CONTRADICTION" });
  }
});

const hybridInventorySchema = z.object({
  minimum_accounts: z.literal(75),
  minimum_contacts: z.literal(150),
  operational_accounts: z.literal(150),
  operational_contacts: z.literal(300),
  verified_accounts: z.number().int().min(0),
  verified_contacts: z.number().int().min(0),
}).strict();

export const hybridOutboundReadinessSchema = z.object({
  status: z.literal("READ_ONLY"),
  state: z.enum(["UNKNOWN", "BLOCKED", "READY"]),
  effective_release: z.enum(["HOLD", "READY_FOR_CANARY", "PAUSED", "SCALE_ALLOWED", "KILLED"]),
  organization_id: z.uuid(),
  evaluated_at: timestampSchema,
  primary_mailbox_ready: z.boolean(),
  isolated_mailboxes_ready: z.number().int().min(0).max(3),
  isolated_mailboxes_target: z.literal(3),
  mailboxes: z.array(hybridMailboxReadinessSchema).max(4),
  inventory: hybridInventorySchema,
  blockers: z.array(z.string().trim().min(1).max(160)).max(40),
}).strict().superRefine((value, context) => {
  const primary = value.mailboxes.filter((mailbox) => mailbox.route === "EXISTING_PRIMARY_GMAIL_RAMP");
  const isolated = value.mailboxes.filter((mailbox) => mailbox.route === "NEW_ISOLATED_MAILBOX_WARMUP");
  const isolatedReady = isolated.filter((mailbox) => mailbox.state === "READY").length;
  if (value.primary_mailbox_ready !== (primary.length === 1 && primary[0]?.state === "READY")) {
    context.addIssue({ code: "custom", message: "HYBRID_PRIMARY_READINESS_DRIFT" });
  }
  if (value.isolated_mailboxes_ready !== isolatedReady) {
    context.addIssue({ code: "custom", message: "HYBRID_ISOLATED_READINESS_DRIFT" });
  }
  if (value.state === "READY" && (
    !value.primary_mailbox_ready
  )) {
    context.addIssue({ code: "custom", message: "HYBRID_OUTBOUND_READY_CONTRADICTION" });
  }
  if (value.state !== "READY" && ["READY_FOR_CANARY", "SCALE_ALLOWED"].includes(value.effective_release)) {
    context.addIssue({ code: "custom", message: "HYBRID_OUTBOUND_HOLD_CONTRADICTION" });
  }
});

export type HybridMailboxReadiness = z.infer<typeof hybridMailboxReadinessSchema>;
export type HybridOutboundReadiness = z.infer<typeof hybridOutboundReadinessSchema>;

export function createUnknownHybridOutboundReadiness(input: {
  organizationId?: string | null;
  evaluatedAt: string;
  reasonCode: string;
}): HybridOutboundReadiness {
  return {
    status: "READ_ONLY",
    state: "UNKNOWN",
    effective_release: "HOLD",
    organization_id: input.organizationId ?? "00000000-0000-4000-8000-000000000000",
    evaluated_at: input.evaluatedAt,
    primary_mailbox_ready: false,
    isolated_mailboxes_ready: 0,
    isolated_mailboxes_target: 3,
    mailboxes: [],
    inventory: {
      minimum_accounts: 75,
      minimum_contacts: 150,
      operational_accounts: 150,
      operational_contacts: 300,
      verified_accounts: 0,
      verified_contacts: 0,
    },
    blockers: [input.reasonCode],
  };
}

export function isHybridOutboundReleaseAllowed(value: HybridOutboundReadiness): boolean {
  return value.state === "READY"
    && value.primary_mailbox_ready
    && ["READY_FOR_CANARY", "SCALE_ALLOWED"].includes(value.effective_release)
    && value.mailboxes.some((mailbox) => mailbox.route === "EXISTING_PRIMARY_GMAIL_RAMP"
      && mailbox.state === "READY"
      && mailbox.daily_cap > 0
      && mailbox.blockers.length === 0);
}

export function parseHybridOutboundReadiness(input: {
  rpcAvailable: boolean;
  rpcData: unknown;
  expectedOrganizationId: string;
  evaluatedAt: string;
}): HybridOutboundReadiness {
  const unknown = (reasonCode: string) => createUnknownHybridOutboundReadiness({
    organizationId: input.expectedOrganizationId,
    evaluatedAt: input.evaluatedAt,
    reasonCode,
  });
  if (!input.rpcAvailable) return unknown("HYBRID_OUTBOUND_RPC_UNAVAILABLE");
  const parsed = hybridOutboundReadinessSchema.safeParse(input.rpcData);
  if (!parsed.success) return unknown("HYBRID_OUTBOUND_SCHEMA_INVALID");
  if (parsed.data.organization_id !== input.expectedOrganizationId) {
    return unknown("HYBRID_OUTBOUND_ORGANIZATION_DRIFT");
  }
  if (Date.parse(parsed.data.evaluated_at) !== Date.parse(input.evaluatedAt)) {
    return unknown("HYBRID_OUTBOUND_EVALUATION_DRIFT");
  }
  return parsed.data;
}

const HYBRID_BLOCKER_LABELS: Record<string, string> = {
  PRIMARY_MAILBOX_COUNT_NOT_ONE: "Configurar exactamente contacto@ennco.com.mx como carril principal",
  ISOLATED_MAILBOX_COUNT_NOT_THREE: "Crear los tres buzones aislados aprobados",
  SENDER_IDENTITY_NOT_VERIFIED: "Verificar el From visible Francisco Cuellar en Gmail, Outlook y Yahoo",
  MAILBOX_AUTH_INCOMPLETE: "Completar SPF, DKIM, DMARC y TLS",
  MAILBOX_SEEDS_INCOMPLETE: "Validar seeds Gmail, Outlook y Yahoo",
  MAILBOX_OAUTH_NOT_CONNECTED: "Conectar Gmail OAuth con permisos mínimos",
  MAILBOX_HUMAN_HISTORY_UNKNOWN: "Verificar actividad humana previa del buzón",
  REPLY_SYNC_NOT_VERIFIED: "Probar respuesta, Pub/Sub y sincronización menor a cinco minutos",
  BLOCKLIST_STATUS_NOT_CLEAR: "Revisar listas de bloqueo y registrar evidencia live",
  MAILBOX_HEALTH_HOLD: "Mantener HOLD hasta que identidad, autenticación, seeds y sync estén sanos",
  PRIMARY_DOMAIN_UNDER_180_DAYS: "Esperar a que el dominio principal cumpla 180 días",
  MAILBOX_LIVE_OBSERVATION_MISSING: "Registrar evidencia live fresca del buzón",
  ISOLATED_MAILBOX_WARMUP_UNDER_42_DAYS: "Completar 42 días de calentamiento sin prospectos",
  SPAM_COMPLAINT_KILL: "Mantener el buzón apagado y atender la queja de spam",
  EARLY_HARD_BOUNCE_KILL: "Detener el canary por rebote duro temprano",
  HARD_BOUNCE_RATE_HOLD: "Reducir rebote duro por debajo de 2 por ciento",
  DELIVERY_RATE_HOLD: "Recuperar entrega mínima de 95 por ciento",
  REPLY_SYNC_SLA_HOLD: "Restaurar sincronización de respuestas menor a cinco minutos",
  POSITIVE_REPLY_SLA_HOLD: "Resolver respuestas positivas dentro del SLA operativo",
  PROVIDER_LEDGER_MISMATCH: "Reconciliar Gmail, Apollo y el ledger por correo exacto",
  SUPPRESSION_UNKNOWN: "Reconciliar Anexo A y supresión antes de enviar",
  IDENTITY_AMBIGUOUS: "Confirmar identidad exacta del remitente y destinatario",
  EXACT_ACTIVE_RELEASE_MISSING: "Congelar el manifiesto exacto y aprobar su ventana de envío",
};

export function hybridBlockerLabel(code: string): string {
  return HYBRID_BLOCKER_LABELS[code] ?? code;
}
