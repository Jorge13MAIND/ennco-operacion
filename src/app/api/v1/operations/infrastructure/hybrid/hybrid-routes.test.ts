import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMutationContext, rpc } = vi.hoisted(() => ({ getMutationContext: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/operations/route", () => ({ getMutationContext }));

import { POST as observeMailbox } from "@/app/api/v1/operations/infrastructure/hybrid/mailboxes/[id]/observations/route";
import { POST as applyMailboxSnapshot } from "@/app/api/v1/operations/infrastructure/hybrid/mailboxes/snapshot/route";
import { POST as createRelease } from "@/app/api/v1/operations/infrastructure/hybrid/releases/route";

const organizationId = "29000000-0000-4000-8000-000000000001";
const mailboxId = "29000000-0000-4000-8000-000000000010";
const idempotencyKey = "a".repeat(64);

function request(body: unknown): Request {
  return new Request("https://example.invalid/api", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

describe("hybrid outbound mutation routes", () => {
  beforeEach(() => {
    rpc.mockReset();
    getMutationContext.mockReset();
    getMutationContext.mockResolvedValue({ ok: true, organizationId, client: { rpc } });
  });

  it("applies only the approved primary mailbox shape", async () => {
    const snapshot = {
      normalized_email: "contacto@ennco.com.mx",
      domain: "ennco.com.mx",
      eligibility_route: "EXISTING_PRIMARY_GMAIL_RAMP",
      domain_role: "PRIMARY_CORPORATE",
      custody_status: "TECKEL_MANAGED_FOR_ENNCO",
      provider: "gmail",
      domain_ready_at: "2026-08-25T12:00:00-06:00",
      domain_registered_at: "2025-09-26T12:00:00-06:00",
      warmup_started_at: null,
      warmup_status: "NOT_STARTED",
      auth_spf: true,
      auth_dkim: true,
      auth_dmarc: true,
      auth_tls: true,
      health_status: "HEALTHY",
      kill_switch: false,
      credential_status: "OAUTH_CONNECTED",
      sender_identity_verified: true,
      gmail_seed_verified: true,
      outlook_seed_verified: true,
      yahoo_seed_verified: true,
      reply_sync_verified: true,
      human_history_verified: true,
      blocklist_status: "CLEAR",
      route_evidence_sha256: "b".repeat(64),
      route_evidence_at: "2026-08-25T12:00:00-06:00",
      provider_daily_limit: 20,
      last_provider_health_at: "2026-08-25T12:00:00-06:00",
    };
    rpc.mockResolvedValue({ data: {
      status: "APPLIED", mailbox_id: mailboxId, request_sha256: "c".repeat(64), readiness: {},
    }, error: null });
    const response = await applyMailboxSnapshot(request(snapshot));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_hybrid_mailbox_snapshot", {
      target_organization_id: organizationId,
      target_snapshot: snapshot,
      target_idempotency_key: idempotencyKey,
    });
  });

  it("records cumulative evidence under a trusted mailbox path", async () => {
    const metrics = {
      valid_deliveries: 20,
      attempted_deliveries: 20,
      hard_bounces: 0,
      spam_complaints: 0,
      delivery_rate: 1,
      reply_sync_p95_seconds: 60,
      positive_reply_sla_breaches: 0,
      provider_reconciled: true,
      suppression_reconciled: true,
      identity_unambiguous: true,
      evidence_sha256: "d".repeat(64),
      evidence_class: "live",
      observed_at: "2026-08-25T12:00:00-06:00",
    };
    rpc.mockResolvedValue({ data: {
      status: "RECORDED", observation_id: "29000000-0000-4000-8000-000000000011",
      request_sha256: "e".repeat(64), readiness: {},
    }, error: null });
    const response = await observeMailbox(request(metrics), { params: Promise.resolve({ id: mailboxId }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_hybrid_mailbox_observation", expect.objectContaining({
      target_organization_id: organizationId,
      target_mailbox_id: mailboxId,
      target_metrics: metrics,
    }));
  });

  it("creates an exact release without accepting organization identity from the body", async () => {
    const payload = {
      mailbox_id: mailboxId,
      campaign_id: "29000000-0000-4000-8000-000000000020",
      lane: "ACCELERATED_TIER1_CANARY",
      manifest_sha256: "1".repeat(64),
      suppression_sha256: "2".repeat(64),
      copy_sha256: "3".repeat(64),
      sequence_sha256: "4".repeat(64),
      scheduled_for: "2026-08-25T13:00:00-06:00",
      expires_at: "2026-08-26T13:00:00-06:00",
      enrollment_ids: ["29000000-0000-4000-8000-000000000030"],
    };
    rpc.mockResolvedValue({ data: {
      status: "READY_FOR_CANARY",
      release_id: "29000000-0000-4000-8000-000000000040",
      request_sha256: "5".repeat(64),
      mailbox_id: mailboxId,
      recipient_count: 1,
      daily_cap: 5,
    }, error: null });
    const response = await createRelease(request(payload));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_hybrid_outbound_release", expect.objectContaining({
      target_organization_id: organizationId,
      target_mailbox_id: mailboxId,
      target_enrollment_ids: payload.enrollment_ids,
    }));
  });

  it("authenticates before parsing or touching the database", async () => {
    getMutationContext.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "DENIED" }), { status: 403 }),
    });
    const response = await createRelease(new Request("https://example.invalid/api", { method: "POST", body: "bad" }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
