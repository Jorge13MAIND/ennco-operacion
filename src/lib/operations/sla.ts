import { z } from "zod";

const uuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const correlationId = uuid;
const replayed = z.boolean();

export const replyReviewCommandSchema = z.object({
  organizationId: uuid,
  providerEventId: uuid,
  classification: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  idempotencyKey: sha256,
}).strict();

export const replyReviewResultSchema = z.object({
  status: z.literal("REVIEWED"),
  provider_event_id: uuid,
  classification: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  lead_id: uuid.nullable(),
  task_id: uuid.nullable(),
  correlation_id: correlationId,
  replayed,
}).strict();

export const approvalDecisionCommandSchema = z.object({
  organizationId: uuid,
  requestId: uuid,
  subjectSha256: sha256,
  decision: z.enum(["APPROVED", "REJECTED"]),
  rationale: z.string().trim().min(3).max(2_000),
  idempotencyKey: sha256,
}).strict();

export const approvalRequestCommandSchema = z.object({
  organizationId: uuid,
  opportunityId: uuid,
  requestReason: z.string().trim().min(3).max(2_000),
  idempotencyKey: sha256,
}).strict();

export const approvalRequestResultSchema = z.object({
  status: z.literal("PENDING"),
  request_id: uuid,
  due_at: z.iso.datetime({ offset: true }),
  correlation_id: correlationId,
  subject_sha256: sha256,
  replayed,
}).strict();

export const approvalDecisionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
    request_id: uuid,
    approval_id: uuid,
    correlation_id: correlationId,
    replayed,
  }).strict(),
  z.object({
    status: z.literal("EXPIRED"),
    request_id: uuid,
    approval_id: z.null(),
    correlation_id: correlationId,
    replayed,
  }).strict(),
]);

export const taskAssignmentCommandSchema = z.object({
  organizationId: uuid,
  taskId: uuid,
  ownerUserId: uuid,
  backupUserId: uuid.nullable().optional(),
  idempotencyKey: sha256,
}).strict().refine(
  (value) => value.backupUserId == null || value.ownerUserId !== value.backupUserId,
  "TASK_OWNER_BACKUP_MUST_DIFFER",
);

export const taskAssignmentResultSchema = z.object({
  status: z.literal("ASSIGNED"),
  task_id: uuid,
  owner_user_id: uuid,
  backup_user_id: uuid.nullable(),
  correlation_id: correlationId,
  replayed,
}).strict();

export const taskCompletionCommandSchema = z.object({
  organizationId: uuid,
  taskId: uuid,
  evidenceSha256: sha256,
  idempotencyKey: sha256,
}).strict();

export const taskCompletionResultSchema = z.object({
  status: z.literal("DONE"),
  task_id: uuid,
  correlation_id: correlationId,
  replayed,
}).strict();

export const meetingOutcomeCommandSchema = z.object({
  organizationId: uuid,
  meetingId: uuid,
  outcomeStatus: z.enum(["HELD", "NO_SHOW", "CANCELLED", "RESCHEDULED"]),
  occurredAt: z.iso.datetime({ offset: true }),
  outcomeNotes: z.string().trim().min(3).max(10_000),
  evidenceSha256: sha256,
  idempotencyKey: sha256,
}).strict();

export const meetingScheduleCommandSchema = z.object({
  organizationId: uuid,
  opportunityId: uuid,
  scheduledAt: z.iso.datetime({ offset: true }),
  idempotencyKey: sha256,
}).strict();

export const meetingScheduleResultSchema = z.object({
  status: z.enum(["SCHEDULED", "DUPLICATE"]),
  meeting_id: uuid,
}).strict();

export const meetingOutcomeResultSchema = z.object({
  status: z.literal("RECORDED"),
  meeting_id: uuid,
  outcome_status: z.enum(["HELD", "NO_SHOW", "CANCELLED", "RESCHEDULED"]),
  opportunity_id: uuid,
  correlation_id: correlationId,
  replayed,
}).strict();

export const incidentTransitionCommandSchema = z.object({
  organizationId: uuid,
  incidentId: uuid,
  action: z.enum(["ACKNOWLEDGE", "CONTAIN", "RECOVER", "MONITOR", "RESOLVE", "REVIEW"]),
  evidenceSha256: sha256,
  detail: z.string().trim().min(3).max(4_000),
  recoveryTestPassed: z.boolean(),
  idempotencyKey: sha256,
}).strict();

export const incidentTransitionResultSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "CONTAINED", "RECOVERING", "MONITORING", "RESOLVED", "REVIEWED"]),
  incident_id: uuid,
  correlation_id: correlationId,
  replayed,
}).strict();

export const operationsHealthResultSchema = z.object({
  status: z.literal("READ_ONLY"),
  state: z.enum(["HEALTHY", "DEGRADED", "UNKNOWN"]),
  reason_code: z.enum(["WATCHDOG_NEVER_RAN", "WATCHDOG_HEARTBEAT_STALE", "OPERATOR_ASSIGNMENT_UNKNOWN", "OPEN_OPERATIONAL_FINDINGS"]).nullable(),
  evaluated_at: z.iso.datetime({ offset: true }),
  last_watchdog_at: z.iso.datetime({ offset: true }).nullable(),
  open_p0: z.number().int().nonnegative(),
  open_p1: z.number().int().nonnegative(),
  operator_assignment: z.enum(["ACTIVE", "UNKNOWN"]),
}).strict();
