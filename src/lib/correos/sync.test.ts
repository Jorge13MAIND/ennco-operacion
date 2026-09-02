import { describe, expect, it, vi } from "vitest";

import type { DirectLaneMailboxHealth } from "@/lib/correos/client";
import { mailboxesEligibleForSync, runDirectLaneSync } from "@/lib/correos/sync";
import { sealDirectLaneSecret } from "@/lib/correos/vault";
import type { RuntimeConfig } from "@/lib/runtime/config";

const vaultKey = Buffer.alloc(32, 3).toString("base64");
const envelope = sealDirectLaneSecret("1//refresh-token-synthetic-0123456789", vaultKey);

function mailbox(overrides: Partial<DirectLaneMailboxHealth>): DirectLaneMailboxHealth {
  return {
    mailbox_id: "41000000-0000-4000-8000-000000000201", normalized_email: "francisco@enncoindustrial.com", domain: "enncoindustrial.com",
    sender_name: "Francisco Cuellar", status: "CONNECTED", credential_active: true, ramp_mode: "AUTO", fixed_cap: 5, cap_max: 40,
    effective_cap: 5, sent_today: 0, queued: 0, sent_total: 0, is_client_primary: false, ...overrides,
  };
}

const config = {
  organizationId: "41000000-0000-4000-8000-000000000001", supabaseUrl: "https://synthetic.supabase.co",
  supabasePublishableKey: "publishable-key-synthetic-long-enough", dispatchSecret: "dispatch-secret-synthetic-at-least-32-chars",
  directLaneVaultKey: vaultKey, googleOauthClientId: "client-id-synthetic-long-enough-1234", googleOauthClientSecret: "client-secret-synthetic-long-enough-1",
} as RuntimeConfig;

const baseDeps = {
  readCredential: vi.fn(async () => ({ ciphertext: envelope.ciphertext, key_id: envelope.keyId, credential_sha256: "b".repeat(64), normalized_email: "x", granted_scopes: [] })),
  accessToken: vi.fn(async () => "access-token-synthetic-long"),
};

describe("direct lane sync", () => {
  it("syncs connected and paused mailboxes with credentials, never disconnected ones", () => {
    expect(mailboxesEligibleForSync([
      mailbox({}), mailbox({ mailbox_id: "41000000-0000-4000-8000-000000000202", status: "PAUSED" }),
      mailbox({ mailbox_id: "41000000-0000-4000-8000-000000000203", status: "DISCONNECTED" }),
    ])).toHaveLength(2);
  });

  it("bootstraps the cursor from the profile when the mailbox has none", async () => {
    const updateCursor = vi.fn(async () => ({ status: "ADVANCED" }) as never);
    const summary = await runDirectLaneSync(config, {
      ...baseDeps,
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({ sync: null })], totals: {}, flags: {} }) as never),
      transport: () => ({
        getProfile: async () => ({ status: 200, body: { historyId: "5000" } }),
        listHistory: async () => { throw new Error("must not list"); },
        getMessage: async () => { throw new Error("must not get"); },
      }),
      updateCursor,
    });
    expect(summary.mailboxes[0]?.result).toBe("CURSOR_BOOTSTRAPPED");
    expect(updateCursor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ historyId: "5000" }));
  });

  it("applies a linked human reply, annotates its headers and advances the cursor", async () => {
    const applyEvent = vi.fn(async () => ({ status: "PROCESSED", provider_event_id: "41000000-0000-4000-8000-000000000501" }) as never);
    const annotate = vi.fn(async () => ({ status: "ANNOTATED" }));
    const updateCursor = vi.fn(async () => ({ status: "ADVANCED" }) as never);
    const summary = await runDirectLaneSync(config, {
      ...baseDeps,
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({ sync: { last_history_id: "5000" } })], totals: {}, flags: {} }) as never),
      transport: () => ({
        getProfile: async () => ({ status: 200, body: { historyId: "5000" } }),
        listHistory: async () => ({ status: 200, body: { historyId: "5100", history: [{ id: "5050", messagesAdded: [{ message: { id: "m-1", threadId: "t-1" } }] }] } }),
        getMessage: async () => ({ status: 200, body: {
          id: "m-1", threadId: "t-1", internalDate: "1756800000000",
          payload: { mimeType: "text/plain", headers: [
            { name: "From", value: "Juan Pérez <compras@planta.test>" },
            { name: "Subject", value: "Re: Lo que le costó un apagón a un cliente" },
            { name: "Message-ID", value: "<reply-1@planta.test>" },
            { name: "In-Reply-To", value: "<msg-41000000-0000-4000-8000-000000000301@enncoindustrial.com>" },
          ] },
        } }),
      }),
      applyEvent, annotate, updateCursor,
    });
    expect(summary.appliedReplyEvents).toBe(1);
    expect(applyEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventKind: "REPLY", relatedOutboundMessageId: "41000000-0000-4000-8000-000000000301", normalizedFrom: "compras@planta.test",
    }));
    expect(annotate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rfcMessageId: "<reply-1@planta.test>", providerThreadId: "t-1" }));
    expect(updateCursor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ historyId: "5100" }));
  });

  it("resets the cursor when Gmail returns 404 on history", async () => {
    const updateCursor = vi.fn(async () => ({ status: "ADVANCED" }) as never);
    const summary = await runDirectLaneSync(config, {
      ...baseDeps,
      readHealth: vi.fn(async () => ({ mailboxes: [mailbox({ sync: { last_history_id: "1" } })], totals: {}, flags: {} }) as never),
      transport: () => ({
        getProfile: async () => ({ status: 200, body: { historyId: "9000" } }),
        listHistory: async () => ({ status: 404, body: null }),
        getMessage: async () => ({ status: 404, body: null }),
      }),
      updateCursor,
    });
    expect(summary.mailboxes[0]?.result).toBe("CURSOR_RESET");
    expect(updateCursor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ historyId: "9000" }));
  });
});
