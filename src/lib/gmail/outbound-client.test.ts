import { describe, expect, it, vi } from "vitest";

import { GmailOutboundClient, GmailOutboundError } from "@/lib/gmail/outbound-client";

const accessToken = "gmail-access-token-never-log-this";
const baseInput = {
  from_name: "Francisco Cuellar" as const,
  from_email: "contacto@ennco.com.mx" as const,
  to_email: "buyer@example.test",
  subject: "Diagnóstico preliminar de energía",
  body_text: "Hola, revisamos su operación industrial y creemos que vale la pena estimar un rango preliminar de ahorro. ¿Te interesa que lo preparemos?",
  authorization: {
    external_send_allowed: true as const,
    global_kill_switch: false as const,
    evidence_class: "live" as const,
    release_id: "29000000-0000-4000-8000-000000000011",
    message_id: "29000000-0000-4000-8000-000000000012",
    manifest_sha256: "a".repeat(64),
  },
};

describe("Gmail outbound client", () => {
  it("sends an authorized text-only first touch through the exact Gmail endpoint", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${accessToken}` });
      const payload = JSON.parse(String(init?.body)) as { raw: string };
      const decoded = Buffer.from(payload.raw, "base64url").toString("utf8");
      expect(decoded).toContain("From: Francisco Cuellar <contacto@ennco.com.mx>");
      expect(decoded).toContain("To: buyer@example.test");
      expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
      expect(decoded).not.toContain("text/html");
      return new Response(JSON.stringify({ id: "gmail-message-1", threadId: "gmail-thread-1" }), { status: 200 });
    });
    const client = new GmailOutboundClient({ accessToken, fetchImpl });
    const result = await client.sendFirstTouch(baseInput);
    expect(result).toMatchObject({
      provider: "GMAIL_API",
      provider_message_id: "gmail-message-1",
      release_id: baseInput.authorization.release_id,
    });
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(result.envelope_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    { ...baseInput, body_text: "Consulta los detalles en https://example.test" },
    { ...baseInput, body_text: Array.from({ length: 101 }, () => "palabra").join(" ") },
    { ...baseInput, from_email: "other@ennco.com.mx" },
    { ...baseInput, authorization: { ...baseInput.authorization, global_kill_switch: true } },
  ])("rejects an invalid first touch before calling Gmail", async (input) => {
    const fetchImpl = vi.fn();
    const client = new GmailOutboundClient({ accessToken, fetchImpl });
    await expect(client.sendFirstTouch(input as typeof baseInput)).rejects.toMatchObject({
      code: "GMAIL_FIRST_TOUCH_INPUT_INVALID",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider failures without returning the token or provider body", async () => {
    const providerSecret = "provider-body-must-not-leak";
    const client = new GmailOutboundClient({
      accessToken,
      fetchImpl: async () => new Response(providerSecret, { status: 403 }),
    });
    let error: unknown;
    try {
      await client.sendFirstTouch(baseInput);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GmailOutboundError);
    expect(error).toMatchObject({ code: "GMAIL_API_SCOPE_FORBIDDEN" });
    expect(String(error)).not.toContain(accessToken);
    expect(String(error)).not.toContain(providerSecret);
  });
});
