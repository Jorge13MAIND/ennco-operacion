import { describe, expect, it } from "vitest";

import {
  capacityEvaluationSchema,
  capacityScheduleResultSchema,
  civilDateValue,
  mapCapacityRpcError,
  parseCapacityReadModel,
  scheduleResultMatchesRequest,
  selectCapacityCommand,
} from "@/lib/operations/capacity";

const evaluation = {
  status: "READ_ONLY" as const,
  state: "WARNING" as const,
  organization_id: "10000000-0000-4000-8000-000000000001",
  capacity_month: "2026-10-01",
  config_id: "20000000-0000-4000-8000-000000000002",
  config_version: 1,
  monthly_limit: 2,
  warning_at: 1,
  committed_projects: 1,
  unscheduled_closed_won_projects: 0,
  available_projects: 1,
  over_capacity_projects: 0,
  reason_code: null,
  evaluated_at: "2026-08-12T12:00:00.000Z",
};

describe("operational capacity contracts", () => {
  it("accepts a coherent read-only evaluation and rejects malformed health", () => {
    expect(capacityEvaluationSchema.safeParse(evaluation).success).toBe(true);
    expect(capacityEvaluationSchema.safeParse({ ...evaluation, status: "MUTATING" }).success).toBe(false);
    expect(capacityEvaluationSchema.safeParse({ ...evaluation, available_projects: 2 }).success).toBe(false);
    expect(capacityEvaluationSchema.safeParse({ ...evaluation, committed_projects: -1 }).success).toBe(false);
    expect(capacityEvaluationSchema.safeParse({ ...evaluation, state: "HEALTHY" }).success).toBe(false);
  });

  it("accepts only known schedule results", () => {
    expect(capacityScheduleResultSchema.safeParse({
      status: "SCHEDULED",
      schedule_id: "30000000-0000-4000-8000-000000000003",
      opportunity_id: "40000000-0000-4000-8000-000000000004",
      execution_date: "2026-10-15",
      capacity_month: "2026-10-01",
      capacity: evaluation,
      prior_month_capacity: null,
    }).success).toBe(true);
    expect(capacityScheduleResultSchema.safeParse({
      status: "SENT",
      schedule_id: "30000000-0000-4000-8000-000000000003",
      opportunity_id: "40000000-0000-4000-8000-000000000004",
      execution_date: "2026-10-15",
      capacity_month: "2026-10-01",
      capacity: evaluation,
    }).success).toBe(false);
  });

  it("rejects response drift from the command and execution month", () => {
    const parsed = capacityScheduleResultSchema.parse({
      status: "SCHEDULED",
      schedule_id: "30000000-0000-4000-8000-000000000003",
      opportunity_id: "40000000-0000-4000-8000-000000000004",
      execution_date: "2026-10-15",
      capacity_month: "2026-10-01",
      capacity: evaluation,
      prior_month_capacity: null,
    });
    expect(scheduleResultMatchesRequest(parsed, {
      organizationId: evaluation.organization_id,
      opportunityId: parsed.opportunity_id,
      executionDate: parsed.execution_date,
    })).toBe(true);
    expect(scheduleResultMatchesRequest(parsed, {
      organizationId: evaluation.organization_id,
      opportunityId: "50000000-0000-4000-8000-000000000005",
      executionDate: parsed.execution_date,
    })).toBe(false);
    expect(capacityScheduleResultSchema.safeParse({ ...parsed, capacity_month: "2026-11-01" }).success).toBe(false);
  });

  it("keeps partial schedule failure UNKNOWN even with a healthy evaluation", () => {
    const readModel = parseCapacityReadModel({
      schedulesAvailable: false,
      schedulesData: null,
      evaluationAvailable: true,
      evaluationData: evaluation,
    });
    expect(readModel).toMatchObject({
      inventoryReady: false,
      schedules: [],
      evaluation: null,
      reasonCode: "CAPACITY_SCHEDULE_INVENTORY_UNAVAILABLE",
    });
  });

  it("reuses one command for an ambiguous retry and renews it after payload drift", () => {
    const first = selectCapacityCommand(undefined, "payload-a", () => "command-a");
    const retry = selectCapacityCommand(first, "payload-a", () => "command-b");
    const changed = selectCapacityCommand(first, "payload-b", () => "command-b");
    expect(retry).toBe(first);
    expect(changed).toEqual({ payloadKey: "payload-b", commandId: "command-b" });
  });

  it("maps only allowlisted database failures", () => {
    expect(mapCapacityRpcError({ message: "CAPACITY_CONFIG_MISSING_FAIL_CLOSED" })).toEqual({
      code: "CAPACITY_CONFIG_MISSING",
      status: 409,
    });
    expect(mapCapacityRpcError({ message: "raw secret detail" })).toEqual({
      code: "CAPACITY_OPERATION_REJECTED",
      status: 409,
    });
  });

  it("formats a civil date without shifting it across Mexico City", () => {
    expect(civilDateValue("2026-10-01")).toBe("1 oct 2026");
    expect(civilDateValue("2026-02-30")).toBe("Sin fecha");
    expect(civilDateValue("2026-10-01T00:00:00Z")).toBe("Sin fecha");
  });
});
