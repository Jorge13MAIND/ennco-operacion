import { describe, expect, it } from "vitest";

import { prepareOutboundEnvelope } from "@/lib/release/outbound-envelope";

describe("prepareOutboundEnvelope", () => {
  it("makes visible and one-click unsubscribe inseparable from a rendered outbound message", () => {
    const envelope = prepareOutboundEnvelope({
      sequence: { touches: [{ touch_number: 1, variants: { executive: { subject: "Hola {{first_name}}", body: "Vi {{observed_signal}} en {{company}}." } } }] },
      touchNumber: 1,
      variantName: "executive",
      values: { first_name: "Ana", company: "Planta sintética", observed_signal: "una señal pública", source_name: "fuente sintética" },
      appUrl: "https://diagnostico.example.invalid",
      organizationId: "11111111-1111-4111-8111-111111111111",
      enrollmentId: "22222222-2222-4222-8222-222222222222",
      unsubscribeSigningSecret: "test-secret-with-at-least-thirty-two-characters",
      now: new Date("2026-08-12T12:00:00.000Z"),
      tokenNonce: "33333333-3333-4333-8333-333333333333",
    });

    expect(envelope.subject).toBe("Hola Ana");
    expect(envelope.bodyText).toContain("darte de baja aquí: https://diagnostico.example.invalid/api/v1/unsubscribe?token=");
    expect(envelope.headers["List-Unsubscribe"]).toContain("https://diagnostico.example.invalid/api/v1/unsubscribe?token=");
    expect(envelope.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(envelope.unsubscribeTokenNonce).toBe("33333333-3333-4333-8333-333333333333");
  });
});
