import { z } from "zod";

export const CONTROL_CADENCE_CODES = [
  "CONTROL_ROOM_DAILY_UPDATE",
  "INTERNAL_DAILY_REVIEW",
  "STAGING_WEEKLY_DEMO",
  "ENNCO_TECKEL_WEEKLY_MEETING",
  "EXECUTIVE_MONTHLY_REVIEW",
] as const;

export type ControlCadenceCode = (typeof CONTROL_CADENCE_CODES)[number];

const cadenceCodeSchema = z.enum(CONTROL_CADENCE_CODES);
const timestampSchema = z.iso.datetime({ offset: true });

const cadenceItemSchema = z.object({
  code: cadenceCodeSchema,
  config_state: z.enum(["UNKNOWN", "VERIFIED"]),
  owner_user_id: z.uuid().nullable(),
  next_occurrence_at: timestampSchema.nullable(),
  due_at: timestampSchema.nullable(),
  execution_status: z.enum(["SCHEDULED", "OPEN", "COMPLETED", "UNKNOWN"]),
  compliance_status: z.enum(["PENDING", "MET", "BREACHED", "UNKNOWN"]),
  evidence_state: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
  attendance_state: z.enum(["NOT_REQUIRED", "COMPLETE", "INCOMPLETE", "UNKNOWN"]),
  delivery_state: z.enum(["NOT_REQUIRED", "COMPLETE", "INCOMPLETE", "UNKNOWN"]),
  breach_severity: z.enum(["P0", "P1"]).nullable(),
  next_action: z.enum(["CONFIGURE", "RECONCILE", "MITIGATE_BREACH", "COMPLETE_OCCURRENCE", "NONE"]),
}).strict();

export const controlCadenceHealthResultSchema = z.object({
  status: z.literal("READ_ONLY"),
  state: z.enum(["HEALTHY", "DEGRADED", "UNKNOWN"]),
  reason_code: z.string().trim().min(1).max(160).nullable(),
  organization_id: z.uuid(),
  evaluated_at: timestampSchema,
  policy_version_id: z.uuid().nullable(),
  policy_version: z.number().int().positive().nullable(),
  timezone: z.literal("America/Mexico_City"),
  cadence_count: z.number().int().min(0).max(5),
  required_cadence_count: z.literal(5),
  open_occurrences: z.number().int().nonnegative(),
  breached_occurrences: z.number().int().nonnegative(),
  open_p0: z.number().int().nonnegative(),
  open_p1: z.number().int().nonnegative(),
  last_reconciled_at: timestampSchema.nullable(),
  heartbeat_state: z.enum(["FRESH", "STALE", "UNKNOWN"]),
  outbound_release: z.enum(["ALLOWED", "BLOCKED"]),
  cadences: z.array(cadenceItemSchema).max(5),
}).strict();

export type ControlCadenceItem = z.infer<typeof cadenceItemSchema>;
export type ControlCadenceHealth = z.infer<typeof controlCadenceHealthResultSchema>;

const UNKNOWN_ITEM_BY_CODE: Record<ControlCadenceCode, ControlCadenceItem> = Object.fromEntries(
  CONTROL_CADENCE_CODES.map((code) => [code, {
    code,
    config_state: "UNKNOWN",
    owner_user_id: null,
    next_occurrence_at: null,
    due_at: null,
    execution_status: "UNKNOWN",
    compliance_status: "UNKNOWN",
    evidence_state: "UNKNOWN",
    attendance_state: "UNKNOWN",
    delivery_state: "UNKNOWN",
    breach_severity: null,
    next_action: "CONFIGURE",
  }]),
) as Record<ControlCadenceCode, ControlCadenceItem>;

export function createUnknownControlCadenceHealth(input: {
  reasonCode: string;
  evaluatedAt: string;
  organizationId?: string | null;
}): ControlCadenceHealth {
  return {
    status: "READ_ONLY",
    state: "UNKNOWN",
    reason_code: input.reasonCode,
    organization_id: input.organizationId ?? "00000000-0000-4000-8000-000000000000",
    evaluated_at: input.evaluatedAt,
    policy_version_id: null,
    policy_version: null,
    timezone: "America/Mexico_City",
    cadence_count: 0,
    required_cadence_count: 5,
    open_occurrences: 0,
    breached_occurrences: 0,
    open_p0: 0,
    open_p1: 0,
    last_reconciled_at: null,
    heartbeat_state: "UNKNOWN",
    outbound_release: "BLOCKED",
    cadences: CONTROL_CADENCE_CODES.map((code) => ({ ...UNKNOWN_ITEM_BY_CODE[code] })),
  };
}

function hasExactCadenceSet(value: ControlCadenceHealth): boolean {
  if (value.cadence_count !== 5 || value.required_cadence_count !== 5 || value.cadences.length !== 5) return false;
  const codes = new Set(value.cadences.map((item) => item.code));
  return codes.size === 5 && CONTROL_CADENCE_CODES.every((code) => codes.has(code));
}

function hasCompletePolicy(value: ControlCadenceHealth): boolean {
  return value.policy_version_id !== null
    && value.policy_version !== null
    && hasExactCadenceSet(value)
    && value.cadences.every((item) => item.config_state === "VERIFIED");
}

export function isControlCadenceReleaseAllowed(value: ControlCadenceHealth): boolean {
  return value.state === "HEALTHY"
    && value.reason_code === null
    && value.heartbeat_state === "FRESH"
    && value.outbound_release === "ALLOWED"
    && value.open_p0 === 0
    && value.open_p1 === 0
    && value.breached_occurrences === 0
    && value.cadences.every((item) => item.breach_severity === null)
    && hasCompletePolicy(value);
}

export function isExternalSendAllowedWithCadence(
  baseOperationalReleaseAllowed: boolean,
  cadence: ControlCadenceHealth,
): boolean {
  return baseOperationalReleaseAllowed && isControlCadenceReleaseAllowed(cadence);
}

export function parseControlCadenceReadModel(input: {
  rpcAvailable: boolean;
  rpcData: unknown;
  expectedOrganizationId: string;
  evaluatedAt: string;
}): ControlCadenceHealth {
  const unknown = (reasonCode: string) => createUnknownControlCadenceHealth({
    reasonCode,
    evaluatedAt: input.evaluatedAt,
    organizationId: input.expectedOrganizationId,
  });

  if (!input.rpcAvailable) return unknown("CONTROL_CADENCE_RPC_UNAVAILABLE");
  const parsed = controlCadenceHealthResultSchema.safeParse(input.rpcData);
  if (!parsed.success) return unknown("CONTROL_CADENCE_SCHEMA_INVALID");
  const value = parsed.data;
  if (value.organization_id !== input.expectedOrganizationId) return unknown("CONTROL_CADENCE_ORGANIZATION_DRIFT");
  if (Date.parse(value.evaluated_at) !== Date.parse(input.evaluatedAt)) return unknown("CONTROL_CADENCE_EVALUATION_DRIFT");
  if (!hasCompletePolicy(value)) return unknown("CONTROL_CADENCE_POLICY_INCOMPLETE");
  if (value.heartbeat_state !== "FRESH") {
    return unknown(value.heartbeat_state === "STALE" ? "RECONCILER_HEARTBEAT_STALE" : "CONTROL_CADENCE_HEARTBEAT_UNKNOWN");
  }
  if (value.last_reconciled_at === null || Date.parse(value.last_reconciled_at) > Date.parse(value.evaluated_at)) {
    return unknown("CONTROL_CADENCE_RECONCILIATION_INVALID");
  }
  if (value.state === "UNKNOWN") return unknown(value.reason_code ?? "CONTROL_CADENCE_STATE_UNKNOWN");
  if (value.state !== "HEALTHY" && value.reason_code === null) return unknown("CONTROL_CADENCE_HEALTH_CONTRADICTION");
  if (value.state === "HEALTHY" && !isControlCadenceReleaseAllowed(value)) {
    return unknown("CONTROL_CADENCE_HEALTH_CONTRADICTION");
  }
  if (value.state === "DEGRADED" && value.outbound_release !== "BLOCKED") {
    return unknown("CONTROL_CADENCE_HEALTH_CONTRADICTION");
  }
  return value;
}
