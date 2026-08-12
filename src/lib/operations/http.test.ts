import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  operationsRpcResponse,
  parseOperationsMutationInput,
} from "@/lib/operations/http";

const commandSchema = z.object({
  organizationId: z.uuid(),
  recordId: z.uuid(),
  note: z.string().min(3),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const validOrganizationId = "00000000-0000-4000-8000-000000000001";
const validRecordId = "00000000-0000-4000-8000-000000000002";
const validKey = "a".repeat(64);

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://operacion.ennco.com.mx/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("operations mutation HTTP contract", () => {
  it("binds trusted values and the idempotency header", async () => {
    const parsed = await parseOperationsMutationInput({
      request: request({ note: "Evidencia local" }, { "Idempotency-Key": validKey }),
      schema: commandSchema,
      trustedValues: { organizationId: validOrganizationId, recordId: validRecordId },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({
        organizationId: validOrganizationId,
        recordId: validRecordId,
        note: "Evidencia local",
        idempotencyKey: validKey,
      });
    }
  });

  it("rejects a missing idempotency key before accepting the body", async () => {
    const parsed = await parseOperationsMutationInput({
      request: request({ note: "Evidencia local" }),
      schema: commandSchema,
      trustedValues: { organizationId: validOrganizationId, recordId: validRecordId },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect((await parsed.response.json()).error).toBe("OPERATIONS_IDEMPOTENCY_KEY_INVALID");
  });

  it("rejects attempts to inject trusted fields", async () => {
    const parsed = await parseOperationsMutationInput({
      request: request(
        { organizationId: validOrganizationId, note: "Evidencia local" },
        { "Idempotency-Key": validKey },
      ),
      schema: commandSchema,
      trustedValues: { organizationId: validOrganizationId, recordId: validRecordId },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect((await parsed.response.json()).error).toBe("OPERATIONS_TRUSTED_FIELD_IN_BODY");
  });

  it("fails closed when an RPC response drifts", async () => {
    const response = operationsRpcResponse(
      z.object({ status: z.literal("DONE"), record_id: z.uuid() }).strict(),
      { status: "DONE", record_id: validRecordId, unexpected: true },
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("OPERATIONS_RPC_RESPONSE_INVALID");
  });
});
