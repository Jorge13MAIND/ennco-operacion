import { describe, expect, it, vi } from "vitest";

import type { DirectLaneMailboxHealth } from "@/lib/correos/client";
import { directLaneSendIsAmbiguous, mailboxesEligibleForTick, runDirectLaneTick } from "@/lib/correos/dispatch";
import { DirectLaneSendError } from "@/lib/correos/gmail-send";
import { sealDirectLaneSecret } from "@/lib/correos/vault";
import type { RuntimeConfig } from "@/lib/runtime/config";

const vaultKey = Buffer.alloc(32, 7).toString("base64");

function mailbox(overrides: Partial<DirectLaneMailboxHealth>): DirectLaneMailboxHealth {
  return {
    mailbox_id: "41000000-0000-4000-8000-000000000201",
    normalized_email: "francisco@enncoindustrial.com",
    domain: "enncoindustrial.com",
    sender_name: "Francisco Cuellar",
    status: "CONNECTED",
    credential_active: true,
    ramp_mode: "AUTO",
    fixed_cap: 5,
    cap_max: 40,
    effective_cap: 5,
    sent_today: 0,
    queued: 0,
    sent_total: 0,
    is_client_primary: false,
    ...overrides,
  };
}

function config(overrides: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    appUrl: "https://ennco-operacion.vercel.app",
    organizationId: "41000000-0000-4000-8000-000000000001",
    supabaseUrl: "https://synthetic.supabase.co",
    supabasePublishableKey: "publishable-key-synthetic-long-enough",
    dispatchSecret: "dispatch-secret-synthetic-at-least-32-chars",
    directLaneMode: "live",
    directLaneVaultKey: vaultKey,
    googleOauthClientId: "client-id-synthetic-long-enough-1234",
    googleOauthClientSecret: "client-secret-synthetic-long-enough-1",
    unsubscribeReleased: false,
    ...overrides,
  } as RuntimeConfig;
}

describe("direct lane tick", () => {
  it.each(["GMAIL_API_TIMEOUT", "GMAIL_API_UNAVAILABLE", "GMAIL_API_PROVIDER_ERROR", "GMAIL_API_RESPONSE_INVALID"])("treats %s as uncertain", (code) => {
    expect(directLaneSendIsAmbiguous(new DirectLaneSendError(code))).toBe(true);
  });

  it.each(["timeout", "unknown", "settlement"])("never marks FAILED or retries after an uncertain %s", async (scenario) => {
    const encrypted = sealDirectLaneSecret("1//refresh-token-synthetic-0123456789", vaultKey);
    const settle = vi.fn(async (_config, input) => {
      if (scenario === "settlement" && input.outcome === "SENT") throw new Error("database unavailable");
      return { status: "SETTLED" };
    });
    const send = vi.fn(async () => {
      if (scenario === "timeout") throw new DirectLaneSendError("GMAIL_API_TIMEOUT");
      if (scenario === "unknown") throw new Error("connection closed after write");
      return { provider: "GMAIL_API" as const, provider_message_id: "p1", provider_thread_id: "t1", rfc_message_id: "<p1@example.test>", envelope_sha256: "a".repeat(64) };
    });
    const claim = vi.fn(async () => ({
      status: "CLAIMED" as const, kind: "TOUCH" as const, message_id: "41000000-0000-4000-8000-000000000301",
      from_email: "francisco@enncoindustrial.com", to_email: "buyer@example.test", subject: "Asunto", body_text: "Consulta.", touch_number: 1,
    }));
    const result = await runDirectLaneTick(config({}), {
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({}), mailbox({ mailbox_id: "41000000-0000-4000-8000-000000000202" })], totals: {}, flags: {} }) as never),
      claim, settle, createSender: () => ({ send }),
      readCredential: vi.fn(async () => ({ ciphertext: encrypted.ciphertext, key_id: encrypted.keyId, credential_sha256: "b".repeat(64), normalized_email: "francisco@enncoindustrial.com", granted_scopes: [] })),
      accessToken: vi.fn(async () => "synthetic-access-token"), alert: vi.fn(async () => true),
    });
    expect(result.mailboxes[0]?.result).toBe("AMBIGUOUS");
    expect(send).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls.some(([, input]) => input.outcome === "FAILED")).toBe(false);
    expect(settle.mock.calls.some(([, input]) => input.outcome === "AMBIGUOUS")).toBe(true);
  });

  it("only ticks mailboxes that are connected with an active credential", () => {
    const eligible = mailboxesEligibleForTick([
      mailbox({}),
      mailbox({ mailbox_id: "41000000-0000-4000-8000-000000000202", status: "PAUSED" }),
      mailbox({ mailbox_id: "41000000-0000-4000-8000-000000000203", credential_active: false }),
    ]);
    expect(eligible.map((item) => item.mailbox_id)).toEqual(["41000000-0000-4000-8000-000000000201"]);
  });

  it("in shadow mode claims but never reads credentials nor calls Gmail", async () => {
    const readCredential = vi.fn();
    const send = vi.fn();
    const result = await runDirectLaneTick(config({ directLaneMode: "shadow" }), {
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({})], totals: {}, flags: {} }) as never),
      claim: vi.fn(async () => ({ status: "SHADOW_CLAIMED" as const, message_id: "41000000-0000-4000-8000-000000000301" })),
      readCredential,
      createSender: () => ({ send }),
    });
    expect(result.mode).toBe("shadow");
    expect(result.mailboxes[0]?.result).toBe("SHADOW_CLAIMED");
    expect(readCredential).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("in live mode decrypts the credential, sends and settles SENT with provider ids", async () => {
    const envelope = sealDirectLaneSecret("1//refresh-token-synthetic-0123456789", vaultKey);
    const settle = vi.fn(async () => ({ status: "SETTLED" }));
    const send = vi.fn(async () => ({
      provider: "GMAIL_API" as const,
      provider_message_id: "gm-1",
      provider_thread_id: "th-1",
      rfc_message_id: "<msg-41000000-0000-4000-8000-000000000301@enncoindustrial.com>",
      envelope_sha256: "a".repeat(64),
    }));
    const result = await runDirectLaneTick(config({}), {
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({})], totals: {}, flags: {} }) as never),
      claim: vi.fn(async () => ({
        status: "CLAIMED" as const,
        kind: "TOUCH" as const,
        message_id: "41000000-0000-4000-8000-000000000301",
        from_email: "francisco@enncoindustrial.com",
        from_name: "Francisco Cuellar",
        to_email: "compras@planta.test",
        subject: "Asunto",
        body_text: "Hola Juan, cuerpo corto del toque uno sin ligas.",
        touch_number: 1,
        thread: null,
        enrollment_id: "41000000-0000-4000-8000-000000000401",
      })),
      readCredential: vi.fn(async () => ({ ciphertext: envelope.ciphertext, key_id: envelope.keyId, credential_sha256: "b".repeat(64), normalized_email: "francisco@enncoindustrial.com", granted_scopes: [] })),
      accessToken: vi.fn(async (input) => {
        expect(input.refreshToken).toBe("1//refresh-token-synthetic-0123456789");
        return "access-token-synthetic-long";
      }),
      createSender: () => ({ send }),
      settle,
      alert: vi.fn(async () => true),
    });
    expect(result.mailboxes[0]?.result).toBe("SENT:TOUCH");
    expect(settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: "SENT", providerMessageId: "gm-1", providerThreadId: "th-1" }));
  });

  it("settles FAILED with the provider code and alerts when Gmail rejects", async () => {
    const envelope = sealDirectLaneSecret("1//refresh-token-synthetic-0123456789", vaultKey);
    const settle = vi.fn(async () => ({ status: "SETTLED" }));
    const alert = vi.fn(async () => true);
    const { DirectLaneSendError } = await import("@/lib/correos/gmail-send");
    const result = await runDirectLaneTick(config({}), {
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({})], totals: {}, flags: {} }) as never),
      claim: vi.fn(async () => ({
        status: "CLAIMED" as const, kind: "TOUCH" as const, message_id: "41000000-0000-4000-8000-000000000301",
        from_email: "francisco@enncoindustrial.com", to_email: "compras@planta.test", subject: "Asunto", body_text: "Cuerpo corto.", touch_number: 1, thread: null,
      })),
      readCredential: vi.fn(async () => ({ ciphertext: envelope.ciphertext, key_id: envelope.keyId, credential_sha256: "b".repeat(64), normalized_email: "x", granted_scopes: [] })),
      accessToken: vi.fn(async () => "access-token-synthetic-long"),
      createSender: () => ({ send: vi.fn(async () => { throw new DirectLaneSendError("GMAIL_API_RATE_LIMITED"); }) }),
      settle,
      alert,
    });
    expect(result.mailboxes[0]?.result).toBe("FAILED:GMAIL_API_RATE_LIMITED");
    expect(settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: "FAILED", errorCode: "GMAIL_API_RATE_LIMITED" }));
    expect(alert).toHaveBeenCalled();
  });
});
