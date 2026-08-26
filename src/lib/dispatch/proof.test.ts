import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createDispatchProof, dispatchPayloads } from "@/lib/dispatch/proof";

const secret = "synthetic-dispatch-secret-at-least-32-chars";
const organizationId = "11111111-1111-4111-8111-111111111111";

function mirrorSignature(input: {
  organizationId: string;
  commandName: string;
  commandId: string;
  nonce: string;
  expiresAt: string;
  payloadParts: readonly string[];
}): string {
  const payloadSha256 = createHash("sha256")
    .update([input.commandName, ...input.payloadParts].join("\n"), "utf8")
    .digest("hex");
  return createHmac("sha256", secret).update([
    input.organizationId,
    input.commandId,
    input.nonce,
    input.expiresAt,
    payloadSha256,
  ].join("\n"), "utf8").digest("hex");
}

describe("dispatch proof", () => {
  it("signs concat_ws(newline, org, command, nonce, expiry, payload_sha256) with second-precision UTC expiry", () => {
    const payloadParts = dispatchPayloads.claimHybridDispatch(organizationId, true);
    const proof = createDispatchProof({ organizationId, commandName: "claim_hybrid_dispatch", payloadParts, secret });

    expect(proof.proof_command_id).toBe(`claim_hybrid_dispatch:${proof.proof_nonce}`);
    expect(proof.proof_expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
    expect(proof.proof_signature).toBe(mirrorSignature({
      organizationId,
      commandName: "claim_hybrid_dispatch",
      commandId: proof.proof_command_id,
      nonce: proof.proof_nonce,
      expiresAt: proof.proof_expires_at,
      payloadParts,
    }));
  });

  it("builds canonical payload parts matching the SQL formulas", () => {
    expect(dispatchPayloads.claimHybridDispatch(organizationId, false)).toEqual([organizationId, "false"]);
    expect(dispatchPayloads.settleHybridDispatch(organizationId, "m-1", "SENT", null, null, null))
      .toEqual([organizationId, "m-1", "SENT", "", "", ""]);
    expect(dispatchPayloads.updateDispatchSyncCursor(organizationId, "mb-1", null, 1_700_000_000))
      .toEqual([organizationId, "mb-1", "", "1700000000"]);
    const providerParts = dispatchPayloads.applyDispatchProviderEvent({
      organizationId,
      mailboxId: "mb-1",
      externalEventId: null,
      providerMessageId: "gm-1",
      relatedOutboundMessageId: null,
      eventKind: "HARD_BOUNCE",
      normalizedFrom: "mailer-daemon@googlemail.com",
      subject: "Delivery Status Notification",
      bodyText: null,
      observedAtEpoch: 1_700_000_000,
    });
    expect(providerParts).toHaveLength(10);
    expect(providerParts[7]).toBe(createHash("sha256").update("Delivery Status Notification", "utf8").digest("hex"));
    expect(providerParts[8]).toBe(createHash("sha256").update("", "utf8").digest("hex"));
  });

  it("rejects short secrets", () => {
    expect(() => createDispatchProof({ organizationId, commandName: "x", payloadParts: [], secret: "short" }))
      .toThrow("DISPATCH_SECRET_INVALID");
  });
});
