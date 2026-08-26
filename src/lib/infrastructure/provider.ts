import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });

export const outboundProviderReadinessSchema = z.object({
  status: z.literal("READ_ONLY"),
  state: z.enum(["UNKNOWN", "BLOCKED", "WARMING", "READY"]),
  release_state: z.enum(["HOLD", "READY_FOR_CANARY"]),
  organization_id: z.uuid(),
  evaluated_at: timestampSchema,
  provider: z.literal("Apollo"),
  provider_account_id: z.uuid().nullable(),
  plan: z.string().trim().min(1).max(120),
  ownership: z.enum(["UNKNOWN", "ENNCO_OWNED", "TECKEL_OWNED", "THIRD_PARTY"]),
  custody_model: z.enum(["UNKNOWN", "TECKEL_MANAGED_FOR_ENNCO"]),
  workspace_mode: z.enum(["UNKNOWN", "ENNCO_DEDICATED"]),
  sender_identity: z.enum(["UNKNOWN", "FRANCISCO_CUELLAR"]),
  terms_risk: z.enum(["UNKNOWN", "ACCEPTED_BY_TECKEL", "BLOCKED"]),
  legacy_teckel_assets: z.enum(["UNKNOWN", "ARCHIVED", "ACTIVE"]),
  legacy_contact_count: z.number().int().min(0),
  legacy_sequence_count: z.number().int().min(0),
  active_sequence_count: z.number().int().min(0),
  teckel_mailbox_active_count: z.number().int().min(0),
  primary_mailbox_connected: z.boolean(),
  team_bound: z.boolean(),
  domains_ready: z.number().int().min(0).max(2),
  domains_target: z.literal(2),
  mailboxes_ready: z.number().int().min(0).max(3),
  mailboxes_target: z.literal(3),
  warmup_days: z.number().int().min(0),
  warmup_required_days: z.literal(42),
  activation_gates_passed: z.number().int().min(0).max(15),
  activation_gates_required: z.literal(15),
  live_gates_passed: z.number().int().min(0).max(15),
  credit_limit: z.number().int().min(0).max(1_000_000).nullable(),
  credits_consumed: z.number().int().min(0).nullable(),
  credits_remaining: z.number().int().min(0).nullable(),
  research_credit_cap: z.number().int().min(0).max(300).nullable(),
  infrastructure_credit_spend: z.number().int().min(0).max(3_600).nullable(),
  minimum_credit_buffer: z.literal(110).nullable(),
  blockers: z.array(z.string().trim().min(1).max(160)).max(32),
}).strict().superRefine((value, context) => {
  if (value.credits_consumed !== null && value.credit_limit !== null
    && value.credits_consumed > value.credit_limit) {
    context.addIssue({ code: "custom", message: "PROVIDER_CREDIT_CAP_CONTRADICTION" });
  }
  if (value.credits_consumed !== null && value.credit_limit !== null && value.credits_remaining !== null
    && value.credits_remaining !== value.credit_limit - value.credits_consumed) {
    context.addIssue({ code: "custom", message: "PROVIDER_CREDIT_REMAINING_DRIFT" });
  }
  const ready = value.state === "READY" || value.release_state === "READY_FOR_CANARY";
  if (ready && (
    value.state !== "READY"
    || value.release_state !== "READY_FOR_CANARY"
    || value.provider_account_id === null
    || value.ownership !== "TECKEL_OWNED"
    || value.custody_model !== "TECKEL_MANAGED_FOR_ENNCO"
    || value.workspace_mode !== "ENNCO_DEDICATED"
    || value.sender_identity !== "FRANCISCO_CUELLAR"
    || value.terms_risk !== "ACCEPTED_BY_TECKEL"
    || value.legacy_teckel_assets !== "ARCHIVED"
    || value.active_sequence_count !== 0
    || value.teckel_mailbox_active_count !== 0
    || !value.primary_mailbox_connected
    || !value.team_bound
    || value.domains_ready !== 2
    || value.mailboxes_ready !== 3
    || value.warmup_days < 42
    || value.activation_gates_passed !== 15
    || value.live_gates_passed !== 15
    || value.credit_limit === null
    || value.research_credit_cap === null
    || value.credits_remaining === null
    || value.minimum_credit_buffer !== 110
    || value.credits_remaining < 110
    || value.blockers.length !== 0
  )) {
    context.addIssue({ code: "custom", message: "PROVIDER_READY_CONTRADICTION" });
  }
  if (!ready && value.release_state !== "HOLD") {
    context.addIssue({ code: "custom", message: "PROVIDER_HOLD_CONTRADICTION" });
  }
});

export type OutboundProviderReadiness = z.infer<typeof outboundProviderReadinessSchema>;

export function createUnknownOutboundProviderReadiness(input: {
  organizationId?: string | null;
  evaluatedAt: string;
  reasonCode: string;
}): OutboundProviderReadiness {
  return {
    status: "READ_ONLY",
    state: "UNKNOWN",
    release_state: "HOLD",
    organization_id: input.organizationId ?? "00000000-0000-4000-8000-000000000000",
    evaluated_at: input.evaluatedAt,
    provider: "Apollo",
    provider_account_id: null,
    plan: "Professional mensual pendiente de contratación",
    ownership: "UNKNOWN",
    custody_model: "UNKNOWN",
    workspace_mode: "UNKNOWN",
    sender_identity: "UNKNOWN",
    terms_risk: "UNKNOWN",
    legacy_teckel_assets: "UNKNOWN",
    legacy_contact_count: 0,
    legacy_sequence_count: 0,
    active_sequence_count: 0,
    teckel_mailbox_active_count: 0,
    primary_mailbox_connected: false,
    team_bound: false,
    domains_ready: 0,
    domains_target: 2,
    mailboxes_ready: 0,
    mailboxes_target: 3,
    warmup_days: 0,
    warmup_required_days: 42,
    activation_gates_passed: 0,
    activation_gates_required: 15,
    live_gates_passed: 0,
    credit_limit: null,
    credits_consumed: null,
    credits_remaining: null,
    research_credit_cap: null,
    infrastructure_credit_spend: null,
    minimum_credit_buffer: null,
    blockers: [input.reasonCode],
  };
}

export function isOutboundProviderReleaseAllowed(value: OutboundProviderReadiness): boolean {
  return value.state === "READY"
    && value.release_state === "READY_FOR_CANARY"
    && value.provider_account_id !== null
    && value.ownership === "TECKEL_OWNED"
    && value.custody_model === "TECKEL_MANAGED_FOR_ENNCO"
    && value.workspace_mode === "ENNCO_DEDICATED"
    && value.sender_identity === "FRANCISCO_CUELLAR"
    && value.terms_risk === "ACCEPTED_BY_TECKEL"
    && value.legacy_teckel_assets === "ARCHIVED"
    && value.active_sequence_count === 0
    && value.teckel_mailbox_active_count === 0
    && value.primary_mailbox_connected
    && value.team_bound
    && value.domains_ready === 2
    && value.mailboxes_ready === 3
    && value.warmup_days >= 42
    && value.activation_gates_passed === 15
    && value.live_gates_passed === 15
    && value.credit_limit !== null
    && value.credits_remaining !== null
    && value.credits_remaining >= 110
    && value.research_credit_cap !== null
    && value.research_credit_cap <= 300
    && value.infrastructure_credit_spend !== null
    && value.infrastructure_credit_spend <= 3_600
    && value.minimum_credit_buffer === 110
    && value.blockers.length === 0;
}

export function parseOutboundProviderReadiness(input: {
  rpcAvailable: boolean;
  rpcData: unknown;
  expectedOrganizationId: string;
  evaluatedAt: string;
}): OutboundProviderReadiness {
  const unknown = (reasonCode: string) => createUnknownOutboundProviderReadiness({
    organizationId: input.expectedOrganizationId,
    evaluatedAt: input.evaluatedAt,
    reasonCode,
  });
  if (!input.rpcAvailable) return unknown("PROVIDER_READINESS_RPC_UNAVAILABLE");
  const parsed = outboundProviderReadinessSchema.safeParse(input.rpcData);
  if (!parsed.success) return unknown("PROVIDER_READINESS_SCHEMA_INVALID");
  if (parsed.data.organization_id !== input.expectedOrganizationId) {
    return unknown("PROVIDER_READINESS_ORGANIZATION_DRIFT");
  }
  if (Date.parse(parsed.data.evaluated_at) !== Date.parse(input.evaluatedAt)) {
    return unknown("PROVIDER_READINESS_EVALUATION_DRIFT");
  }
  if (parsed.data.state === "READY" && !isOutboundProviderReleaseAllowed(parsed.data)) {
    return unknown("PROVIDER_READINESS_CONTRADICTION");
  }
  return parsed.data;
}

const BLOCKER_LABELS: Record<string, string> = {
  APOLLO_ACCOUNT_NOT_CONFIGURED: "Conectar la cuenta Apollo de ENNCO administrada por Teckel",
  APOLLO_CUSTODY_MODEL_INVALID: "Registrar el workspace Teckel como dedicado exclusivamente a ENNCO",
  APOLLO_TEAM_BINDING_INVALID: "Fijar y verificar el team ID exacto de Apollo",
  APOLLO_SENDER_IDENTITY_INVALID: "Cambiar el perfil visible a Francisco Cuellar",
  APOLLO_LEGACY_ASSETS_NOT_ARCHIVED: "Archivar buzones, secuencias y contactos históricos de Teckel",
  APOLLO_OWNER_OR_SEAT_INVALID: "Confirmar Teckel como administrador y un solo asiento",
  APOLLO_TERMS_NOT_VERIFIED: "Archivar aceptación de términos de Apollo",
  APOLLO_PLAN_NOT_ELIGIBLE: "Confirmar que el plan actual permite API, dominios y buzones",
  APOLLO_MFA_RECOVERY_INCOMPLETE: "Activar MFA y recuperación independiente",
  APOLLO_DELIVERY_STATUS_NOT_READY: "Completar auditoría de entrega de la cuenta",
  APOLLO_ACCOUNT_INACTIVE: "Activar la cuenta únicamente después de validar propiedad",
  OUTREACH_DOMAIN_COUNT_NOT_TWO: "Comprar exactamente dos dominios administrados por Apollo",
  OUTREACH_DOMAINS_NOT_READY: "Completar SPF, DKIM, DMARC, TLS, Postmaster y reputación",
  OUTREACH_MAILBOX_COUNT_NOT_THREE: "Provisionar los tres buzones aislados aprobados",
  OUTREACH_MAILBOXES_NOT_READY: "Completar identidad, seeds, reply sync y salud de buzones",
  APOLLO_WARMUP_UNDER_42_DAYS: "Completar 42 días de calentamiento por buzón",
  APOLLO_CREDIT_BUDGET_MISSING: "Registrar el saldo real y reservar 110 créditos",
  APOLLO_CREDIT_BUDGET_INVALID: "Respetar 300 créditos de investigación, 3,600 de infraestructura y cero teléfonos",
  PROVIDER_ACTIVATION_GATES_INCOMPLETE: "Completar los 15 gates de infraestructura",
  PROVIDER_LIVE_EVIDENCE_INCOMPLETE: "Sustituir evidencia sintética por evidencia live",
  PROVIDER_READ_MODEL_UNAVAILABLE: "Restaurar la lectura de infraestructura",
};

export function providerBlockerLabel(code: string): string {
  return BLOCKER_LABELS[code] ?? code;
}
