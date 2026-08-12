import { isContractualLead } from "@/lib/domain/qualification";
import type { GoldenPathInput, GoldenPathResult, GoldenPathTraceEvent } from "@/lib/domain/types";

export type GoldenPathRepository = {
  findByIdempotencyKey(key: string): Promise<GoldenPathResult | null>;
  isSuppressed(organizationId: string, companyId: string, email: string, domain: string): Promise<boolean>;
  saveResult(key: string, result: GoldenPathResult): Promise<void>;
};

export async function runSyntheticGoldenPath(
  input: GoldenPathInput,
  repository: GoldenPathRepository,
): Promise<GoldenPathResult> {
  const existing = await repository.findByIdempotencyKey(input.idempotencyKey);
  if (existing) return { ...existing, status: "DUPLICATE" };

  const auditEventIds = [crypto.randomUUID()];
  const trace: GoldenPathTraceEvent[] = [
    {
      sequence: 1,
      stage: "COMPANY_REGISTERED",
      recordId: input.company.id,
      evidenceClass: "synthetic_demo",
    },
  ];
  const suppressed = await repository.isSuppressed(
    input.company.organizationId,
    input.company.id,
    input.contact.email,
    input.company.domain,
  );

  if (suppressed) {
    const suppressionAuditId = crypto.randomUUID();
    const result: GoldenPathResult = {
      status: "SUPPRESSED",
      auditEventIds: [...auditEventIds, suppressionAuditId],
      trace: [
        ...trace,
        {
          sequence: 2,
          stage: "SUPPRESSION_BLOCKED",
          recordId: suppressionAuditId,
          evidenceClass: "synthetic_demo",
        },
      ],
    };
    await repository.saveResult(input.idempotencyKey, result);
    return result;
  }

  const messageId = crypto.randomUUID();
  const replyId = crypto.randomUUID();
  const suppressionPassedAuditId = crypto.randomUUID();
  auditEventIds.push(suppressionPassedAuditId, crypto.randomUUID());

  const contractualLead = isContractualLead(input.qualification);
  const leadId = contractualLead ? crypto.randomUUID() : undefined;
  const alertId = contractualLead ? crypto.randomUUID() : undefined;
  const nextActionId = contractualLead ? crypto.randomUUID() : undefined;
  auditEventIds.push(crypto.randomUUID());

  trace.push(
    { sequence: 2, stage: "SUPPRESSION_PASSED", recordId: suppressionPassedAuditId, evidenceClass: "synthetic_demo" },
    { sequence: 3, stage: "DRY_RUN_MESSAGE_CREATED", recordId: messageId, evidenceClass: "synthetic_demo" },
    { sequence: 4, stage: "REPLY_INGESTED", recordId: replyId, evidenceClass: "synthetic_demo" },
  );

  if (leadId && alertId && nextActionId) {
    trace.push(
      { sequence: 5, stage: "STRICT_LEAD_CREATED", recordId: leadId, evidenceClass: "synthetic_demo" },
      { sequence: 6, stage: "ALERT_ENQUEUED", recordId: alertId, evidenceClass: "synthetic_demo" },
      { sequence: 7, stage: "PORTAL_PROJECTED", recordId: leadId, evidenceClass: "synthetic_demo" },
      { sequence: 8, stage: "NEXT_ACTION_CREATED", recordId: nextActionId, evidenceClass: "synthetic_demo" },
    );
  }

  const result: GoldenPathResult = {
    status: "COMPLETED",
    messageId,
    replyId,
    leadId,
    alertId,
    nextActionId,
    auditEventIds,
    trace,
  };
  await repository.saveResult(input.idempotencyKey, result);
  return result;
}

export class MemoryGoldenPathRepository implements GoldenPathRepository {
  private readonly results = new Map<string, GoldenPathResult>();
  private readonly suppressions = new Set<string>();

  suppress(organizationId: string, value: string): void {
    this.suppressions.add(`${organizationId}:${value.toLowerCase()}`);
  }

  async findByIdempotencyKey(key: string): Promise<GoldenPathResult | null> {
    return this.results.get(key) ?? null;
  }

  async isSuppressed(organizationId: string, companyId: string, email: string, domain: string): Promise<boolean> {
    return [companyId, email.toLowerCase(), domain.toLowerCase()].some((value) =>
      this.suppressions.has(`${organizationId}:${value}`),
    );
  }

  async saveResult(key: string, result: GoldenPathResult): Promise<void> {
    this.results.set(key, result);
  }
}
