import { z } from "zod";

const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

export const capacityEvaluationSchema = z.object({
  status: z.literal("READ_ONLY"),
  state: z.enum(["HEALTHY", "WARNING", "FULL", "UNKNOWN"]),
  organization_id: z.uuid(),
  capacity_month: z.iso.date().refine((value) => value.endsWith("-01")),
  config_id: z.uuid().nullable(),
  config_version: positiveInteger.nullable(),
  monthly_limit: positiveInteger.nullable(),
  warning_at: positiveInteger.nullable(),
  committed_projects: nonNegativeInteger,
  unscheduled_closed_won_projects: nonNegativeInteger,
  available_projects: nonNegativeInteger.nullable(),
  over_capacity_projects: nonNegativeInteger.nullable(),
  reason_code: z.enum(["CAPACITY_CONFIG_MISSING", "CLOSED_WON_EXECUTION_DATE_MISSING"]).nullable(),
  evaluated_at: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.state === "UNKNOWN") {
    const invalidMissingConfig = value.reason_code === "CAPACITY_CONFIG_MISSING"
      && (value.config_id !== null || value.config_version !== null || value.monthly_limit !== null || value.warning_at !== null);
    const invalidMissingDate = value.reason_code === "CLOSED_WON_EXECUTION_DATE_MISSING"
      && (value.config_id === null
        || value.config_version === null
        || value.monthly_limit === null
        || value.warning_at === null
        || value.unscheduled_closed_won_projects < 1);
    if ((value.reason_code !== "CAPACITY_CONFIG_MISSING" && value.reason_code !== "CLOSED_WON_EXECUTION_DATE_MISSING")
      || invalidMissingConfig
      || invalidMissingDate
      || value.available_projects !== null
      || value.over_capacity_projects !== null
    ) {
      context.addIssue({ code: "custom", message: "CAPACITY_UNKNOWN_SHAPE_INVALID" });
    }
    return;
  }
  if (value.config_id === null
    || value.config_version === null
    || value.monthly_limit === null
    || value.warning_at === null
    || value.available_projects === null
    || value.over_capacity_projects === null) {
    context.addIssue({ code: "custom", message: "CAPACITY_EVALUATION_INVARIANT_INVALID" });
    return;
  }
  if (value.reason_code !== null
    || value.unscheduled_closed_won_projects !== 0
    || value.warning_at > value.monthly_limit
    || value.available_projects !== Math.max(value.monthly_limit - value.committed_projects, 0)
    || value.over_capacity_projects !== Math.max(value.committed_projects - value.monthly_limit, 0)) {
    context.addIssue({ code: "custom", message: "CAPACITY_EVALUATION_INVARIANT_INVALID" });
  }
  const derivedState = value.committed_projects < value.warning_at ? "HEALTHY"
    : value.committed_projects < value.monthly_limit ? "WARNING" : "FULL";
  if (value.state !== derivedState) {
    context.addIssue({ code: "custom", message: "CAPACITY_STATE_DERIVATION_INVALID" });
  }
});

export const capacityScheduleResultSchema = z.object({
  status: z.enum(["SCHEDULED", "RESCHEDULED", "UNCHANGED", "DUPLICATE"]),
  schedule_id: z.uuid(),
  opportunity_id: z.uuid(),
  execution_date: z.iso.date(),
  capacity_month: z.iso.date().refine((value) => value.endsWith("-01")),
  capacity: capacityEvaluationSchema,
  prior_month_capacity: capacityEvaluationSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  const derivedMonth = `${value.execution_date.slice(0, 7)}-01`;
  if (value.capacity_month !== derivedMonth || value.capacity.capacity_month !== value.capacity_month) {
    context.addIssue({ code: "custom", message: "CAPACITY_SCHEDULE_MONTH_DRIFT" });
  }
});

export function scheduleResultMatchesRequest(result: z.infer<typeof capacityScheduleResultSchema>, expected: {
  organizationId: string;
  opportunityId: string;
  executionDate: string;
}): boolean {
  return result.capacity.organization_id === expected.organizationId
    && result.opportunity_id === expected.opportunityId
    && result.execution_date === expected.executionDate;
}

export const capacityConfigResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  config_id: z.uuid(),
  config_version: positiveInteger,
}).strict();

export const capacityScheduleRowSchema = z.object({
  id: z.uuid(),
  opportunity_id: z.uuid(),
  execution_date: z.iso.date(),
  capacity_month: z.iso.date().refine((value) => value.endsWith("-01")),
  config_version: positiveInteger,
}).strict();

export type CapacityCommand = { payloadKey: string; commandId: string };

export function selectCapacityCommand(
  previous: CapacityCommand | undefined,
  payloadKey: string,
  createCommandId: () => string,
): CapacityCommand {
  return previous?.payloadKey === payloadKey ? previous : { payloadKey, commandId: createCommandId() };
}

export function parseCapacityReadModel(input: {
  schedulesAvailable: boolean;
  schedulesData: unknown;
  evaluationAvailable: boolean;
  evaluationData: unknown;
}): {
  inventoryReady: boolean;
  schedules: z.infer<typeof capacityScheduleRowSchema>[];
  evaluation: z.infer<typeof capacityEvaluationSchema> | null;
  reasonCode: string | null;
} {
  const schedules = capacityScheduleRowSchema.array().safeParse(input.schedulesData);
  const inventoryReady = input.schedulesAvailable && schedules.success;
  if (!inventoryReady) {
    return { inventoryReady: false, schedules: [], evaluation: null, reasonCode: "CAPACITY_SCHEDULE_INVENTORY_UNAVAILABLE" };
  }
  const evaluation = capacityEvaluationSchema.safeParse(input.evaluationData);
  if (!input.evaluationAvailable || !evaluation.success) {
    return {
      inventoryReady: true,
      schedules: schedules.data,
      evaluation: null,
      reasonCode: input.evaluationAvailable ? "CAPACITY_RESPONSE_INVALID" : "CAPACITY_QUERY_FAILED",
    };
  }
  return { inventoryReady: true, schedules: schedules.data, evaluation: evaluation.data, reasonCode: evaluation.data.reason_code };
}

const SAFE_CAPACITY_ERRORS: ReadonlyArray<{
  token: string;
  code: string;
  status: number;
}> = [
  { token: "CAPACITY_CONFIG_MISSING_FAIL_CLOSED", code: "CAPACITY_CONFIG_MISSING", status: 409 },
  { token: "CAPACITY_REQUIRES_CLOSED_WON_OPPORTUNITY", code: "CAPACITY_STAGE_NOT_CLOSED_WON", status: 409 },
  { token: "CAPACITY_OPPORTUNITY_NOT_FOUND_OR_TENANT_MISMATCH", code: "CAPACITY_OPPORTUNITY_NOT_FOUND", status: 404 },
  { token: "CAPACITY_OPERATOR_AAL2_REQUIRED", code: "CAPACITY_OPERATOR_FORBIDDEN", status: 403 },
  { token: "CAPACITY_CONFIG_ADMIN_AAL2_REQUIRED", code: "CAPACITY_CONFIG_FORBIDDEN", status: 403 },
  { token: "CAPACITY_SCHEDULE_IDEMPOTENCY_DRIFT", code: "CAPACITY_COMMAND_CONFLICT", status: 409 },
  { token: "CAPACITY_SCHEDULE_INPUT_INVALID", code: "CAPACITY_SCHEDULE_INPUT_INVALID", status: 400 },
  { token: "CAPACITY_CONFIG_INPUT_INVALID", code: "CAPACITY_CONFIG_INPUT_INVALID", status: 400 },
];

export function mapCapacityRpcError(error: unknown): { code: string; status: number } {
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : "";
  const mapped = SAFE_CAPACITY_ERRORS.find((entry) => message.includes(entry.token));
  return mapped ? { code: mapped.code, status: mapped.status } : { code: "CAPACITY_OPERATION_REJECTED", status: 409 };
}

export function civilDateValue(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return "Sin fecha";
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: "America/Mexico_City",
  }).format(date);
}
