import { describe, expect, it } from "vitest";

import { MemoryGoldenPathRepository, runSyntheticGoldenPath } from "@/lib/domain/golden-path";
import type { GoldenPathInput } from "@/lib/domain/types";

const input: GoldenPathInput = {
  idempotencyKey: "golden-path-001",
  company: {
    id: "company-001",
    organizationId: "ennco",
    legalName: "Synthetic Plant",
    domain: "synthetic.example",
  },
  contact: {
    id: "contact-001",
    companyId: "company-001",
    fullName: "Synthetic Contact",
    role: "Dirección de planta",
    email: "synthetic@synthetic.example",
  },
  qualification: {
    industrialOver100Kwp: true,
    outsideAnnexA: true,
    verifiedTargetRole: true,
    explicitInterest: true,
    monthlySpendMxn: 150_000,
    evidenceRecordIds: ["evidence-001"],
  },
};

describe("synthetic golden path", () => {
  it("runs the complete audited path", async () => {
    const repository = new MemoryGoldenPathRepository();
    const result = await runSyntheticGoldenPath(input, repository);
    expect(result.status).toBe("COMPLETED");
    expect(result.messageId).toBeTruthy();
    expect(result.replyId).toBeTruthy();
    expect(result.leadId).toBeTruthy();
    expect(result.alertId).toBeTruthy();
    expect(result.nextActionId).toBeTruthy();
    expect(result.auditEventIds.length).toBeGreaterThanOrEqual(4);
    expect(result.trace.map((event) => event.stage)).toEqual([
      "COMPANY_REGISTERED",
      "SUPPRESSION_PASSED",
      "DRY_RUN_MESSAGE_CREATED",
      "REPLY_INGESTED",
      "STRICT_LEAD_CREATED",
      "ALERT_ENQUEUED",
      "PORTAL_PROJECTED",
      "NEXT_ACTION_CREATED",
    ]);
  });

  it("stops before message creation when suppressed", async () => {
    const repository = new MemoryGoldenPathRepository();
    repository.suppress("ennco", "synthetic@synthetic.example");
    const result = await runSyntheticGoldenPath({ ...input, idempotencyKey: "suppressed-001" }, repository);
    expect(result.status).toBe("SUPPRESSED");
    expect(result.messageId).toBeUndefined();
    expect(result.trace.map((event) => event.stage)).toEqual([
      "COMPANY_REGISTERED",
      "SUPPRESSION_BLOCKED",
    ]);
  });

  it("does not repeat side effects for the same idempotency key", async () => {
    const repository = new MemoryGoldenPathRepository();
    const first = await runSyntheticGoldenPath(input, repository);
    const second = await runSyntheticGoldenPath(input, repository);
    expect(second.status).toBe("DUPLICATE");
    expect(second.messageId).toBe(first.messageId);
  });
});
