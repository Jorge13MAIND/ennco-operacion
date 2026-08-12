import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMutationContext, rpc } = vi.hoisted(() => ({ getMutationContext: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/operations/route", () => ({
  getMutationContext,
  mutationResponse: (payload: unknown) => NextResponse.json(payload, { status: 200 }),
  mutationUnavailable: (code: string) => NextResponse.json({ error: code }, { status: 409 }),
}));

import { POST } from "@/app/api/v1/operations/opportunities/[id]/capacity/route";

describe("capacity schedule route", () => {
  beforeEach(() => {
    getMutationContext.mockReset();
    getMutationContext.mockResolvedValue({
      ok: true,
      organizationId: "10000000-0000-4000-8000-000000000001",
      client: { rpc },
    });
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: {
        status: "SCHEDULED",
        schedule_id: "30000000-0000-4000-8000-000000000003",
        opportunity_id: "20000000-0000-4000-8000-000000000002",
        execution_date: "2026-10-15",
        capacity_month: "2026-10-01",
        capacity: {
          status: "READ_ONLY",
          state: "WARNING",
          organization_id: "10000000-0000-4000-8000-000000000001",
          capacity_month: "2026-10-01",
          config_id: "40000000-0000-4000-8000-000000000004",
          config_version: 1,
          monthly_limit: 2,
          warning_at: 1,
          committed_projects: 1,
          unscheduled_closed_won_projects: 0,
          available_projects: 1,
          over_capacity_projects: 0,
          reason_code: null,
          evaluated_at: "2026-08-12T12:00:00.000Z",
        },
        prior_month_capacity: null,
      },
      error: null,
    });
  });

  it("rejects an invalid opportunity or execution date", async () => {
    const response = await POST(
      new Request("https://operacion.invalid/api/v1/operations/opportunities/not-a-uuid/capacity", {
        method: "POST",
        body: JSON.stringify({ commandId: "not-a-uuid", executionDate: "octubre", changeReason: "ok" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects before parsing when the mutation context is denied", async () => {
    getMutationContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "ORIGIN_MISMATCH" }, { status: 403 }),
    });
    const response = await POST(
      new Request("https://operacion.invalid/api/v1/operations/opportunities/not-a-uuid/capacity", {
        method: "POST",
        body: "not-json",
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds organization opportunity date and reason to a deterministic idempotency key", async () => {
    const opportunityId = "20000000-0000-4000-8000-000000000002";
    const commandId = "50000000-0000-4000-8000-000000000005";
    const request = () => new Request(`https://operacion.invalid/api/v1/operations/opportunities/${opportunityId}/capacity`, {
      method: "POST",
      body: JSON.stringify({
        commandId,
        executionDate: "2026-10-15",
        changeReason: "Instalación confirmada por operación",
      }),
    });
    await POST(request(), { params: Promise.resolve({ id: opportunityId }) });
    await POST(request(), { params: Promise.resolve({ id: opportunityId }) });
    await POST(new Request(`https://operacion.invalid/api/v1/operations/opportunities/${opportunityId}/capacity`, {
      method: "POST",
      body: JSON.stringify({
        commandId: "60000000-0000-4000-8000-000000000006",
        executionDate: "2026-10-15",
        changeReason: "Instalación confirmada por operación",
      }),
    }), { params: Promise.resolve({ id: opportunityId }) });

    expect(rpc).toHaveBeenCalledTimes(3);
    const firstCall = rpc.mock.calls[0];
    const secondCall = rpc.mock.calls[1];
    const thirdCall = rpc.mock.calls[2];
    if (!firstCall || !secondCall || !thirdCall) throw new Error("EXPECTED_THREE_RPC_CALLS");
    expect(firstCall[0]).toBe("schedule_closed_won_capacity");
    expect(firstCall[1]).toMatchObject({
      target_organization_id: "10000000-0000-4000-8000-000000000001",
      target_opportunity_id: opportunityId,
      target_execution_date: "2026-10-15",
      target_change_reason: "Instalación confirmada por operación",
    });
    expect(firstCall[1].target_idempotency_key).toMatch(/^[a-f0-9]{64}$/);
    expect(secondCall[1].target_idempotency_key).toBe(firstCall[1].target_idempotency_key);
    expect(thirdCall[1].target_idempotency_key).not.toBe(firstCall[1].target_idempotency_key);
  });

  it("fails closed for a malformed database response", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "SENT" }, error: null });
    const opportunityId = "20000000-0000-4000-8000-000000000002";
    const response = await POST(new Request(`https://operacion.invalid/api/v1/operations/opportunities/${opportunityId}/capacity`, {
      method: "POST",
      body: JSON.stringify({
        commandId: "50000000-0000-4000-8000-000000000005",
        executionDate: "2026-10-15",
        changeReason: "Instalación confirmada por operación",
      }),
    }), { params: Promise.resolve({ id: opportunityId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "CAPACITY_RESPONSE_INVALID" });
  });

  it("returns only an allowlisted operational error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "CAPACITY_CONFIG_MISSING_FAIL_CLOSED with internal detail" } });
    const opportunityId = "20000000-0000-4000-8000-000000000002";
    const response = await POST(new Request(`https://operacion.invalid/api/v1/operations/opportunities/${opportunityId}/capacity`, {
      method: "POST",
      body: JSON.stringify({
        commandId: "50000000-0000-4000-8000-000000000005",
        executionDate: "2026-10-15",
        changeReason: "Instalación confirmada por operación",
      }),
    }), { params: Promise.resolve({ id: opportunityId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "CAPACITY_CONFIG_MISSING" });
  });
});
