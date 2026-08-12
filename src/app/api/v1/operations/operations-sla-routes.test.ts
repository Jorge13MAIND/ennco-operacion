import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMutationContext, rpc } = vi.hoisted(() => ({ getMutationContext: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/operations/route", () => ({ getMutationContext }));

import { POST as decideApproval } from "@/app/api/v1/operations/approvals/[id]/decision/route";
import { POST as transitionIncident } from "@/app/api/v1/operations/incidents/[id]/transition/route";
import { POST as requestApproval } from "@/app/api/v1/operations/opportunities/[id]/approval/route";
import { POST as scheduleMeeting } from "@/app/api/v1/operations/opportunities/[id]/meetings/route";
import { POST as completeTask } from "@/app/api/v1/operations/tasks/[id]/complete/route";

const organizationId = "41000000-0000-4000-8000-000000000001";
const recordId = "42000000-0000-4000-8000-000000000002";
const idempotencyKey = "a".repeat(64);

function request(path: string, body: unknown, includeKey = true): Request {
  return new Request(`https://operacion.ennco.com.mx${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(includeKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("operations SLA routes", () => {
  beforeEach(() => {
    rpc.mockReset();
    getMutationContext.mockReset();
    getMutationContext.mockResolvedValue({ ok: true, organizationId, client: { rpc } });
  });

  it("authorizes before parsing an untrusted task payload", async () => {
    getMutationContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "ORIGIN_MISMATCH" }, { status: 403 }),
    });
    const response = await completeTask(new Request("https://operacion.invalid/task", { method: "POST", body: "not-json" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key without calling the RPC", async () => {
    const response = await completeTask(request("/task", { evidenceSha256: "b".repeat(64) }, false), {
      params: Promise.resolve({ id: recordId }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("OPERATIONS_IDEMPOTENCY_KEY_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds incident identity and command fields to the authenticated organization", async () => {
    rpc.mockResolvedValueOnce({
      data: { status: "ACKNOWLEDGED", incident_id: recordId, correlation_id: recordId, replayed: false },
      error: null,
    });
    const response = await transitionIncident(request("/incident", {
      action: "ACKNOWLEDGE",
      evidenceSha256: "c".repeat(64),
      detail: "Acuse registrado con evidencia",
      recoveryTestPassed: false,
    }), { params: Promise.resolve({ id: recordId }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("transition_operational_incident", {
      target_organization_id: organizationId,
      target_incident_id: recordId,
      target_action: "ACKNOWLEDGE",
      target_evidence_sha256: "c".repeat(64),
      target_detail: "Acuse registrado con evidencia",
      target_recovery_test_passed: false,
      target_idempotency_key: idempotencyKey,
    });
  });

  it("fails closed when an approval RPC response drifts", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "APPROVED", unexpected: true }, error: null });
    const response = await decideApproval(request("/approval", {
      subjectSha256: "d".repeat(64),
      decision: "APPROVED",
      rationale: "Decisión independiente documentada",
    }), { params: Promise.resolve({ id: recordId }) });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("OPERATIONS_RPC_RESPONSE_INVALID");
  });

  it("reports a committed approval expiry as an actionable conflict", async () => {
    rpc.mockResolvedValueOnce({
      data: { status: "EXPIRED", request_id: recordId, approval_id: null, correlation_id: recordId, replayed: false },
      error: null,
    });
    const response = await decideApproval(request("/approval", {
      subjectSha256: "d".repeat(64),
      decision: "APPROVED",
      rationale: "La solicitud ya venció",
    }), { params: Promise.resolve({ id: recordId }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("APPROVAL_REQUEST_EXPIRED");
  });

  it("requests a canonical closed-won approval without accepting a caller hash", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        status: "PENDING",
        request_id: recordId,
        due_at: "2026-08-17T18:00:00-06:00",
        correlation_id: recordId,
        subject_sha256: "e".repeat(64),
        replayed: false,
      },
      error: null,
    });
    const response = await requestApproval(request("/approval-request", { requestReason: "Cierre listo para revisión independiente" }), {
      params: Promise.resolve({ id: recordId }),
    });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("request_closed_won_approval", {
      target_organization_id: organizationId,
      target_opportunity_id: recordId,
      target_request_reason: "Cierre listo para revisión independiente",
      target_idempotency_key: idempotencyKey,
    });
  });

  it("binds meeting scheduling to an explicit idempotency key", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "SCHEDULED", meeting_id: recordId }, error: null });
    const response = await scheduleMeeting(request("/meeting", { scheduledAt: "2026-08-13T16:00:00.000Z" }), {
      params: Promise.resolve({ id: recordId }),
    });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("schedule_meeting", {
      target_organization_id: organizationId,
      target_opportunity_id: recordId,
      target_scheduled_at: "2026-08-13T16:00:00.000Z",
      target_idempotency_key: idempotencyKey,
    });
  });
});
